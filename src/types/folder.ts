/**
 * Folder structure types for Tesla Dashcam folder import
 */

/** Represents a single timestamp entry with all 6 camera videos */
export interface TimeSlot {
  time: string;        // HH-MM-SS
  displayTime: string; // HH:MM:SS
  files: Record<string, File>; // angle -> File mapping
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

/** Parse TeslaCam folder structure from files (batched for performance) */
export function parseFolderStructure(files: File[]): FolderStructure {
  const dateMap = new Map<string, Map<string, Map<string, File>>>();
  
  // Filter only video files first to reduce iteration
  const videoFiles = files.filter(f => f.name.endsWith('.mp4'));
  
  for (const file of videoFiles) {
    // Parse Tesla filename format: YYYY-MM-DD_HH-MM-SS-angle.mp4
    // Use a more specific regex for better performance
    const match = file.name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(.+?)\.mp4$/i);
    if (!match) continue;
    
    const [, year, month, day, hour, minute, second, angle] = match;
    const dateStr = `${year}-${month}-${day}`;
    const timeStr = `${hour}-${minute}-${second}`;
    const angleKey = angle.toLowerCase().replace(/-/g, '_');
    
    // Fast path - avoid repeated lookups
    let timeMap = dateMap.get(dateStr);
    if (!timeMap) {
      timeMap = new Map();
      dateMap.set(dateStr, timeMap);
    }
    
    let angleMap = timeMap.get(timeStr);
    if (!angleMap) {
      angleMap = new Map();
      timeMap.set(timeStr, angleMap);
    }
    
    angleMap.set(angleKey, file);
  }
  
  // Convert to sorted array structure
  const dates: DateEntry[] = [];
  const sortedDates = Array.from(dateMap.keys()).sort();
  
  for (const dateStr of sortedDates) {
    const timeMap = dateMap.get(dateStr)!;
    const timeSlots: TimeSlot[] = [];
    const sortedTimes = Array.from(timeMap.keys()).sort();
    
    for (const timeStr of sortedTimes) {
      const angleMap = timeMap.get(timeStr)!;
      // Convert Map to object using Object.fromEntries (faster than manual iteration)
      const files: Record<string, File> = Object.fromEntries(angleMap);
      
      timeSlots.push({
        time: timeStr,
        displayTime: `${timeStr.slice(0, 2)}:${timeStr.slice(3, 5)}:${timeStr.slice(6, 8)}`,
        files,
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
  const dateMap = new Map<string, Map<string, Map<string, File>>>();
  const videoFiles = files.filter(f => f.name.endsWith('.mp4'));
  const total = videoFiles.length;
  const BATCH_SIZE = 100; // Process 100 files at a time
  
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = videoFiles.slice(i, i + BATCH_SIZE);
    
    // Process batch
    for (const file of batch) {
      const match = file.name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(.+?)\.mp4$/i);
      if (!match) continue;
      
      const [, year, month, day, hour, minute, second, angle] = match;
      const dateStr = `${year}-${month}-${day}`;
      const timeStr = `${hour}-${minute}-${second}`;
      const angleKey = angle.toLowerCase().replace(/-/g, '_');
      
      let timeMap = dateMap.get(dateStr);
      if (!timeMap) {
        timeMap = new Map();
        dateMap.set(dateStr, timeMap);
      }
      
      let angleMap = timeMap.get(timeStr);
      if (!angleMap) {
        angleMap = new Map();
        timeMap.set(timeStr, angleMap);
      }
      
      angleMap.set(angleKey, file);
    }
    
    // Report progress
    onProgress?.(Math.min(i + BATCH_SIZE, total), total);
    
    // Yield to main thread
    if (i + BATCH_SIZE < total) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  
  // Convert to sorted array
  const dates: DateEntry[] = [];
  const sortedDates = Array.from(dateMap.keys()).sort();
  
  for (const dateStr of sortedDates) {
    const timeMap = dateMap.get(dateStr)!;
    const timeSlots: TimeSlot[] = [];
    const sortedTimes = Array.from(timeMap.keys()).sort();
    
    for (const timeStr of sortedTimes) {
      const angleMap = timeMap.get(timeStr)!;
      const files: Record<string, File> = Object.fromEntries(angleMap);
      
      timeSlots.push({
        time: timeStr,
        displayTime: `${timeStr.slice(0, 2)}:${timeStr.slice(3, 5)}:${timeStr.slice(6, 8)}`,
        files,
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
