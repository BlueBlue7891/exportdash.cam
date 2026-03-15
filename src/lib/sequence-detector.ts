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

/** Batch size for async processing - smaller for Tauri file reads */
const BATCH_SIZE = 10;

/** Max concurrent file reads to prevent overwhelming the system */
const MAX_CONCURRENT_READS = 5;

/** Skip duration detection for faster processing (Tesla clips are always 60s) */
const SKIP_DURATION_DETECTION = false;

/** Parse MP4 duration from file buffer by reading mvhd box */
function parseMp4Duration(buffer: ArrayBuffer): number | null {
  try {
    const view = new DataView(buffer);
    const length = buffer.byteLength;
    
    console.log('[Duration] Parsing MP4, buffer size:', length);
    
    // Log first 32 bytes for debugging
    let headerBytes = '';
    for (let i = 0; i < Math.min(32, length); i++) {
      headerBytes += view.getUint8(i).toString(16).padStart(2, '0') + ' ';
    }
    console.log('[Duration] First 32 bytes:', headerBytes);
    
    // Check if it's a valid MP4 (starts with ftyp)
    const ftypType = String.fromCharCode(
      view.getUint8(4),
      view.getUint8(5),
      view.getUint8(6),
      view.getUint8(7)
    );
    console.log('[Duration] File type:', ftypType);
    
    // Search for moov box
    let pos = 0;
    let boxCount = 0;
    while (pos + 8 <= length && boxCount < 50) {
      const size = view.getUint32(pos);
      const type = String.fromCharCode(
        view.getUint8(pos + 4),
        view.getUint8(pos + 5),
        view.getUint8(pos + 6),
        view.getUint8(pos + 7)
      );
      
      console.log(`[Duration] Box at ${pos}: type=${type}, size=${size}`);
      boxCount++;
      
      if (type === 'moov') {
        console.log('[Duration] Found moov box at', pos);
        // Found moov box, now search for mvhd inside it
        const moovStart = pos + 8;
        const moovEnd = Math.min(pos + (size === 1 ? 16 : size), length);
        let mvhdPos = moovStart;
        
        let subBoxCount = 0;
        while (mvhdPos + 8 <= moovEnd && mvhdPos < length && subBoxCount < 20) {
          const mvhdSize = view.getUint32(mvhdPos);
          const mvhdType = String.fromCharCode(
            view.getUint8(mvhdPos + 4),
            view.getUint8(mvhdPos + 5),
            view.getUint8(mvhdPos + 6),
            view.getUint8(mvhdPos + 7)
          );
          
          console.log(`[Duration]  Sub-box at ${mvhdPos}: type=${mvhdType}, size=${mvhdSize}`);
          subBoxCount++;
          
          if (mvhdType === 'mvhd') {
            console.log('[Duration] Found mvhd box at', mvhdPos);
            // Found mvhd box, parse duration
            const version = view.getUint8(mvhdPos + 8);
            const timescaleOffset = mvhdPos + 8 + (version === 1 ? 20 : 12);
            const durationOffset = mvhdPos + 8 + (version === 1 ? 28 : 16);
            
            console.log(`[Duration] mvhd version=${version}, timescaleOffset=${timescaleOffset}, durationOffset=${durationOffset}, bufferLength=${length}`);
            
            if (durationOffset + 8 <= length) {
              const timescale = view.getUint32(timescaleOffset);
              const duration = version === 1 
                ? Number((BigInt(view.getUint32(durationOffset)) << 32n) | BigInt(view.getUint32(durationOffset + 4)))
                : view.getUint32(durationOffset);
              
              console.log(`[Duration] timescale=${timescale}, duration=${duration}`);
              
              if (timescale > 0 && duration > 0) {
                const seconds = Math.round(duration / timescale);
                console.log(`[Duration] Parsed from MP4: ${seconds}s`);
                return seconds;
              }
            }
            return null;
          }
          
          // Move to next box
          const boxSize = mvhdSize === 1 ? 16 : (mvhdSize === 0 ? moovEnd - mvhdPos : mvhdSize);
          if (boxSize === 0 || boxSize > moovEnd - mvhdPos) break;
          mvhdPos += boxSize;
        }
        return null;
      }
      
      // Move to next box
      const boxSize = size === 1 ? 16 : (size === 0 ? length - pos : size);
      if (boxSize === 0 || boxSize > length - pos) break;
      pos += boxSize;
    }
    console.warn('[Duration] No moov box found in first', length, 'bytes');
    return null;
  } catch (e) {
    console.warn('[Duration] Failed to parse MP4:', e);
    return null;
  }
}

/** Get file size from Tauri path */
async function getTauriFileSize(tauriPath: string): Promise<number | null> {
  try {
    const { stat } = await import('@tauri-apps/plugin-fs');
    const fileStat = await stat(tauriPath);
    return fileStat.size;
  } catch (e) {
    console.warn('[Duration] Error getting file size:', e);
    return null;
  }
}

/** Read partial file data using FileHandle for large files */
async function readTauriFilePartial(tauriPath: string, offset: number, length: number): Promise<Uint8Array | null> {
  try {
    const { open, SeekMode } = await import('@tauri-apps/plugin-fs');
    const file = await open(tauriPath, { read: true });
    
    try {
      // Seek to offset from start
      await file.seek(offset, SeekMode.Start);
      
      // Read data using file.read method
      const buffer = new Uint8Array(length);
      const bytesRead = await file.read(buffer);
      
      // Handle null or undefined bytesRead
      if (bytesRead === null || bytesRead === undefined) {
        return null;
      }
      
      // If we read less than requested, truncate
      if (bytesRead < length) {
        return buffer.slice(0, bytesRead);
      }
      return buffer;
    } finally {
      await file.close();
    }
  } catch (e) {
    console.warn('[Duration] Error reading partial file:', e);
    return null;
  }
}

/** Read entire file (fallback for small files) */
async function readTauriFileData(tauriPath: string): Promise<Uint8Array | null> {
  try {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    return await readFile(tauriPath);
  } catch (e) {
    console.warn('[Duration] Error reading file:', e);
    return null;
  }
}

/** Read and parse MP4 duration from Tauri file path */
async function readTauriFileDuration(tauriPath: string, fileName: string): Promise<number | null> {
  try {
    console.log('[Duration] Reading Tauri file:', fileName);
    
    // Get file size first
    const fileSize = await getTauriFileSize(tauriPath);
    if (!fileSize) {
      console.warn('[Duration] Could not get file size for', fileName);
      return null;
    }
    console.log('[Duration] File size:', fileSize);
    
    // For files > 1MB, try partial reads (end first, then start)
    // For smaller files, read whole file
    
    if (fileSize > 1024 * 1024) {
      // Large file: try partial reads
      
      // Strategy 1: Try end first (most common for dashcam files with moov at end)
      const endOffset = Math.max(0, fileSize - 1024 * 1024);
      const endData = await readTauriFilePartial(tauriPath, endOffset, 1024 * 1024);
      
      if (endData) {
        // Parse moov from end data with file offset info
        const duration = parseMp4DurationFromEnd(endData, fileSize, endOffset);
        if (duration !== null) {
          console.log('[Duration] Found moov at end, duration:', duration);
          return duration;
        }
      }
      
      // Strategy 2: Try start
      console.log('[Duration] Moov not at end, trying start...');
      const startData = await readTauriFilePartial(tauriPath, 0, 1024 * 1024);
      
      if (startData) {
        const duration = parseMp4Duration(startData.buffer.slice(startData.byteOffset, startData.byteOffset + startData.byteLength) as ArrayBuffer);
        if (duration !== null) {
          console.log('[Duration] Found moov at start, duration:', duration);
          return duration;
        }
      }
      
      // Strategy 3: Read whole file (if still not found and file < 8MB)
      if (fileSize < 8 * 1024 * 1024) {
        console.log('[Duration] Trying full file read...');
        const fullData = await readTauriFileData(tauriPath);
        if (fullData) {
          const duration = parseMp4Duration(fullData.buffer.slice(fullData.byteOffset, fullData.byteOffset + fullData.byteLength) as ArrayBuffer);
          if (duration !== null) {
            console.log('[Duration] Found moov in full file, duration:', duration);
            return duration;
          }
        }
      }
    } else {
      // Small file: read whole file
      const content = await readTauriFileData(tauriPath);
      if (!content) return null;
      
      const duration = parseMp4Duration(content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer);
      if (duration !== null) {
        console.log('[Duration] Found moov in small file, duration:', duration);
        return duration;
      }
    }
    
    console.warn('[Duration] Could not find moov box in', fileName);
    return null;
  } catch (e) {
    console.warn('[Duration] Error reading Tauri file:', fileName, e);
    return null;
  }
}

/** Parse MP4 duration from end-of-file data (handles partial reads)
 * When moov is at file end, we read last 1MB. The moov box might start
 * anywhere in this buffer, and its size field is relative to file start.
 * We need to search backwards for moov box signature.
 */
function parseMp4DurationFromEnd(data: Uint8Array, fileSize: number, readOffset: number): number | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const length = data.byteLength;
  
  console.log('[Duration] Parsing from end data, buffer size:', length, 'fileSize:', fileSize, 'readOffset:', readOffset);
  
  // Search backwards for 'moov' signature (0x6D 0x6F 0x6F 0x76)
  // Start from end and work backwards
  for (let pos = length - 4; pos >= 4; pos--) {
    // Check for 'moov' at position pos (as box type)
    const type = String.fromCharCode(
      view.getUint8(pos),
      view.getUint8(pos + 1),
      view.getUint8(pos + 2),
      view.getUint8(pos + 3)
    );
    
    if (type === 'moov') {
      // Found moov signature, get size from 4 bytes before
      const size = view.getUint32(pos - 4);
      console.log('[Duration] Found moov at buffer pos', pos, 'size:', size);
      
      // Validate size is reasonable (moov box should be < 10MB)
      if (size > 0 && size < 10 * 1024 * 1024) {
        // Now parse mvhd inside this moov box
        // moov box starts at pos - 4, content starts at pos + 4
        const moovContentStart = pos + 4;
        const moovContentEnd = Math.min((pos - 4) + size - readOffset, length);
        
        // Search for mvhd inside moov content
        let mvhdPos = moovContentStart;
        while (mvhdPos + 8 <= moovContentEnd) {
          const boxSize = view.getUint32(mvhdPos);
          const boxType = String.fromCharCode(
            view.getUint8(mvhdPos + 4),
            view.getUint8(mvhdPos + 5),
            view.getUint8(mvhdPos + 6),
            view.getUint8(mvhdPos + 7)
          );
          
          if (boxType === 'mvhd') {
            console.log('[Duration] Found mvhd at', mvhdPos, 'size:', boxSize);
            // Parse mvhd
            const version = view.getUint8(mvhdPos + 8);
            const timescaleOffset = mvhdPos + 8 + (version === 1 ? 20 : 12);
            const durationOffset = mvhdPos + 8 + (version === 1 ? 28 : 16);
            
            if (durationOffset + 8 <= length) {
              const timescale = view.getUint32(timescaleOffset);
              const duration = version === 1 
                ? Number((BigInt(view.getUint32(durationOffset)) << 32n) | BigInt(view.getUint32(durationOffset + 4)))
                : view.getUint32(durationOffset);
              
              console.log('[Duration] mvhd version:', version, 'timescale:', timescale, 'duration:', duration);
              
              if (timescale > 0 && duration > 0) {
                const seconds = Math.round(duration / timescale);
                console.log('[Duration] Parsed from end data:', seconds, 'seconds');
                return seconds;
              }
            }
            return null;
          }
          
          // Move to next box within moov
          const nextPos = mvhdPos + (boxSize > 0 ? boxSize : 8);
          if (nextPos <= mvhdPos) break; // Prevent infinite loop
          mvhdPos = nextPos;
        }
      }
    }
  }
  
  console.log('[Duration] No moov found in end data');
  return null;
}

/** Get video duration - optimized for both Tauri and browser */
async function getVideoDuration(file: File): Promise<number> {
  const tauriPath = (file as any).tauriPath;
  const tauriUrl = (file as any).tauriUrl;
  
  // In Tauri environment, read file directly using native API
  if (tauriPath) {
    const duration = await readTauriFileDuration(tauriPath, file.name);
    if (duration && duration > 0 && isFinite(duration)) {
      return duration;
    }
    console.warn('[Duration] MP4 parse failed for', file.name, '- using default');
    return DEFAULT_VIDEO_DURATION;
  }
  
  // In browser environment, try HTMLVideoElement first, then MP4 parse as fallback
  // Use Promise.race to get the fastest valid result
  const htmlVideoPromise = new Promise<number>((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';

    const timeout = setTimeout(() => {
      URL.revokeObjectURL(url);
      console.warn('[Duration] Timeout for', file.name);
      resolve(0); // Return 0 to indicate failure
    }, 3000);

    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      const duration = video.duration && isFinite(video.duration) ? video.duration : 0;
      console.log(`[Duration] HTMLVideoElement for ${file.name}: ${duration.toFixed(2)}s`);
      resolve(duration);
    };

    video.onerror = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      console.warn('[Duration] Error loading', file.name);
      resolve(0);
    };

    video.src = url;
  });

  const mp4ParsePromise = new Promise<number>(async (resolve) => {
    try {
      // Read first 2MB of file for MP4 parsing
      const slice = file.slice(0, 2 * 1024 * 1024);
      const buffer = await slice.arrayBuffer();
      const duration = parseMp4Duration(buffer);
      if (duration) {
        console.log(`[Duration] MP4 parse for ${file.name}: ${duration}s`);
      }
      resolve(duration || 0);
    } catch (e) {
      resolve(0);
    }
  });

  // Race between HTMLVideoElement and MP4 parsing, use first valid result
  const result = await Promise.race([
    htmlVideoPromise.then(d => ({ source: 'video', duration: d })),
    mp4ParsePromise.then(d => ({ source: 'mp4', duration: d })),
    // Timeout fallback
    new Promise<{ source: string; duration: number }>(resolve => 
      setTimeout(() => resolve({ source: 'timeout', duration: 0 }), 3500)
    )
  ]);

  if (result.duration > 0 && isFinite(result.duration)) {
    return result.duration;
  }

  // If race failed, try the other method
  const otherResult = result.source === 'video' ? await mp4ParsePromise : await htmlVideoPromise;
  if (otherResult > 0 && isFinite(otherResult)) {
    return otherResult;
  }

  console.warn('[Duration] All methods failed for', file.name, '- using default');
  return DEFAULT_VIDEO_DURATION;
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
  const momentDurations = new Map<string, number>(); // Cache duration per moment (timestamp)
  
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
    // Optimized: For each moment (timestamp group), only read ONE video (front preferred)
    // All angles for the same timestamp have the same duration
    const momentGroups = new Map<string, { file: File; angle: string | null }[]>();
    
    for (const { file, angle, groupKey } of allGroupFiles) {
      if (!momentGroups.has(groupKey)) {
        momentGroups.set(groupKey, []);
      }
      momentGroups.get(groupKey)!.push({ file, angle });
    }
    
    // Create a list of representative files (one per moment, front preferred)
    const representatives: { file: File; groupKey: string; angle: string | null }[] = [];
    for (const [groupKey, files] of momentGroups) {
      // Prefer front camera, fallback to first available
      const frontFile = files.find(f => f.angle === 'front') || files[0];
      if (frontFile) {
        representatives.push({ file: frontFile.file, groupKey, angle: frontFile.angle });
      }
    }
    
    console.log(`[Duration] Processing ${representatives.length} representative files instead of ${allGroupFiles.length} total`);
    
    // Process representatives with limited concurrency
    for (let i = 0; i < representatives.length; i += MAX_CONCURRENT_READS) {
      const batch = representatives.slice(i, i + MAX_CONCURRENT_READS);
      
      await Promise.all(
        batch.map(async ({ file, groupKey }) => {
          const duration = await getVideoDuration(file);
          momentDurations.set(groupKey, duration);
          
          // Apply duration to all files in this moment
          const momentFiles = momentGroups.get(groupKey)!;
          for (const { file: f } of momentFiles) {
            fileDurations.set(f.name, duration);
          }
          
          processedCount += momentFiles.length;
          onProgress?.({
            stage: 'metadata',
            current: processedCount,
            total: videoFiles.length,
            message: `Processing ${file.name}...`,
          });
        })
      );
      
      // Small delay between batches to keep UI responsive
      if (i + MAX_CONCURRENT_READS < representatives.length) {
        await new Promise(resolve => setTimeout(resolve, 10));
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
