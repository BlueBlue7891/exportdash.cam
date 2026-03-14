/**
 * Folder structure types for Tesla Dashcam folder import
 */

/** Video source category from TeslaCam folder structure */
export type VideoSource = 'recent' | 'saved' | 'sentry' | 'encrypted' | 'photobooth' | 'unknown';

/** Source category labels */
export const SOURCE_LABELS: Record<VideoSource, string> = {
  recent: 'Recent',
  saved: 'Saved',
  sentry: 'Sentry',
  encrypted: 'Encrypted',
  photobooth: 'Photo',
  unknown: 'Unknown',
};

/** Source category colors for UI */
export const SOURCE_COLORS: Record<VideoSource, string> = {
  recent: 'bg-blue-600/20 text-blue-400',
  saved: 'bg-green-600/20 text-green-400',
  sentry: 'bg-red-600/20 text-red-400',
  encrypted: 'bg-purple-600/20 text-purple-400',
  photobooth: 'bg-yellow-600/20 text-yellow-400',
  unknown: 'bg-gray-600/20 text-gray-400',
};

/** Represents a single timestamp entry with all 6 camera videos */
export interface TimeSlot {
  time: string;        // HH-MM-SS
  displayTime: string; // HH:MM:SS
  files: Record<string, File>; // angle -> File mapping
  sources: VideoSource[]; // Source categories for this time slot
}

/** Represents a single date entry with multiple time slots */
export interface DateEntry {
  date: string;        // YYYY-MM-DD
  displayDate: string; // YYYY-MM-DD
  timeSlots: TimeSlot[];
}

/** Parsed folder structure from TeslaCam directory */
export interface FolderStructure {
  dates: DateEntry[];
  allFiles: File[];
}

/** Detect video source from file path */
function detectSource(file: File): VideoSource {
  // Try multiple path sources: Tauri path, webkitRelativePath (browser folder import), or name
  const path = (file as any).tauriPath || (file as any).webkitRelativePath || file.name;
  const lowerPath = path.toLowerCase();
  
  if (lowerPath.includes('recentclips')) return 'recent';
  if (lowerPath.includes('savedclips')) return 'saved';
  if (lowerPath.includes('sentryclips')) return 'sentry';
  if (lowerPath.includes('encryptedclips')) return 'encrypted';
  if (lowerPath.includes('photobooth')) return 'photobooth';
  return 'unknown';
}

/** Parse TeslaCam folder structure from files (batched for performance) */
export function parseFolderStructure(files: File[]): FolderStructure {
  const dateMap = new Map<string, Map<string, { files: Map<string, File>; sources: Set<VideoSource> }>>();
  
  // Filter video files and event.json
  const videoFiles = files.filter(f => f.name.endsWith('.mp4') || f.name === 'event.json');
  
  for (const file of videoFiles) {
    // Skip event.json here - it's handled separately
    if (file.name === 'event.json') continue;
    // Parse Tesla filename format: YYYY-MM-DD_HH-MM-SS-angle.mp4
    const match = file.name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(.+?)\.mp4$/i);
    if (!match) continue;
    
    const [, year, month, day, hour, minute, second, angle] = match;
    const dateStr = `${year}-${month}-${day}`;
    const timeStr = `${hour}-${minute}-${second}`;
    const angleKey = angle.toLowerCase().replace(/-/g, '_');
    const source = detectSource(file);
    
    // Fast path - avoid repeated lookups
    let timeMap = dateMap.get(dateStr);
    if (!timeMap) {
      timeMap = new Map();
      dateMap.set(dateStr, timeMap);
    }
    
    let slotData = timeMap.get(timeStr);
    if (!slotData) {
      slotData = { files: new Map(), sources: new Set() };
      timeMap.set(timeStr, slotData);
    }
    
    slotData.files.set(angleKey, file);
    slotData.sources.add(source);
  }
  
  // Convert to sorted array structure
  const dates: DateEntry[] = [];
  const sortedDates = Array.from(dateMap.keys()).sort();
  
  for (const dateStr of sortedDates) {
    const timeMap = dateMap.get(dateStr)!;
    const timeSlots: TimeSlot[] = [];
    const sortedTimes = Array.from(timeMap.keys()).sort();
    
    for (const timeStr of sortedTimes) {
      const slotData = timeMap.get(timeStr)!;
      
      timeSlots.push({
        time: timeStr,
        displayTime: `${timeStr.slice(0, 2)}:${timeStr.slice(3, 5)}:${timeStr.slice(6, 8)}`,
        files: Object.fromEntries(slotData.files),
        sources: Array.from(slotData.sources),
      });
    }
    
    dates.push({
      date: dateStr,
      displayDate: dateStr,
      timeSlots,
    });
  }
  
  return {
    dates,
    allFiles: files,
  };
}

/** Parse folder structure asynchronously with progress callback */
export async function parseFolderStructureAsync(
  files: File[],
  onProgress?: (current: number, total: number) => void
): Promise<FolderStructure> {
  const dateMap = new Map<string, Map<string, { files: Map<string, File>; sources: Set<VideoSource> }>>();
  const videoFiles = files.filter(f => f.name.endsWith('.mp4') || f.name === 'event.json');
  const total = videoFiles.length;
  const BATCH_SIZE = 100;
  
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = videoFiles.slice(i, i + BATCH_SIZE);
    
    // Filter out event.json from batch processing
    const videoBatch = batch.filter(f => f.name !== 'event.json');
    
    for (const file of videoBatch) {
      const match = file.name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(.+?)\.mp4$/i);
      if (!match) continue;
      
      const [, year, month, day, hour, minute, second, angle] = match;
      const dateStr = `${year}-${month}-${day}`;
      const timeStr = `${hour}-${minute}-${second}`;
      const angleKey = angle.toLowerCase().replace(/-/g, '_');
      const source = detectSource(file);
      
      let timeMap = dateMap.get(dateStr);
      if (!timeMap) {
        timeMap = new Map();
        dateMap.set(dateStr, timeMap);
      }
      
      let slotData = timeMap.get(timeStr);
      if (!slotData) {
        slotData = { files: new Map(), sources: new Set() };
        timeMap.set(timeStr, slotData);
      }
      
      slotData.files.set(angleKey, file);
      slotData.sources.add(source);
    }
    
    onProgress?.(Math.min(i + BATCH_SIZE, total), total);
    
    if (i + BATCH_SIZE < total) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  
  const dates: DateEntry[] = [];
  const sortedDates = Array.from(dateMap.keys()).sort();
  
  for (const dateStr of sortedDates) {
    const timeMap = dateMap.get(dateStr)!;
    const timeSlots: TimeSlot[] = [];
    const sortedTimes = Array.from(timeMap.keys()).sort();
    
    for (const timeStr of sortedTimes) {
      const slotData = timeMap.get(timeStr)!;
      
      timeSlots.push({
        time: timeStr,
        displayTime: `${timeStr.slice(0, 2)}:${timeStr.slice(3, 5)}:${timeStr.slice(6, 8)}`,
        files: Object.fromEntries(slotData.files),
        sources: Array.from(slotData.sources),
      });
    }
    
    dates.push({
      date: dateStr,
      displayDate: dateStr,
      timeSlots,
    });
  }
  
  return {
    dates,
    allFiles: files,
  };
}

/** Get all files for a specific time slot */
export function getFilesForTimeSlot(timeSlot: TimeSlot): File[] {
  return Object.values(timeSlot.files);
}

/** Check if time slot has all 6 cameras */
export function hasAllCameras(timeSlot: TimeSlot): boolean {
  const requiredAngles = ['front', 'back', 'left_repeater', 'right_repeater', 'left_pillar', 'right_pillar'];
  return requiredAngles.every(angle => angle in timeSlot.files);
}

/** Get available cameras count */
export function getCameraCount(timeSlot: TimeSlot): number {
  return Object.keys(timeSlot.files).length;
}
