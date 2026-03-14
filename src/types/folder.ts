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
export async function parseFolderStructure(files: File[]): Promise<FolderStructure> {
  const dateMap = new Map<string, Map<string, { files: Map<string, File>; sources: Set<VideoSource>; hasGps: boolean; reason?: string; city?: string; street?: string }>>();
  
  // Collect event.json data by directory: { timeSeconds, reason, city, street }
  const eventJsonData = new Map<string, { timeSeconds: number; reason: string; city?: string; street?: string }>();
  
  // Filter video files and event.json
  const videoFiles = files.filter(f => f.name.endsWith('.mp4') || f.name === 'event.json');
  
  // First pass: parse all event.json files
  const jsonFiles = videoFiles.filter(f => f.name === 'event.json');
  for (const file of jsonFiles) {
    const path = (file as any).webkitRelativePath || (file as any).tauriPath || '';
    const dir = path.substring(0, path.lastIndexOf('/'));
    
    let eventSeconds: number | undefined;
    let reason = '';
    let city: string | undefined;
    let street: string | undefined;
    
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.timestamp) {
        const d = new Date(data.timestamp);
        eventSeconds = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
      }
      if (data.reason) {
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
      const folderName = dir.substring(dir.lastIndexOf('/') + 1);
      const match = folderName.match(/\d{4}-\d{2}-\d{2}_(\d{2})-(\d{2})-(\d{2})/);
      if (match) {
        const [, hour, minute, second] = match;
        eventSeconds = parseInt(hour) * 3600 + parseInt(minute) * 60 + parseInt(second);
      }
    }
    
    if (eventSeconds !== undefined) {
      eventJsonData.set(dir, { timeSeconds: eventSeconds, reason, city, street });
    }
  }
  
  // Collect all video time slots per directory
  const dirVideoSlots = new Map<string, { timeStr: string; startSeconds: number }[]>();
  
  for (const file of videoFiles) {
    if (file.name === 'event.json') continue;
    
    const match = file.name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(.+?)\.mp4$/i);
    if (!match) continue;
    
    const [, year, month, day, hour, minute, second] = match;
    const timeStr = `${hour}-${minute}-${second}`;
    const startSeconds = parseInt(hour) * 3600 + parseInt(minute) * 60 + parseInt(second);
    
    const filePath = (file as any).webkitRelativePath || (file as any).tauriPath || '';
    const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
    
    if (!dirVideoSlots.has(fileDir)) {
      dirVideoSlots.set(fileDir, []);
    }
    dirVideoSlots.get(fileDir)!.push({ timeStr, startSeconds });
  }
  
  // Find which time slot contains the event for each directory
  // Map: dir -> { timeStr, reason, city, street }
  const eventSlotMap = new Map<string, { timeStr: string; reason: string; city?: string; street?: string }>();
  for (const [dir, slots] of dirVideoSlots) {
    const eventData = eventJsonData.get(dir);
    if (!eventData) continue;
    
    slots.sort((a, b) => a.startSeconds - b.startSeconds);
    
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
    const source = detectSource(file);
    
    // Check if this specific time slot contains the event
    const filePath = (file as any).webkitRelativePath || (file as any).tauriPath || '';
    const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
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
      
      timeSlots.push({
        time: timeStr,
        displayTime: `${timeStr.slice(0, 2)}:${timeStr.slice(3, 5)}:${timeStr.slice(6, 8)}`,
        files: Object.fromEntries(slotData.files),
        sources: Array.from(slotData.sources),
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
  
  // Collect event.json timestamps by directory
  const eventJsonTimes = new Map<string, number>();
  
  const videoFiles = files.filter(f => f.name.endsWith('.mp4') || f.name === 'event.json');
  
  // First pass: parse all event.json files
  // Read actual JSON content for precise timestamp
  const jsonFiles = videoFiles.filter(f => f.name === 'event.json');
  for (const file of jsonFiles) {
    const path = (file as any).webkitRelativePath || (file as any).tauriPath || '';
    const dir = path.substring(0, path.lastIndexOf('/'));
    
    let eventSeconds: number | undefined;
    
    try {
      // Try to read actual timestamp from JSON content
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.timestamp) {
        const d = new Date(data.timestamp);
        eventSeconds = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
      }
    } catch (e) {
      // Fallback: parse from folder name
      const folderName = dir.substring(dir.lastIndexOf('/') + 1);
      const match = folderName.match(/\d{4}-\d{2}-\d{2}_(\d{2})-(\d{2})-(\d{2})/);
      if (match) {
        const [, hour, minute, second] = match;
        eventSeconds = parseInt(hour) * 3600 + parseInt(minute) * 60 + parseInt(second);
      }
    }
    
    if (eventSeconds !== undefined) {
      eventJsonTimes.set(dir, eventSeconds);
    }
  }
  
  // Collect all video time slots per directory
  const dirVideoSlots = new Map<string, { timeStr: string; startSeconds: number }[]>();
  
  for (const file of videoFiles) {
    if (file.name === 'event.json') continue;
    
    const match = file.name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(.+?)\.mp4$/i);
    if (!match) continue;
    
    const [, year, month, day, hour, minute, second] = match;
    const timeStr = `${hour}-${minute}-${second}`;
    const startSeconds = parseInt(hour) * 3600 + parseInt(minute) * 60 + parseInt(second);
    
    const filePath = (file as any).webkitRelativePath || (file as any).tauriPath || '';
    const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
    
    if (!dirVideoSlots.has(fileDir)) {
      dirVideoSlots.set(fileDir, []);
    }
    dirVideoSlots.get(fileDir)!.push({ timeStr, startSeconds });
  }
  
  // Find which time slot contains the event for each directory
  const eventSlotMap = new Map<string, string>();
  for (const [dir, slots] of dirVideoSlots) {
    const eventSeconds = eventJsonTimes.get(dir);
    if (eventSeconds === undefined) continue;
    
    slots.sort((a, b) => a.startSeconds - b.startSeconds);
    
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
      const source = detectSource(file);
      
      const filePath = (file as any).webkitRelativePath || (file as any).tauriPath || '';
      const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
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
