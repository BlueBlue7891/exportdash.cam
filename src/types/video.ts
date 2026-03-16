/**
 * Video Types for Tesla Dashcam Viewer
 *
 * Data hierarchy:
 * - VideoMoment: One timestamp (all camera angles at that moment)
 * - VideoSequence: Consecutive moments merged for seamless playback
 */

/** A single camera angle video file */
export interface CameraVideo {
  file: File;
  angle: string;           // e.g., 'front', 'back', 'left_repeater'
  angleLabel: string;      // Human-readable label
  duration: number;        // Duration in seconds
  durationFormatted: string | null;  // e.g., "1:00"
  size: string;            // Human-readable size
  url?: string;            // For Tauri: direct file URL (convertFileSrc)
}

/** One timestamp - all camera angles at a specific moment */
export interface VideoMoment {
  id: string;              // Unique identifier (timestamp-based)
  timestamp: Date;         // Actual timestamp from filename
  date: string;            // Date string (YYYY-MM-DD)
  time: string;            // Time string (HH:MM:SS)
  dateTime: string;        // Combined date/time for sorting
  videos: CameraVideo[];   // All camera angles for this moment
  duration: number;        // Duration in seconds (from front camera)
}

/** Processing progress state */
export interface ProcessingProgress {
  stage: 'scanning' | 'metadata' | 'ready' | 'error';
  current: number;         // Current file being processed
  total: number;           // Total files to process
  message?: string;        // Optional status message
}

/** A sequence of consecutive moments for seamless playback */
export interface VideoSequence {
  id: string;                    // Unique identifier
  moments: VideoMoment[];        // All moments in chronological order
  startTime: Date;               // Start timestamp
  endTime: Date;                 // End timestamp
  totalDuration: number;         // Total duration in seconds
  clipCount: number;             // Number of clips/moments

  // Computed properties for display
  dateRange: string;             // e.g., "2024-01-15"
  timeRange: string;             // e.g., "10:30:00 - 10:35:00"
  durationFormatted: string;     // e.g., "5:00"

  // Playback mapping: cumulative durations for seeking
  momentOffsets: number[];       // Start time offset for each moment

  // Optional event data from event.json
  event?: TeslaEvent;
}

/** Tesla event data from event.json */
export interface TeslaEvent {
  timestamp: Date;
  city?: string;
  street?: string;
  est_lat?: number;
  est_lon?: number;
  reason: string;
  reasonLabel: string;
  camera?: string;
}

/** Human-readable labels for Tesla event reasons */
export const REASON_LABELS: Record<string, string> = {
  user_interaction_dashcam_multifunction_selected: 'User Interaction Dashcam Multifunction Selected',
  user_interaction_dashcam_icon_tapped: 'User Interaction Dashcam Icon Tapped',
  user_interaction_dashcam_launcher_action_tapped: 'User Interaction Dashcam Launcher Action Tapped',
  user_interaction_honk: 'User Interaction Honk',
  sentry_aware_object_detection: 'Sentry Aware Object Detection',
  sentry_aware_accel: 'Sentry Aware Accel',
  sentry_aware_intrusion: 'Sentry Aware Intrusion',
  sentry_aware_proximity: 'Sentry Aware Proximity',
  sentry_ion: 'Sentry Mode On',
  sentry_ioff: 'Sentry Mode Off',
  dashcam_clip_request: 'Dashcam Clip Request',
  emergency_braking: 'Emergency Braking',
  forward_collision_warning: 'Forward Collision Warning',
  auto_emergency_braking: 'Auto Emergency Braking',
  ap_forward_collision: 'AP Forward Collision',
};

/** Get human-readable label for an event reason
 * Supports patterns like:
 * - sentry_panic_accel_0.903371 -> Sentry Panic Accel (0.90g)
 */
export function getReasonLabel(reason: string): string {
  // Check exact match first
  if (REASON_LABELS[reason]) {
    return REASON_LABELS[reason];
  }
  
  // Handle sentry_panic_accel_* pattern (e.g., sentry_panic_accel_0.903371)
  const panicAccelMatch = reason.match(/^sentry_panic_accel_([\d.]+)$/);
  if (panicAccelMatch) {
    const gForce = parseFloat(panicAccelMatch[1]);
    return `Sentry Panic Accel (${gForce.toFixed(2)}g)`;
  }
  
  // Handle sentry_panic_* patterns
  if (reason.startsWith('sentry_panic_')) {
    const panicType = reason.replace('sentry_panic_', '');
    const panicLabels: Record<string, string> = {
      accel: 'Accel',
      intrusion: 'Intrusion',
      proximity: 'Proximity',
      object: 'Object Detection',
    };
    const label = panicLabels[panicType] || panicType;
    return `Sentry Panic ${label}`;
  }
  
  return reason.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Angle constants and utilities */
export const ANGLE_LABELS: Record<string, string> = {
  front: 'Front',
  back: 'Rear',
  left_repeater: 'Left',
  right_repeater: 'Right',
  left_pillar: 'L Pillar',
  right_pillar: 'R Pillar',
};

export const ANGLE_ORDER = ['front', 'left_repeater', 'right_repeater', 'left_pillar', 'right_pillar', 'back'];

/** Camera layout configuration for multi-camera views */
export interface LayoutCameraConfig {
  pip: { corners: [string, string, string, string, string] }; // bottom-left, bottom-center, bottom-right, top-left, top-right
  triple: { cameras: [string, string, string] };               // left, center, right
  all: { 
    topRow: [string, string, string]; 
    bottomRow: [string, string, string];
    columnEnabled?: [boolean, boolean, boolean]; // Enable/disable each column (left, center, right)
  };
}

/** Special PiP corner values (besides camera angles) */
export const PIP_SPECIAL_OPTIONS = ['none', 'map'] as const;

export const DEFAULT_LAYOUT_CONFIG: LayoutCameraConfig = {
  // PiP: Left/Right on top, L Pillar/Rear/R Pillar on bottom
  pip: { corners: ['left_pillar', 'back', 'right_pillar', 'left_repeater', 'right_repeater'] },
  triple: { cameras: ['left_pillar', 'front', 'right_pillar'] },
  // All 6: Top row - Left, Front, Right; Bottom row - L Pillar, Rear, R Pillar
  all: {
    topRow: ['left_repeater', 'front', 'right_repeater'],
    bottomRow: ['left_pillar', 'back', 'right_pillar'],
    columnEnabled: [true, true, true], // All columns enabled by default
  },
};

const LAYOUT_CONFIG_KEY = 'tesla-cam-layout-config';

export function loadLayoutConfig(): LayoutCameraConfig {
  try {
    const stored = localStorage.getItem(LAYOUT_CONFIG_KEY);
    if (!stored) return { ...DEFAULT_LAYOUT_CONFIG };
    const parsed = JSON.parse(stored);
    // Merge with defaults to handle missing/corrupt fields
    return {
      pip: { corners: parsed?.pip?.corners?.length === 5 ? parsed.pip.corners : [...DEFAULT_LAYOUT_CONFIG.pip.corners] },
      triple: { cameras: parsed?.triple?.cameras?.length === 3 ? parsed.triple.cameras : [...DEFAULT_LAYOUT_CONFIG.triple.cameras] },
      all: {
        topRow: parsed?.all?.topRow?.length === 3 ? parsed.all.topRow : [...DEFAULT_LAYOUT_CONFIG.all.topRow],
        bottomRow: parsed?.all?.bottomRow?.length === 3 ? parsed.all.bottomRow : [...DEFAULT_LAYOUT_CONFIG.all.bottomRow],
        columnEnabled: parsed?.all?.columnEnabled?.length === 3 ? parsed.all.columnEnabled : [true, true, true],
      },
    };
  } catch {
    return { ...DEFAULT_LAYOUT_CONFIG };
  }
}

export function saveLayoutConfig(config: LayoutCameraConfig): void {
  try {
    localStorage.setItem(LAYOUT_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Silently fail if localStorage is full or unavailable
  }
}

/** Map size configuration */
export const DEFAULT_MAP_SIZE = 270; // 270px default (1.5x of original 180px)
export const MIN_MAP_SIZE = 150;
export const MAX_MAP_SIZE = 400;
export const MAP_SIZE_KEY = 'tesla-cam-map-size';

export function loadMapSize(): number {
  try {
    const stored = localStorage.getItem(MAP_SIZE_KEY);
    if (!stored) return DEFAULT_MAP_SIZE;
    const size = parseInt(stored, 10);
    if (isNaN(size)) return DEFAULT_MAP_SIZE;
    return Math.max(MIN_MAP_SIZE, Math.min(MAX_MAP_SIZE, size));
  } catch {
    return DEFAULT_MAP_SIZE;
  }
}

export function saveMapSize(size: number): void {
  try {
    const clampedSize = Math.max(MIN_MAP_SIZE, Math.min(MAX_MAP_SIZE, size));
    localStorage.setItem(MAP_SIZE_KEY, String(clampedSize));
  } catch {
    // Silently fail if localStorage is full or unavailable
  }
}

/** Trim points for video export */
export interface TrimPoints {
  inPoint: number;   // Start time in seconds
  outPoint: number;  // End time in seconds
}

/** Camera angle segment for multi-angle exports */
export interface CameraSegment {
  startTime: number;
  endTime: number;
  angle: string;     // 'front', 'back', etc.
}

/** Colors for camera angle visualization in timeline */
export const ANGLE_COLORS: Record<string, string> = {
  front: '#3B82F6',      // blue
  back: '#8B5CF6',       // purple
  left_repeater: '#22C55E',  // green
  right_repeater: '#F59E0B', // amber
  left_pillar: '#06B6D4',    // cyan
  right_pillar: '#EC4899',   // pink
};

/** Parse camera angle from filename */
export function parseAngle(filename: string): string | null {
  const lower = filename.toLowerCase();
  for (const angle of ANGLE_ORDER) {
    if (lower.includes(angle)) return angle;
  }
  return null;
}

/** Parse timestamp from Tesla dashcam filename */
export function parseTimestamp(filename: string): Date | null {
  // Tesla format: YYYY-MM-DD_HH-MM-SS-...
  const match = filename.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  // Create date in local time but treat it as if the components are local time
  // Use explicit string format to ensure consistent parsing
  const dateStr = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  return new Date(dateStr);
}

/** Format duration in seconds to MM:SS or MM:SS.mmm (3-digit ms) */
export function formatDuration(seconds: number, showMs: boolean = false): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  
  if (showMs) {
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Format file size to human-readable string */
export function formatFileSize(bytes: number): string {
  const sizeInMB = bytes / (1024 * 1024);
  return sizeInMB >= 1
    ? `${sizeInMB.toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(0)} KB`;
}
