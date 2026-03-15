/**
 * Sequence Detector
 *
 * Detects consecutive Tesla dashcam clips and merges them into sequences
 * for seamless playback. A sequence is formed when clips have timestamps
 * within a specified gap threshold (typically 65 seconds for 60-second clips).
 */

import {
  VideoMoment,
  VideoSequence,
  CameraVideo,
  ProcessingProgress,
  TeslaEvent,
  parseAngle,
  parseTimestamp,
  formatDuration,
  formatFileSize,
  getReasonLabel,
  ANGLE_LABELS,
  ANGLE_ORDER,
} from '@/types/video';

/** Gap threshold in seconds - clips within this gap are considered consecutive */
const SEQUENCE_GAP_THRESHOLD_SECONDS = 65;

/** Default duration for Tesla dashcam clips (60 seconds) */
const DEFAULT_VIDEO_DURATION = 60;

/** Batch size for async processing */
const BATCH_SIZE = 50;

/** Skip duration detection for faster processing (Tesla clips are always 60s) */
const SKIP_DURATION_DETECTION = false;

/** Parse MP4 duration from file buffer by reading mvhd box */
function parseMp4Duration(buffer: ArrayBuffer): number | null {
  try {
    const view = new DataView(buffer);
    const length = buffer.byteLength;
    
    // Search for moov box
    let pos = 0;
    while (pos + 8 <= length) {
      const size = view.getUint32(pos);
      const type = String.fromCharCode(
        view.getUint8(pos + 4),
        view.getUint8(pos + 5),
        view.getUint8(pos + 6),
        view.getUint8(pos + 7)
      );
      
      if (type === 'moov') {
        // Found moov box, now search for mvhd inside it
        const moovStart = pos + 8;
        const moovEnd = pos + (size === 1 ? 16 : size);
        let mvhdPos = moovStart;
        
        while (mvhdPos + 8 <= moovEnd && mvhdPos < length) {
          const mvhdSize = view.getUint32(mvhdPos);
          const mvhdType = String.fromCharCode(
            view.getUint8(mvhdPos + 4),
            view.getUint8(mvhdPos + 5),
            view.getUint8(mvhdPos + 6),
            view.getUint8(mvhdPos + 7)
          );
          
          if (mvhdType === 'mvhd') {
            // Found mvhd box, parse duration
            // mvhd box format:
            // version 0: 4 bytes (size) + 4 bytes (type) + 1 byte (version) + 3 bytes (flags) + 4 bytes (creation) + 4 bytes (modification) + 4 bytes (timescale) + 4 bytes (duration) = 24 bytes header
            // version 1: 4 bytes (size) + 4 bytes (type) + 1 byte (version) + 3 bytes (flags) + 8 bytes (creation) + 8 bytes (modification) + 4 bytes (timescale) + 8 bytes (duration) = 32 bytes header
            const version = view.getUint8(mvhdPos + 8);
            const timescaleOffset = mvhdPos + 8 + (version === 1 ? 20 : 12);
            const durationOffset = mvhdPos + 8 + (version === 1 ? 28 : 16);
            
            if (durationOffset + 8 <= length) {
              const timescale = view.getUint32(timescaleOffset);
              const duration = version === 1 
                ? Number((BigInt(view.getUint32(durationOffset)) << 32n) | BigInt(view.getUint32(durationOffset + 4)))
                : view.getUint32(durationOffset);
              
              if (timescale > 0 && duration > 0) {
                const seconds = Math.round(duration / timescale);
                console.log(`[Duration] Parsed from MP4: ${seconds}s (timescale=${timescale}, duration=${duration})`);
                return seconds;
              }
            }
            return null;
          }
          
          // Move to next box
          const boxSize = mvhdSize === 1 ? 16 : (mvhdSize === 0 ? moovEnd - mvhdPos : mvhdSize);
          mvhdPos += boxSize;
        }
        return null;
      }
      
      // Move to next box
      const boxSize = size === 1 ? 16 : (size === 0 ? length - pos : size);
      pos += boxSize;
    }
    return null;
  } catch (e) {
    console.warn('[Duration] Failed to parse MP4:', e);
    return null;
  }
}

/** Get video duration - uses MP4 parsing in Tauri, HTMLVideoElement in browser */
async function getVideoDuration(file: File): Promise<number> {
  const tauriPath = (file as any).tauriPath;
  const tauriUrl = (file as any).tauriUrl;
  
  // In Tauri environment, read file head and parse MP4 duration
  if (tauriPath) {
    try {
      const { readFile } = await import('@tauri-apps/plugin-fs');
      // Read the entire file (for Tesla clips, this is typically manageable)
      // We read the full file to ensure we get the complete moov box
      const content = await readFile(tauriPath);
      // Only use first 4MB for parsing (moov box is usually at the start or end)
      const maxParseSize = Math.min(content.length, 4 * 1024 * 1024);
      const buffer = content.buffer.slice(content.byteOffset, content.byteOffset + maxParseSize);
      const duration = parseMp4Duration(buffer);
      if (duration && duration > 0 && isFinite(duration)) {
        return duration;
      }
      console.warn('[Duration] MP4 parse failed, falling back to default');
    } catch (e) {
      console.warn('[Duration] Error reading Tauri file:', e);
    }
    return DEFAULT_VIDEO_DURATION;
  }
  
  // In browser environment, use HTMLVideoElement
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';

    // Set a timeout to avoid hanging on corrupted files
    const timeout = setTimeout(() => {
      URL.revokeObjectURL(url);
      resolve(DEFAULT_VIDEO_DURATION);
    }, 5000); // 5 second timeout

    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      resolve(video.duration && isFinite(video.duration) ? video.duration : DEFAULT_VIDEO_DURATION);
    };

    video.onerror = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      resolve(DEFAULT_VIDEO_DURATION);
    };

    video.src = url;
  });
}

/** Read file content - handles both browser and Tauri files */
async function readFileContent(file: File): Promise<Uint8Array> {
  const tauriPath = (file as any).tauriPath;
  if (tauriPath) {
    // Tauri file - use native readFile
    const { readFile } = await import('@tauri-apps/plugin-fs');
    return await readFile(tauriPath);
  }
  // Browser file - use File API
  return new Uint8Array(await file.arrayBuffer());
}

/** Parse an event.json file into a TeslaEvent */
async function parseEventJson(file: File): Promise<TeslaEvent | null> {
  try {
    const content = await readFileContent(file);
    const text = new TextDecoder().decode(content);
    const data = JSON.parse(text);
    if (!data.timestamp || !data.reason) return null;

    // Parse timestamp: "2026-02-07T17:36:02" (local time, no timezone)
    const ts = new Date(data.timestamp);
    if (isNaN(ts.getTime())) return null;

    return {
      timestamp: ts,
      city: data.city || undefined,
      street: data.street || undefined,
      est_lat: data.est_lat ? parseFloat(data.est_lat) : undefined,
      est_lon: data.est_lon ? parseFloat(data.est_lon) : undefined,
      reason: data.reason,
      reasonLabel: getReasonLabel(data.reason),
      camera: data.camera || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Process raw video files into VideoMoments grouped by timestamp.
 * Also parses any event.json files found alongside the videos.
 */
export async function processFilesToMoments(
  files: File[],
  onProgress?: (progress: ProcessingProgress) => void
): Promise<{ moments: VideoMoment[]; events: TeslaEvent[] }> {
  // Separate JSON files from MP4 files
  const videoFiles: File[] = [];
  const jsonFiles: File[] = [];
  for (const file of files) {
    if (file.name.toLowerCase() === 'event.json') {
      jsonFiles.push(file);
    } else {
      videoFiles.push(file);
    }
  }

  // Parse event.json files
  const events: TeslaEvent[] = [];
  for (const jsonFile of jsonFiles) {
    const event = await parseEventJson(jsonFile);
    if (event) events.push(event);
  }

  // Group video files by timestamp
  const groups: Record<string, { file: File; angle: string | null; timestamp: Date | null }[]> = {};

  onProgress?.({
    stage: 'scanning',
    current: 0,
    total: videoFiles.length,
    message: 'Scanning files...',
  });

  for (const file of videoFiles) {
    const timestamp = parseTimestamp(file.name);
    const key = timestamp
      ? timestamp.toISOString()
      : file.name; // Fallback for non-standard names

    if (!groups[key]) groups[key] = [];
    groups[key].push({
      file,
      angle: parseAngle(file.name),
      timestamp,
    });
  }

  // Convert groups to VideoMoments with duration metadata
  const moments: VideoMoment[] = [];
  const groupEntries = Object.entries(groups);
  let processedCount = 0;

  // Flatten all files for batch processing
  const allGroupFiles: { file: File; angle: string | null; timestamp: Date | null; groupKey: string }[] = [];
  for (const [groupKey, groupFiles] of groupEntries) {
    for (const { file, angle, timestamp } of groupFiles) {
      allGroupFiles.push({ file, angle, timestamp, groupKey });
    }
  }

  // Process files in batches to avoid blocking the main thread
  const fileDurations = new Map<string, number>();
  
  // Fast path: Skip duration detection for known Tesla files (all 60s)
  if (SKIP_DURATION_DETECTION) {
    for (const { file } of allGroupFiles) {
      fileDurations.set(file.name, DEFAULT_VIDEO_DURATION);
      
      processedCount++;
      if (processedCount % 100 === 0 || processedCount === allGroupFiles.length) {
        onProgress?.({
          stage: 'metadata',
          current: processedCount,
          total: videoFiles.length,
          message: `Processing files...`,
        });
      }
    }
  } else {
    // Slow path: Read actual duration from video metadata
    for (let i = 0; i < allGroupFiles.length; i += BATCH_SIZE) {
      const batch = allGroupFiles.slice(i, i + BATCH_SIZE);
      
      // Process batch concurrently
      await Promise.all(
        batch.map(async ({ file }) => {
          const duration = await getVideoDuration(file);
          fileDurations.set(file.name, duration);
          
          processedCount++;
          onProgress?.({
            stage: 'metadata',
            current: processedCount,
            total: videoFiles.length,
            message: `Processing ${file.name}...`,
          });
        })
      );
      
      // Yield to main thread between batches
      if (i + BATCH_SIZE < allGroupFiles.length) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  }

  // Build moments from processed data
  for (const [groupKey, groupFiles] of groupEntries) {
    const validTimestamp = groupFiles.find(f => f.timestamp)?.timestamp;
    if (!validTimestamp) continue;

    const videos: CameraVideo[] = groupFiles.map(({ file, angle }) => {
      const duration = fileDurations.get(file.name) || DEFAULT_VIDEO_DURATION;
      const tauriUrl = (file as any).tauriUrl;
      
      return {
        file,
        angle: angle || 'unknown',
        angleLabel: angle ? ANGLE_LABELS[angle] : 'Unknown',
        duration,
        durationFormatted: formatDuration(duration),
        size: formatFileSize(file.size),
        url: tauriUrl, // Pass Tauri URL for direct file access
      };
    });

    // Sort videos by angle order
    videos.sort((a, b) => {
      const aIdx = ANGLE_ORDER.indexOf(a.angle);
      const bIdx = ANGLE_ORDER.indexOf(b.angle);
      return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
    });

    // Use front camera duration, or first available
    const frontVideo = videos.find(v => v.angle === 'front');
    const momentDuration = frontVideo?.duration || videos[0]?.duration || DEFAULT_VIDEO_DURATION;

    // Use local time for display (avoid UTC conversion issues)
    const year = validTimestamp.getFullYear();
    const month = String(validTimestamp.getMonth() + 1).padStart(2, '0');
    const day = String(validTimestamp.getDate()).padStart(2, '0');
    const date = `${year}-${month}-${day}`;
    
    const hours = String(validTimestamp.getHours()).padStart(2, '0');
    const minutes = String(validTimestamp.getMinutes()).padStart(2, '0');
    const seconds = String(validTimestamp.getSeconds()).padStart(2, '0');
    const time = `${hours}:${minutes}:${seconds}`;

    moments.push({
      id: `${date}_${hours}-${minutes}-${seconds}`,
      timestamp: validTimestamp,
      date,
      time,
      dateTime: `${date} ${time}`,
      videos,
      duration: momentDuration,
    });
  }

  // Sort moments chronologically
  moments.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  onProgress?.({
    stage: 'ready',
    current: videoFiles.length,
    total: videoFiles.length,
    message: 'Ready',
  });

  return { moments, events };
}

/**
 * Detect consecutive moments and merge them into sequences
 *
 * Example:
 * - Clip 1: 10:30:00 (60s duration)
 * - Clip 2: 10:31:00 (60s duration) ← 0s gap after Clip 1 ends, merge
 * - Clip 3: 10:32:00 (60s duration) ← 0s gap after Clip 2 ends, merge
 * - Clip 4: 10:45:00 (60s duration) ← 12min gap, new sequence
 */
export function detectSequences(moments: VideoMoment[], events: TeslaEvent[] = []): VideoSequence[] {
  if (moments.length === 0) return [];

  const sequences: VideoSequence[] = [];
  let currentSequenceMoments: VideoMoment[] = [moments[0]];

  for (let i = 1; i < moments.length; i++) {
    const prevMoment = currentSequenceMoments[currentSequenceMoments.length - 1];
    const currentMoment = moments[i];

    // Calculate gap: current start - (previous start + previous duration)
    const prevEndTime = prevMoment.timestamp.getTime() + prevMoment.duration * 1000;
    const currentStartTime = currentMoment.timestamp.getTime();
    const gapMs = currentStartTime - prevEndTime;

    // If gap is within threshold, add to current sequence
    if (gapMs <= SEQUENCE_GAP_THRESHOLD_SECONDS * 1000) {
      currentSequenceMoments.push(currentMoment);
    } else {
      // Gap too large, finalize current sequence and start new one
      sequences.push(createSequence(currentSequenceMoments));
      currentSequenceMoments = [currentMoment];
    }
  }

  // Don't forget the last sequence
  if (currentSequenceMoments.length > 0) {
    sequences.push(createSequence(currentSequenceMoments));
  }

  // Match events to sequences by timestamp overlap
  for (const event of events) {
    const eventTime = event.timestamp.getTime();
    for (const seq of sequences) {
      const seqStart = seq.startTime.getTime();
      const seqEnd = seq.endTime.getTime();
      if (eventTime >= seqStart && eventTime <= seqEnd) {
        seq.event = event;
        break;
      }
    }
  }

  return sequences;
}

/**
 * Create a VideoSequence from a list of consecutive moments
 */
function createSequence(moments: VideoMoment[]): VideoSequence {
  const startTime = moments[0].timestamp;
  const lastMoment = moments[moments.length - 1];
  const endTime = new Date(lastMoment.timestamp.getTime() + lastMoment.duration * 1000);

  // Calculate total duration and moment offsets
  let totalDuration = 0;
  const momentOffsets: number[] = [];

  for (const moment of moments) {
    momentOffsets.push(totalDuration);
    totalDuration += moment.duration;
  }

  // Format time range
  const startTimeStr = moments[0].time;
  const endTimeStr = endTime.toTimeString().split(' ')[0];
  const timeRange = `${startTimeStr} - ${endTimeStr}`;

  // Format date range (usually just one date)
  const dates = new Set(moments.map(m => m.date));
  const dateRange = dates.size === 1
    ? moments[0].date
    : `${moments[0].date} - ${lastMoment.date}`;

  return {
    id: `seq-${startTime.toISOString()}`,
    moments,
    startTime,
    endTime,
    totalDuration,
    clipCount: moments.length,
    dateRange,
    timeRange,
    durationFormatted: formatDuration(totalDuration),
    momentOffsets,
  };
}

/**
 * Given an absolute time within a sequence, find the moment index and local time
 *
 * Example (3 clips of 60s each):
 * - Absolute 0-60s   → Moment 0, local 0-60s
 * - Absolute 60-120s → Moment 1, local 0-60s
 * - Absolute 120-180s → Moment 2, local 0-60s
 */
export function findMomentForTime(
  sequence: VideoSequence,
  absoluteTime: number
): { momentIndex: number; localTime: number } {
  // Binary search for the moment containing this time
  const { momentOffsets, moments } = sequence;

  let left = 0;
  let right = moments.length - 1;

  while (left < right) {
    const mid = Math.floor((left + right + 1) / 2);
    if (momentOffsets[mid] <= absoluteTime) {
      left = mid;
    } else {
      right = mid - 1;
    }
  }

  const momentIndex = left;
  const localTime = absoluteTime - momentOffsets[momentIndex];

  return { momentIndex, localTime };
}

/**
 * Convert a moment index and local time to absolute sequence time
 */
export function toAbsoluteTime(
  sequence: VideoSequence,
  momentIndex: number,
  localTime: number
): number {
  if (momentIndex < 0 || momentIndex >= sequence.moments.length) {
    return 0;
  }
  return sequence.momentOffsets[momentIndex] + localTime;
}
