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

/** Parse TeslaCam folder structure from files */
export function parseFolderStructure(files: File[]): FolderStructure {
  const dateMap = new Map<string, Map<string, Map<string, File>>>();
  
  for (const file of files) {
    // Skip event.json files for the date/time parsing
    if (file.name === 'event.json') continue;
    
    // Parse Tesla filename format: YYYY-MM-DD_HH-MM-SS-angle.mp4
    const match = file.name.match(/^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})-(.+?)\.mp4$/i);
    if (!match) continue;
    
    const [, dateStr, timeStr, angle] = match;
    const angleKey = angle.toLowerCase().replace(/-/g, '_');
    
    if (!dateMap.has(dateStr)) {
      dateMap.set(dateStr, new Map());
    }
    const timeMap = dateMap.get(dateStr)!;
    
    if (!timeMap.has(timeStr)) {
      timeMap.set(timeStr, new Map());
    }
    const angleMap = timeMap.get(timeStr)!;
    
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
      const files: Record<string, File> = {};
      
      // Convert angle map to record
      for (const [angle, file] of angleMap) {
        files[angle] = file;
      }
      
      timeSlots.push({
        time: timeStr,
        displayTime: timeStr.replace(/-/g, ':'),
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
