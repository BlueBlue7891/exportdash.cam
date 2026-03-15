/**
 * Folder structure types for Tesla Dashcam folder import
 */

/** Video source category from TeslaCam folder structure */
export type VideoSource = 'recent' | 'saved' | 'sentry' | 'encrypted' | 'photobooth' | 'unknown';

/** Source category labels */
export const SOURCE_LABELS: Record<VideoSource, string> = {
  recent: 'RecentClips',
  saved: 'SavedClips',
  sentry: 'SentryClips',
  encrypted: 'EncryptedClips',
  photobooth: 'Photobooth',
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

/** Event reason mapping to Chinese labels */
export const EVENT_REASON_LABELS: Record<string, string> = {
  user_interaction_dashcam_icon_tapped: '手动保存',
  user_interaction_dashcam_multifunction_selected: '手动保存',
  user_interaction_dashcam_launcher_action_tapped: '手动保存',
  user_interaction_honk: '鸣笛保存',
  sentry_aware_object_detection: 'Sentry: 检测到物体',
  sentry_aware_accel: 'Sentry: 加速度异常',
  sentry_aware_intrusion: 'Sentry: 入侵检测',
  sentry_aware_proximity: 'Sentry: 接近检测',
  sentry_ion: 'Sentry 模式开启',
  sentry_ioff: 'Sentry 模式关闭',
  dashcam_clip_request: '行车记录仪片段',
  emergency_braking: '紧急制动',
  forward_collision_warning: '前向碰撞警告',
  auto_emergency_braking: '自动紧急制动',
  ap_forward_collision: 'Autopilot: 前向碰撞',
};

/** Get Chinese label for event reason
 * Supports patterns like:
 * - sentry_panic_accel_0.903371 -> Sentry: 加速度异常 (0.90g)
 * - sentry_aware_object_detection -> Sentry: 检测到物体
 */
export function getEventReasonLabel(reason: string): string {
  // Check exact match first
  if (EVENT_REASON_LABELS[reason]) {
    return EVENT_REASON_LABELS[reason];
  }
  
  // Handle sentry_panic_accel_* pattern (e.g., sentry_panic_accel_0.903371)
  const panicAccelMatch = reason.match(/^sentry_panic_accel_([\d.]+)$/);
  if (panicAccelMatch) {
    const gForce = parseFloat(panicAccelMatch[1]);
    return `Sentry: 加速度异常 (${gForce.toFixed(2)}g)`;
  }
  
  // Handle sentry_panic_* patterns
  if (reason.startsWith('sentry_panic_')) {
    const panicType = reason.replace('sentry_panic_', '');
    const panicLabels: Record<string, string> = {
      accel: '加速度异常',
      intrusion: '入侵检测',
      proximity: '接近检测',
      object: '物体检测',
    };
    const label = panicLabels[panicType] || panicType;
    return `Sentry: ${label}`;
  }
  
  // Fallback: format reason string
  return reason.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Represents a single timestamp entry with all 6 camera videos */
export interface TimeSlot {
  time: string;        // HH-MM-SS
  displayTime: string; // HH:MM:SS
  files: Record<string, File>; // angle -> File mapping
  sources: VideoSource[]; // Source categories for this time slot
  hasGps?: boolean;    // Whether this time slot has associated GPS data
  eventReason?: string; // Event reason label (e.g., '手动保存', 'Sentry: 检测到物体')
  city?: string;       // City from event.json
  street?: string;     // Street from event.json
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

/** Get directory from file path (handles both / and \ separators) */
function getFileDirectory(file: File): string {
  const path = (file as any).webkitRelativePath || (file as any).tauriPath || '';
  // Handle both Windows (\) and Unix (/) path separators
  const lastSlash = path.lastIndexOf('/');
  const lastBackslash = path.lastIndexOf('\\');
  const lastSep = Math.max(lastSlash, lastBackslash);
  return lastSep > 0 ? path.substring(0, lastSep) : '';
}

/** Get parent directory name (the folder directly containing the file's folder) */
function getParentFolderName(file: File): string {
  const dir = getFileDirectory(file); // e.g., "TeslaCam\SentryClips\2026-02-13_14-06-00"
  if (!dir) return '';
  
  // Normalize to forward slashes
  const normalized = dir.replace(/\\/g, '/');
  // Split into parts
  const parts = normalized.split('/').filter(p => p);
  
  // If we have at least 2 parts, return the parent of the last folder
  // e.g., ["TeslaCam", "SentryClips", "2026-02-13_14-06-00"] -> "SentryClips"
  if (parts.length >= 2) {
    return parts[parts.length - 2].toLowerCase();
  }
  
  return '';
}

/** Detect video source from file path or parent folder name */
function detectSource(file: File): VideoSource {
  // Try multiple path sources: Tauri path, webkitRelativePath (browser folder import), or name
  const path = (file as any).tauriPath || (file as any).webkitRelativePath || file.name;
  const lowerPath = path.toLowerCase();
  
  // Check full path first
  if (lowerPath.includes('recentclips')) return 'recent';
  if (lowerPath.includes('savedclips')) return 'saved';
  if (lowerPath.includes('sentryclips')) return 'sentry';
  if (lowerPath.includes('encryptedclips')) return 'encrypted';
  if (lowerPath.includes('photobooth')) return 'photobooth';
  
  // Check parent folder name (for subfolder imports like "2026-02-13_14-06-00")
  // Parent would be "SentryClips" or "SavedClips"
  const parentName = getParentFolderName(file);
  if (parentName.includes('recentclips')) return 'recent';
  if (parentName.includes('savedclips')) return 'saved';
  if (parentName.includes('sentryclips')) return 'sentry';
  if (parentName.includes('encryptedclips')) return 'encrypted';
  if (parentName.includes('photobooth')) return 'photobooth';
  
  return 'unknown';
}

/** Infer source from event.json reason when path detection fails */
function inferSourceFromReason(reason?: string): VideoSource | null {
  if (!reason) return null;
  const lowerReason = reason.toLowerCase();
  // Sentry-related reasons (sentry_aware_*, sentry_panic_*, sentry_ion, etc.)
  if (lowerReason.includes('sentry_')) return 'sentry';
  // Manual save reasons (user_interaction)
  if (lowerReason.includes('user_interaction_')) return 'saved';
  // Emergency/Autopilot reasons also go to saved
  if (lowerReason.includes('emergency') || lowerReason.includes('collision') || lowerReason.includes('braking')) return 'saved';
  // Dashcam clip requests (these are typically from saved clips)
  if (lowerReason.includes('dashcam_clip_request')) return 'saved';
  return null;
}

/** Parse TeslaCam folder structure from files (batched for performance) */
export async function parseFolderStructure(files: File[]): Promise<FolderStructure> {
  const dateMap = new Map<string, Map<string, { files: Map<string, File>; sources: Set<VideoSource>; hasGps: boolean; reason?: string; city?: string; street?: string }>>();
  
  // Collect event.json data by directory: { timeSeconds, reason, rawReason, city, street }
  const eventJsonData = new Map<string, { timeSeconds: number; reason: string; rawReason: string; city?: string; street?: string }>();
  
  // Filter video files and event.json
  const videoFiles = files.filter(f => f.name.endsWith('.mp4') || f.name === 'event.json');
  
  // First pass: parse all event.json files
  const jsonFiles = videoFiles.filter(f => f.name === 'event.json');
  for (const file of jsonFiles) {
    const dir = getFileDirectory(file);
    
    let eventSeconds: number | undefined;
    let reason = '';
    let rawReason = '';  // Original reason for source inference
    let city: string | undefined;
    let street: string | undefined;
    
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.timestamp) {
        // Parse timestamp as local time (Tesla event.json uses local time without timezone)
        const timestamp = data.timestamp;
        let d: Date;
        if (timestamp.includes('T')) {
          // ISO format: 2026-02-13T14:05:01
          // Parse manually to avoid timezone issues
          const [datePart, timePart] = timestamp.split('T');
          const [year, month, day] = datePart.split('-').map(Number);
          const [hour, minute, second] = timePart.split(':').map(Number);
          d = new Date(year, month - 1, day, hour, minute, second);
        } else {
          d = new Date(timestamp);
        }
        eventSeconds = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
      }
      if (data.reason) {
        rawReason = data.reason;
        reason = getEventReasonLabel(data.reason);
      }
      if (data.city) {
        city = data.city;
      }
      if (data.street) {
        street = data.street;
      }
    } catch (e) {
      // Fallback: parse from folder name
      const folderName = dir ? dir.replace(/\\/g, '/').split('/').pop() || '' : '';
      const match = folderName.match(/\d{4}-\d{2}-\d{2}_(\d{2})-(\d{2})-(\d{2})/);
      if (match) {
        const [, hour, minute, second] = match;
        eventSeconds = parseInt(hour) * 3600 + parseInt(minute) * 60 + parseInt(second);
      }
    }
    
    if (eventSeconds !== undefined) {
      eventJsonData.set(dir, { timeSeconds: eventSeconds, reason, rawReason, city, street });
    }
  }
  
  // Collect all video time slots per directory (unique time slots only, ignoring camera angles)
  const dirVideoSlots = new Map<string, Map<string, { timeStr: string; startSeconds: number }>>();
  
  for (const file of videoFiles) {
    if (file.name === 'event.json') continue;
    
    const match = file.name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(.+?)\.mp4$/i);
    if (!match) continue;
    
    const [, year, month, day, hour, minute, second] = match;
    const timeStr = `${hour}-${minute}-${second}`;
    const startSeconds = parseInt(hour) * 3600 + parseInt(minute) * 60 + parseInt(second);
    
    const fileDir = getFileDirectory(file);
    
    if (!dirVideoSlots.has(fileDir)) {
      dirVideoSlots.set(fileDir, new Map());
    }
    // Use timeStr as key to deduplicate (same timestamp from different cameras)
    dirVideoSlots.get(fileDir)!.set(timeStr, { timeStr, startSeconds });
  }
  
  // Find which time slot contains the event for each directory
  // Map: dir -> { timeStr, reason, city, street }
  const eventSlotMap = new Map<string, { timeStr: string; reason: string; city?: string; street?: string }>();
  for (const [dir, slotsMap] of dirVideoSlots) {
    const eventData = eventJsonData.get(dir);
    if (!eventData) continue;
    
    // Convert map to array and sort by start time
    const slots = Array.from(slotsMap.values()).sort((a, b) => a.startSeconds - b.startSeconds);
    
    // Find the slot that contains the event timestamp
    // A 60-second clip starting at time T contains timestamps in [T, T+60)
    for (const slot of slots) {
      if (eventData.timeSeconds >= slot.startSeconds && eventData.timeSeconds < slot.startSeconds + 60) {
        eventSlotMap.set(dir, { 
          timeStr: slot.timeStr, 
          reason: eventData.reason,
          city: eventData.city,
          street: eventData.street
        });
        break;
      }
    }
  }
  
  // Second pass: process video files and mark hasGps
  for (const file of videoFiles) {
    if (file.name === 'event.json') continue;
    
    // Parse Tesla filename format: YYYY-MM-DD_HH-MM-SS-angle.mp4
    const match = file.name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(.+?)\.mp4$/i);
    if (!match) continue;
    
    const [, year, month, day, hour, minute, second, angle] = match;
    const dateStr = `${year}-${month}-${day}`;
    const timeStr = `${hour}-${minute}-${second}`;
    const angleKey = angle.toLowerCase().replace(/-/g, '_');
    
    // Get file directory
    const fileDir = getFileDirectory(file);
    
    let source = detectSource(file);
    
    // If path detection fails, try to infer from event.json raw reason
    if (source === 'unknown') {
      const eventData = eventJsonData.get(fileDir);
      if (eventData?.rawReason) {
        const inferred = inferSourceFromReason(eventData.rawReason);
        if (inferred) source = inferred;
      }
    }
    
    // If still unknown, try to infer from the full directory path
    // This handles the case when user selects a subfolder like "2026-02-13_14-06-00"
    // and we need to check if the directory itself contains type hints
    if (source === 'unknown') {
      // Try to get source from the directory path using available path info
      const tauriPath = (file as any).tauriPath as string | undefined;
      if (tauriPath) {
        // For Tauri: tauriPath is the full absolute path, check parent directories
        const normalizedPath = tauriPath.replace(/\\/g, '/').toLowerCase();
        // Check the full path for type indicators
        if (normalizedPath.includes('sentryclips')) source = 'sentry';
        else if (normalizedPath.includes('savedclips')) source = 'saved';
        else if (normalizedPath.includes('recentclips')) source = 'recent';
        else if (normalizedPath.includes('encryptedclips')) source = 'encrypted';
        else if (normalizedPath.includes('photobooth')) source = 'photobooth';
      }
    }
    
    // Check if this specific time slot contains the event
    const eventInfo = eventSlotMap.get(fileDir);
    const hasGps = eventInfo?.timeStr === timeStr;
    const eventReason = hasGps ? eventInfo?.reason : undefined;
    const eventCity = hasGps ? eventInfo?.city : undefined;
    const eventStreet = hasGps ? eventInfo?.street : undefined;
    
    // Fast path - avoid repeated lookups
    let timeMap = dateMap.get(dateStr);
    if (!timeMap) {
      timeMap = new Map();
      dateMap.set(dateStr, timeMap);
    }
    
    let slotData = timeMap.get(timeStr);
    if (!slotData) {
      slotData = { files: new Map(), sources: new Set(), hasGps, reason: eventReason, city: eventCity, street: eventStreet };
      timeMap.set(timeStr, slotData);
    }
    
    slotData.files.set(angleKey, file);
    slotData.sources.add(source);
    // If any file in this slot has GPS, mark the slot as having GPS
    if (hasGps) {
      slotData.hasGps = true;
      slotData.reason = eventReason;
      slotData.city = eventCity;
      slotData.street = eventStreet;
    }
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
      
      // Fix: if source is unknown and we have event reason, infer source from reason
      let sources = Array.from(slotData.sources);
      if (sources.includes('unknown') && slotData.reason) {
        // Try to find a non-unknown source, or infer from event reason
        const nonUnknownSources = sources.filter(s => s !== 'unknown');
        if (nonUnknownSources.length === 0) {
          // All sources are unknown, try to infer from event reason
          // Map Chinese reason label back to source
          const reasonLower = slotData.reason.toLowerCase();
          if (reasonLower.includes('sentry')) {
            sources = ['sentry'];
          } else if (reasonLower.includes('手动') || reasonLower.includes('鸣笛') || reasonLower.includes('紧急') || reasonLower.includes('制动') || reasonLower.includes('碰撞')) {
            sources = ['saved'];
          }
        }
      }
      
      timeSlots.push({
        time: timeStr,
        displayTime: `${timeStr.slice(0, 2)}:${timeStr.slice(3, 5)}:${timeStr.slice(6, 8)}`,
        files: Object.fromEntries(slotData.files),
        sources,
        hasGps: slotData.hasGps,
        eventReason: slotData.reason,
        city: slotData.city,
        street: slotData.street,
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
  const dateMap = new Map<string, Map<string, { files: Map<string, File>; sources: Set<VideoSource>; hasGps: boolean }>>();
  
  // Collect event.json data by directory: { timeSeconds, rawReason }
  const eventJsonData = new Map<string, { timeSeconds: number; rawReason: string }>();
  
  const videoFiles = files.filter(f => f.name.endsWith('.mp4') || f.name === 'event.json');
  
  // First pass: parse all event.json files
  // Read actual JSON content for precise timestamp
  const jsonFiles = videoFiles.filter(f => f.name === 'event.json');
  for (const file of jsonFiles) {
    const dir = getFileDirectory(file);
    
    let eventSeconds: number | undefined;
    let rawReason = '';
    
    try {
      // Try to read actual timestamp from JSON content
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.timestamp) {
        // Parse timestamp as local time (Tesla event.json uses local time without timezone)
        const timestamp = data.timestamp;
        let d: Date;
        if (timestamp.includes('T')) {
          // ISO format: 2026-02-13T14:05:01
          // Parse manually to avoid timezone issues
          const [datePart, timePart] = timestamp.split('T');
          const [year, month, day] = datePart.split('-').map(Number);
          const [hour, minute, second] = timePart.split(':').map(Number);
          d = new Date(year, month - 1, day, hour, minute, second);
        } else {
          d = new Date(timestamp);
        }
        eventSeconds = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
      }
      if (data.reason) {
        rawReason = data.reason;
      }
    } catch (e) {
      // Fallback: parse from folder name
      const folderName = dir ? dir.replace(/\\/g, '/').split('/').pop() || '' : '';
      const match = folderName.match(/\d{4}-\d{2}-\d{2}_(\d{2})-(\d{2})-(\d{2})/);
      if (match) {
        const [, hour, minute, second] = match;
        eventSeconds = parseInt(hour) * 3600 + parseInt(minute) * 60 + parseInt(second);
      }
    }
    
    if (eventSeconds !== undefined) {
      eventJsonData.set(dir, { timeSeconds: eventSeconds, rawReason });
    }
  }
  
  // Collect all video time slots per directory (unique time slots only, ignoring camera angles)
  const dirVideoSlots = new Map<string, Map<string, { timeStr: string; startSeconds: number }>>();
  
  for (const file of videoFiles) {
    if (file.name === 'event.json') continue;
    
    const match = file.name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(.+?)\.mp4$/i);
    if (!match) continue;
    
    const [, year, month, day, hour, minute, second] = match;
    const timeStr = `${hour}-${minute}-${second}`;
    const startSeconds = parseInt(hour) * 3600 + parseInt(minute) * 60 + parseInt(second);
    
    const fileDir = getFileDirectory(file);
    
    if (!dirVideoSlots.has(fileDir)) {
      dirVideoSlots.set(fileDir, new Map());
    }
    // Use timeStr as key to deduplicate (same timestamp from different cameras)
    dirVideoSlots.get(fileDir)!.set(timeStr, { timeStr, startSeconds });
  }
  
  // Find which time slot contains the event for each directory
  const eventSlotMap = new Map<string, string>();
  for (const [dir, slotsMap] of dirVideoSlots) {
    const eventData = eventJsonData.get(dir);
    if (!eventData) continue;
    const eventSeconds = eventData.timeSeconds;
    
    // Convert map to array and sort by start time
    const slots = Array.from(slotsMap.values()).sort((a, b) => a.startSeconds - b.startSeconds);
    
    // Find the slot that contains the event timestamp
    for (const slot of slots) {
      if (eventSeconds >= slot.startSeconds && eventSeconds < slot.startSeconds + 60) {
        eventSlotMap.set(dir, slot.timeStr);
        break;
      }
    }
  }
  
  const total = videoFiles.length;
  const BATCH_SIZE = 100;
  
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = videoFiles.slice(i, i + BATCH_SIZE);
    const videoBatch = batch.filter(f => f.name !== 'event.json');
    
    for (const file of videoBatch) {
      const match = file.name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(.+?)\.mp4$/i);
      if (!match) continue;
      
      const [, year, month, day, hour, minute, second, angle] = match;
      const dateStr = `${year}-${month}-${day}`;
      const timeStr = `${hour}-${minute}-${second}`;
      const angleKey = angle.toLowerCase().replace(/-/g, '_');
      
      const fileDir = getFileDirectory(file);
      let source = detectSource(file);
      
      // If path detection fails, try to infer from event.json raw reason
      if (source === 'unknown') {
        const eventData = eventJsonData.get(fileDir);
        if (eventData?.rawReason) {
          const inferred = inferSourceFromReason(eventData.rawReason);
          if (inferred) source = inferred;
        }
      }
      
      // If still unknown, try to infer from the full directory path (Tauri only)
      if (source === 'unknown') {
        const tauriPath = (file as any).tauriPath as string | undefined;
        if (tauriPath) {
          const normalizedPath = tauriPath.replace(/\\/g, '/').toLowerCase();
          if (normalizedPath.includes('sentryclips')) source = 'sentry';
          else if (normalizedPath.includes('savedclips')) source = 'saved';
          else if (normalizedPath.includes('recentclips')) source = 'recent';
          else if (normalizedPath.includes('encryptedclips')) source = 'encrypted';
          else if (normalizedPath.includes('photobooth')) source = 'photobooth';
        }
      }
      
      const hasGps = eventSlotMap.get(fileDir) === timeStr;
      
      let timeMap = dateMap.get(dateStr);
      if (!timeMap) {
        timeMap = new Map();
        dateMap.set(dateStr, timeMap);
      }
      
      let slotData = timeMap.get(timeStr);
      if (!slotData) {
        slotData = { files: new Map(), sources: new Set(), hasGps };
        timeMap.set(timeStr, slotData);
      }
      
      slotData.files.set(angleKey, file);
      slotData.sources.add(source);
      if (hasGps) slotData.hasGps = true;
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
        hasGps: slotData.hasGps,
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
