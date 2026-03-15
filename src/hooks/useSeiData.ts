'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import protobuf from 'protobufjs';
import { DashcamMP4, SeiData, SeiWithFrameIndex, SeiMetadataType } from '@/lib/dashcam-mp4';
import { VideoSequence } from '@/types/video';

interface UseSeiDataResult {
  seiData: SeiData | null;
  isLoading: boolean;
  error: string | null;
  allSeiMessages: SeiWithFrameIndex[];
  fps: number;
}

/**
 * Extended SEI message that includes the absolute frame index across the sequence
 */
interface SequenceSeiMessage extends SeiWithFrameIndex {
  momentIndex: number;      // Which moment this SEI came from
  absoluteFrameIndex: number;  // Frame index relative to sequence start
}

/**
 * Hook to extract and merge SEI data across all clips in a sequence.
 *
 * For single-clip sequences, this behaves like the old hook.
 * For multi-clip sequences, it:
 * 1. Extracts SEI from all clips in parallel
 * 2. Adjusts frame indices to be sequence-relative
 * 3. Merges all messages into a single sorted array
 * 4. Uses binary search with absolute time
 */
export function useSeiData(
  sequence: VideoSequence | null,
  currentMomentIndex: number,
  absoluteTime: number
): UseSeiDataResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allSeiMessages, setAllSeiMessages] = useState<SequenceSeiMessage[]>([]);
  const [fps, setFps] = useState(30);

  const seiMetadataRef = useRef<SeiMetadataType | null>(null);
  const lastSequenceIdRef = useRef<string | null>(null);

  // Load protobuf schema and extract SEI messages when sequence changes
  useEffect(() => {
    if (!sequence) {
      setAllSeiMessages([]);
      setError(null);
      lastSequenceIdRef.current = null;
      return;
    }

    // Skip if we already processed this sequence (check both id and moments length)
    const sequenceKey = `${sequence.id}-${sequence.moments.length}-${sequence.totalDuration}`;
    if (lastSequenceIdRef.current === sequenceKey) {
      return;
    }

    const extractAllSei = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Load protobuf schema if not already loaded
        if (!seiMetadataRef.current) {
          console.log('[SEI] Loading protobuf schema...');
          const response = await fetch('/dashcam.proto');
          const protoText = await response.text();
          const root = protobuf.parse(protoText, { keepCase: true }).root;
          seiMetadataRef.current = root.lookupType('SeiMetadata') as unknown as SeiMetadataType;
          console.log('[SEI] Protobuf schema loaded successfully');
        }

        // Extract SEI from all moments in the sequence
        const allMessages: SequenceSeiMessage[] = [];
        let sequenceFps = 30;
        let cumulativeFrameOffset = 0;

        console.log(`[SEI] Processing ${sequence.moments.length} moments in sequence`);

        for (let momentIdx = 0; momentIdx < sequence.moments.length; momentIdx++) {
          const moment = sequence.moments[momentIdx];

          // Find the front video (preferred) or first available video
          const frontVideo = moment.videos.find(v => v.angle === 'front');
          const videoFile = frontVideo?.file || moment.videos[0]?.file;

          if (!videoFile) {
            console.warn(`[SEI] No video file found for moment ${momentIdx}`);
            cumulativeFrameOffset += Math.round(moment.duration * sequenceFps);
            continue;
          }

          try {
            console.log(`[SEI] Processing moment ${momentIdx}: ${videoFile.name}`);
            // Handle both Tauri and browser files
            let arrayBuffer: ArrayBuffer;
            const tauriPath = (videoFile as any).tauriPath;
            if (tauriPath) {
              // Tauri file - read via native API
              const { readFile } = await import('@tauri-apps/plugin-fs');
              const content = await readFile(tauriPath);
              arrayBuffer = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
            } else {
              // Browser file - use File API
              arrayBuffer = await videoFile.arrayBuffer();
            }
            const mp4 = new DashcamMP4(arrayBuffer);

            // Get FPS from first valid video
            if (momentIdx === 0) {
              try {
                sequenceFps = mp4.getFps();
                console.log(`[SEI] Sequence FPS: ${sequenceFps}`);
              } catch (e) {
                console.warn('[SEI] Could not get FPS, using default 30');
              }
            }

            // Extract SEI messages
            const messages = mp4.extractSeiMessagesWithFrameIndex(seiMetadataRef.current!);
            console.log(`[SEI] Extracted ${messages.length} messages from moment ${momentIdx}`);

            // Add to merged list with adjusted frame indices
            for (const msg of messages) {
              allMessages.push({
                ...msg,
                momentIndex: momentIdx,
                absoluteFrameIndex: cumulativeFrameOffset + msg.frameIndex,
              });
            }

            // Update cumulative offset for next moment
            const momentFrames = Math.round(moment.duration * sequenceFps);
            cumulativeFrameOffset += momentFrames;

          } catch (err) {
            console.error(`[SEI] Error processing moment ${momentIdx}:`, err);
            // Continue with other moments even if one fails
            cumulativeFrameOffset += Math.round(moment.duration * sequenceFps);
          }
        }

        // Sort by absolute frame index (should already be sorted, but just in case)
        allMessages.sort((a, b) => a.absoluteFrameIndex - b.absoluteFrameIndex);

        console.log(`[SEI] Total messages across sequence: ${allMessages.length}`);
        setAllSeiMessages(allMessages);
        setFps(sequenceFps);
        lastSequenceIdRef.current = `${sequence.id}-${sequence.moments.length}-${sequence.totalDuration}`;

        if (allMessages.length === 0) {
          setError('No Tesla metadata found in this video. Make sure this is a Tesla dashcam recording.');
        }
      } catch (err) {
        console.error('[SEI] Error extracting SEI:', err);
        setError(err instanceof Error ? err.message : 'Failed to extract metadata');
      } finally {
        setIsLoading(false);
      }
    };

    extractAllSei();
  }, [sequence?.id, sequence?.moments?.length, sequence?.totalDuration]);

  // Find SEI data for current absolute time
  const getSeiForTime = useCallback(
    (time: number): SeiData | null => {
      if (allSeiMessages.length === 0) return null;

      const absoluteFrameIndex = Math.floor(time * fps);

      // Binary search for nearest SEI message
      let left = 0;
      let right = allSeiMessages.length - 1;

      while (left < right) {
        const mid = Math.floor((left + right + 1) / 2);
        if (allSeiMessages[mid].absoluteFrameIndex <= absoluteFrameIndex) {
          left = mid;
        } else {
          right = mid - 1;
        }
      }

      return allSeiMessages[left]?.sei || null;
    },
    [allSeiMessages, fps]
  );

  const seiData = useMemo(
    () => getSeiForTime(absoluteTime),
    [getSeiForTime, absoluteTime]
  );

  // Convert back to the standard format for consumers
  const normalizedMessages = useMemo((): SeiWithFrameIndex[] => {
    return allSeiMessages.map(msg => ({
      frameIndex: msg.absoluteFrameIndex,
      sei: msg.sei,
    }));
  }, [allSeiMessages]);

  return {
    seiData,
    isLoading,
    error,
    allSeiMessages: normalizedMessages,
    fps,
  };
}
