'use client';

import { useRef, useEffect, useState, useCallback, lazy, Suspense, ReactNode, useMemo } from 'react';
import { useSeiData } from '@/hooks/useSeiData';
import { TelemetryCard } from './TelemetryCard';
import { VideoSequence, ANGLE_LABELS, ANGLE_ORDER, VideoMoment, TrimPoints, CameraSegment, LayoutCameraConfig, DEFAULT_LAYOUT_CONFIG, loadLayoutConfig, saveLayoutConfig, loadMapSize, saveMapSize, DEFAULT_MAP_SIZE, MIN_MAP_SIZE, MAX_MAP_SIZE, formatDuration } from '@/types/video';
import { findMomentForTime, toAbsoluteTime } from '@/lib/sequence-detector';

/**
 * Find the camera segment for a given absolute time.
 * At boundary points (where one segment ends and another begins), 
 * returns the right-side segment (the one that starts at the boundary).
 */
function findSegmentForTime(segments: CameraSegment[], absoluteTime: number): CameraSegment | undefined {
  // Use a small epsilon to handle floating point precision issues
  const epsilon = 0.001;
  return segments.find(seg => absoluteTime >= seg.startTime - epsilon && absoluteTime < seg.endTime - epsilon);
}
import {
  IconArrowUp,
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowDownLeft,
  IconArrowDownRight,
  IconSquare,
  IconPictureInPicture,
  IconColumns3,
  IconLayoutGrid,
  IconBolt,
  IconMapPin,
  IconMaximize,
  IconMinimize,
  IconPlayerPlay,
  IconPlayerPause,
  IconRewindBackward15,
  IconRewindForward15,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconList,
  IconPlus,
  IconTrash,
  IconChevronDown,
  IconCheck,
  IconScissors,
  IconWand,

  IconClock,
  IconSettings2,
} from '@tabler/icons-react';
import { VideoExporter } from './VideoExporter';
import { LayoutConfigPopover } from './LayoutConfigPopover';
import { TelemetryTimeline } from './TelemetryTimeline';
import { Tooltip } from './Tooltip';

// Lazy load MapView to avoid SSR issues with Leaflet
const MapView = lazy(() => import('./MapView').then(mod => ({ default: mod.MapView })));

interface VideoPlayerProps {
  sequences: VideoSequence[];
  selectedSequence: VideoSequence | null;
  onSelectSequence: (sequence: VideoSequence) => void;
  onClear: () => void;
  onDeleteSequence?: (sequenceId: string) => void;
  onAddFiles: (files: File[]) => void;
  folderStructure?: { dates: { date: string; timeSlots: { time: string; files: Record<string, File> }[] }[] } | null;
  onOpenVideoBrowser?: () => void;
}

const ANGLE_ICONS: Record<string, ReactNode> = {
  front: <IconArrowUp size={14} />,
  back: <IconArrowDown size={14} />,
  left_repeater: <IconArrowDownLeft size={14} />,
  right_repeater: <IconArrowDownRight size={14} />,
  left_pillar: <IconArrowLeft size={14} />,
  right_pillar: <IconArrowRight size={14} />,
};

// Button order: back camera moved to last
const BUTTON_ORDER = ['front', 'left_repeater', 'right_repeater', 'left_pillar', 'right_pillar', 'back'];

type LayoutType = 'single' | 'pip' | 'triple' | 'all';

interface LayoutConfig {
  id: LayoutType;
  label: string;
  icon: ReactNode;
  description: string;
}

const LAYOUTS: LayoutConfig[] = [
  {
    id: 'single',
    label: 'Single',
    icon: <IconSquare size={14} />,
    description: 'One camera',
  },
  {
    id: 'pip',
    label: 'PiP',
    icon: <IconPictureInPicture size={14} />,
    description: 'Main + corners',
  },
  {
    id: 'triple',
    label: 'Triple',
    icon: <IconColumns3 size={14} />,
    description: 'Front + sides',
  },
  {
    id: 'all',
    label: 'All 6',
    icon: <IconLayoutGrid size={14} />,
    description: 'All cameras',
  },
];

export function VideoPlayer({
  sequences,
  selectedSequence: sequence,
  onSelectSequence,
  onClear,
  onDeleteSequence,
  onAddFiles,
  folderStructure,
  onOpenVideoBrowser,
}: VideoPlayerProps) {
  const [showSequenceMenu, setShowSequenceMenu] = useState(false);
  const mainVideoRef = useRef<HTMLVideoElement>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const lastSequenceIdRef = useRef<string | null>(null);
  const hasAutoEnabledTelemetryRef = useRef<boolean>(false);
  const hasAutoEnabledMapRef = useRef<boolean>(false);
  const hasAutoEnabledEventMarkerRef = useRef<boolean>(false);
  const prevEventMarkerInRangeRef = useRef<boolean>(true);

  // Playback state
  const [selectedAngle, setSelectedAngle] = useState<string>('front');
  const [layout, setLayout] = useState<LayoutType>('single');
  const [currentMomentIndex, setCurrentMomentIndex] = useState(0);
  const [localTime, setLocalTime] = useState(0);  // Time within current clip
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedUnit, setSpeedUnit] = useState<'mph' | 'kmh'>('kmh');
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showMap, setShowMap] = useState(true);
  const [showTelemetry, setShowTelemetry] = useState(true);
  const [showDateTime, setShowDateTime] = useState(true);
  const [showEventMarker, setShowEventMarker] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoAspectRatio, setVideoAspectRatio] = useState<number | null>(null);
  const [isTimelineDragging, setIsTimelineDragging] = useState(false);
  
  // Smooth animation refs
  const rafRef = useRef<number | null>(null);
  const lastTimeUpdateRef = useRef<number>(0);

  // Layout camera config
  const [layoutConfig, setLayoutConfig] = useState<LayoutCameraConfig>(DEFAULT_LAYOUT_CONFIG);
  const [showLayoutConfig, setShowLayoutConfig] = useState(false);

  // Map size config
  const [mapSize, setMapSize] = useState<number>(DEFAULT_MAP_SIZE);
  const [showMapSizeControl, setShowMapSizeControl] = useState(false);

  // Load layout config from localStorage on mount
  useEffect(() => {
    setLayoutConfig(loadLayoutConfig());
    setMapSize(loadMapSize());
  }, []);

  const handleMapSizeChange = useCallback((newSize: number) => {
    const clampedSize = Math.max(MIN_MAP_SIZE, Math.min(MAX_MAP_SIZE, newSize));
    setMapSize(clampedSize);
    saveMapSize(clampedSize);
  }, []);

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);
  const [isTrimming, setIsTrimming] = useState(false); // When true, show full timeline for trim adjustment
  const [trimPoints, setTrimPoints] = useState<TrimPoints | null>(null);
  const [cameraSegments, setCameraSegments] = useState<CameraSegment[]>([]);
  const [useCustomCameraTrack, setUseCustomCameraTrack] = useState(false);

  // Check if camera track has been customized (more than one segment)
  const hasCustomCameraTrack = useMemo(() => {
    return cameraSegments.length > 1;
  }, [cameraSegments]);
  
  // Get unique angles from camera track
  const cameraTrackUniqueAngles = useMemo(() => {
    const angles = new Set(cameraSegments.map(seg => seg.angle));
    return Array.from(angles);
  }, [cameraSegments]);
  
  // Check if triple view is compatible with current camera track
  const isTripleViewCompatible = useMemo(() => {
    if (!hasCustomCameraTrack) return true; // No custom track, always compatible
    return cameraTrackUniqueAngles.length === 3;
  }, [hasCustomCameraTrack, cameraTrackUniqueAngles]);
  
  // Get available angles for triple view palette (when no custom track)
  const tripleViewLayoutAngles = useMemo(() => {
    return layoutConfig.triple.cameras;
  }, [layoutConfig.triple.cameras]);

  // Handle layout config change with Camera Track sync
  const handleLayoutConfigChange = useCallback((newConfig: LayoutCameraConfig) => {
    const oldTripleAngles = layoutConfig.triple.cameras;
    
    setLayoutConfig(newConfig);
    saveLayoutConfig(newConfig);
    
    // Sync Camera Track with triple view layout changes
    if (layout === 'triple' && hasCustomCameraTrack && cameraSegments.length > 0) {
      const newTripleAngles = newConfig.triple.cameras;
      
      // Check if triple view angles changed
      const hasChanged = newTripleAngles.some((angle, idx) => angle !== oldTripleAngles[idx]);
      
      if (hasChanged) {
        // Check if this is just a swap/rearrangement (same angles, different positions)
        // or if new angles are introduced
        const oldSet = new Set(oldTripleAngles);
        const newSet = new Set(newTripleAngles);
        
        // Find angles that are completely new (not in old triple view)
        const newAnglesIntroduced = newTripleAngles.filter(a => !oldSet.has(a));
        // Find angles that are removed (not in new triple view)
        const anglesRemoved = oldTripleAngles.filter(a => !newSet.has(a));
        
        // Only update Camera Track if new angles are introduced (not just rearrangement)
        if (newAnglesIntroduced.length > 0 && anglesRemoved.length > 0) {
          // Create mapping: removed angle -> new angle
          const angleMapping: Record<string, string> = {};
          anglesRemoved.forEach((removedAngle, idx) => {
            const newAngle = newAnglesIntroduced[idx];
            if (newAngle) {
              angleMapping[removedAngle] = newAngle;
            }
          });
          
          // Update camera segments: only replace removed angles with new ones
          const updatedSegments = cameraSegments.map(seg => ({
            ...seg,
            angle: angleMapping[seg.angle] || seg.angle
          }));
          
          // Merge adjacent segments with same angle
          const merged: typeof cameraSegments = [];
          for (const seg of updatedSegments) {
            const last = merged[merged.length - 1];
            if (last && last.angle === seg.angle && Math.abs(last.endTime - seg.startTime) < 0.1) {
              last.endTime = seg.endTime;
            } else {
              merged.push({ ...seg });
            }
          }
          
          setCameraSegments(merged);
        }
        // If it's just a rearrangement (swap), don't update Camera Track
      }
    }
  }, [layout, hasCustomCameraTrack, cameraSegments, layoutConfig]);

  // Video URL management
  const [videoUrls, setVideoUrls] = useState<Record<string, string>>({});
  const [preloadedUrls, setPreloadedUrls] = useState<Record<string, string>>({});

  // Current moment from sequence
  const currentMoment = sequence?.moments[currentMomentIndex] || null;

  // Calculate absolute time and total duration
  const absoluteTime = useMemo(() => {
    if (!sequence) return 0;
    return toAbsoluteTime(sequence, currentMomentIndex, localTime);
  }, [sequence, currentMomentIndex, localTime]);

  const totalDuration = sequence?.totalDuration || 0;

  // Get the main video file for SEI data
  const mainVideo = currentMoment?.videos.find(v => v.angle === 'front') || currentMoment?.videos[0];

  const { seiData, isLoading, error, allSeiMessages, fps } = useSeiData(
    sequence,
    currentMomentIndex,
    absoluteTime
  );

  // Map SEI data with event.json GPS fallback
  const { mapSeiData, isEventJsonGps } = useMemo(() => {
    const hasSeiGps = seiData?.latitude_deg && seiData?.longitude_deg && seiData.latitude_deg !== 0 && seiData.longitude_deg !== 0;
    const hasEventGps = sequence?.event?.est_lat && sequence?.event?.est_lon;
    
    if (hasSeiGps) {
      return { mapSeiData: seiData, isEventJsonGps: false };
    }
    if (hasEventGps) {
      return { 
        mapSeiData: { ...(seiData || {}), latitude_deg: sequence!.event!.est_lat, longitude_deg: sequence!.event!.est_lon } as typeof seiData,
        isEventJsonGps: true 
      };
    }
    return { mapSeiData: seiData, isEventJsonGps: false };
  }, [seiData, sequence?.event]);

  // Check if GPS data is available (for button state)
  const hasGpsData = useMemo(() => {
    return !!(mapSeiData?.latitude_deg && mapSeiData?.longitude_deg && 
              mapSeiData.latitude_deg !== 0 && mapSeiData.longitude_deg !== 0);
  }, [mapSeiData]);

  // Check if Telemetry data is available (for button state)
  const hasTelemetryData = useMemo(() => {
    if (!seiData) return false;
    // Check for any non-zero telemetry field (based on actual SEI protobuf schema)
    const telemetryFields = [
      'vehicle_speed_mps',      // Vehicle speed (m/s)
      'accelerator_pedal_position', // Accelerator pedal position
      'steering_wheel_angle',   // Steering wheel angle
      'brake_applied',          // Brake applied (boolean)
      'linear_acceleration_mps2_x', // Acceleration X
      'linear_acceleration_mps2_y', // Acceleration Y
      'linear_acceleration_mps2_z', // Acceleration Z
      'heading_deg',            // Heading
      'gear_state',             // Gear state
      'autopilot_state',        // Autopilot state
      'blinker_on_left',        // Left blinker
      'blinker_on_right',       // Right blinker
    ];
    return telemetryFields.some(field => {
      const value = (seiData as any)[field];
      // For booleans, check if defined; for numbers, check if non-zero
      if (typeof value === 'boolean') return value === true;
      return value !== undefined && value !== null && value !== 0;
    });
  }, [seiData]);

  // Reset state when sequence changes (including duration/moments changes)
  useEffect(() => {
    if (sequence && sequence.moments.length > 0) {
      setCurrentMomentIndex(0);
      setLocalTime(0);
      setIsPlaying(false);

      // Auto-select first available angle (prefer front)
      const firstMoment = sequence.moments[0];
      const frontVideo = firstMoment.videos.find(v => v.angle === 'front');
      const defaultAngle = frontVideo?.angle || firstMoment.videos[0]?.angle || 'front';
      setSelectedAngle(defaultAngle);

      // Reset edit mode state
      setIsEditMode(false);
      setIsTrimming(false);
      setTrimPoints({ inPoint: 0, outPoint: sequence.totalDuration });
      setCameraSegments([{ startTime: 0, endTime: sequence.totalDuration, angle: defaultAngle }]);
      setUseCustomCameraTrack(false);

      // Auto-adjust overlay visibility based on data availability
      // Wait for SEI data to load first
      const timer = setTimeout(() => {
        // These will be updated after hasGpsData and hasTelemetryData are calculated
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [sequence?.id, sequence?.totalDuration, sequence?.moments?.length]);

  // Auto-enable custom camera track when user adds segments
  useEffect(() => {
    if (hasCustomCameraTrack && !useCustomCameraTrack) {
      setUseCustomCameraTrack(true);
    }
  }, [hasCustomCameraTrack, useCustomCameraTrack]);

  // Auto-disable custom camera track when only one segment remains
  // and sync selectedAngle with the remaining segment
  useEffect(() => {
    if (!hasCustomCameraTrack && useCustomCameraTrack) {
      setUseCustomCameraTrack(false);
      // Sync selectedAngle with the remaining segment's angle
      if (cameraSegments.length === 1) {
        setSelectedAngle(cameraSegments[0].angle);
      }
    }
  }, [hasCustomCameraTrack, useCustomCameraTrack, cameraSegments]);

  // Auto-adjust overlay visibility based on data availability
  // Auto-enable when switching to a new sequence or when data becomes available
  useEffect(() => {
    const isNewSequence = lastSequenceIdRef.current !== sequence?.id;
    
    if (isNewSequence && sequence) {
      // Reset auto-enable flags for new sequence
      hasAutoEnabledTelemetryRef.current = false;
      hasAutoEnabledMapRef.current = false;
      hasAutoEnabledEventMarkerRef.current = false;
      lastSequenceIdRef.current = sequence.id;
    }
    
    // Auto-enable telemetry when data becomes available (only once per sequence)
    if (hasTelemetryData && !hasAutoEnabledTelemetryRef.current) {
      setShowTelemetry(true);
      hasAutoEnabledTelemetryRef.current = true;
    }
    
    // Auto-enable map when data becomes available (only once per sequence)
    if (hasGpsData && !hasAutoEnabledMapRef.current) {
      setShowMap(true);
      hasAutoEnabledMapRef.current = true;
    }
    
    // Auto-enable event marker when event data becomes available (only once per sequence)
    if (sequence?.event && !hasAutoEnabledEventMarkerRef.current) {
      setShowEventMarker(true);
      hasAutoEnabledEventMarkerRef.current = true;
    }
    
    // Auto-disable when data becomes unavailable
    if (!hasGpsData) {
      setShowMap(false);
      hasAutoEnabledMapRef.current = false;
    }
    if (!sequence?.event) {
      setShowEventMarker(false);
      hasAutoEnabledEventMarkerRef.current = false;
    }
    if (!hasTelemetryData) {
      setShowTelemetry(false);
      hasAutoEnabledTelemetryRef.current = false;
    }
  }, [hasGpsData, hasTelemetryData, sequence?.id, sequence?.event]);

  // Check if event marker is within trim range
  const isEventMarkerInTrimRange = useMemo(() => {
    if (!sequence?.event || !sequence.startTime) return true; // No event or start time, always "in range"
    
    const eventOffsetSeconds = (sequence.event.timestamp.getTime() - sequence.startTime.getTime()) / 1000;
    
    // If no trim points, use default range [0, duration] with buffer for post-video events
    const inPoint = trimPoints?.inPoint ?? 0;
    const rawOutPoint = trimPoints?.outPoint ?? sequence.totalDuration;
    
    // Check if we're in "default" state (no actual trimming applied)
    const isDefaultTrim = inPoint === 0 && rawOutPoint === sequence.totalDuration;
    
    // If in default state AND event is after video end, extend the effective out point to show it
    // This matches TelemetryTimeline's behavior for default view
    // When user has actually trimmed (not default), respect their trim choice strictly
    let effectiveOutPoint = rawOutPoint;
    if (isDefaultTrim && eventOffsetSeconds > sequence.totalDuration) {
      // Default state, event is after video end, add buffer to accommodate it
      const eventBuffer = eventOffsetSeconds - rawOutPoint + 1; // 1 second after event
      effectiveOutPoint = rawOutPoint + Math.max(eventBuffer, 0.5); // At least 0.5s buffer
    }
    
    return eventOffsetSeconds >= inPoint && eventOffsetSeconds <= effectiveOutPoint;
  }, [sequence?.event, sequence?.startTime, sequence?.totalDuration, trimPoints]);
  
  // Track previous trimming state to detect when exiting trim mode
  const prevIsTrimmingRef = useRef(isTrimming);
  
  // Handle event marker visibility when exiting trim mode
  useEffect(() => {
    const wasTrimming = prevIsTrimmingRef.current;
    
    // Exiting trim mode: check if event is outside trim range and disable if so
    if (wasTrimming && !isTrimming && !isEventMarkerInTrimRange) {
      setShowEventMarker(false);
    }
    
    prevIsTrimmingRef.current = isTrimming;
  }, [isTrimming, isEventMarkerInTrimRange]);

  // Create object URLs for current moment's videos
  useEffect(() => {
    if (!currentMoment) {
      setVideoUrls({});
      return;
    }

    const urls: Record<string, string> = {};
    for (const video of currentMoment.videos) {
      // Use Tauri URL if available, otherwise create object URL
      if (video.url) {
        urls[video.angle] = video.url;
      } else {
        urls[video.angle] = URL.createObjectURL(video.file);
      }
    }
    setVideoUrls(urls);

    return () => {
      // Only revoke URLs we created via createObjectURL, not Tauri asset URLs
      Object.entries(urls).forEach(([angle, url]) => {
        const video = currentMoment.videos.find(v => v.angle === angle);
        if (video && !video.url) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [currentMoment?.id]);

  // Preload next moment's videos for seamless transition
  useEffect(() => {
    if (!sequence || currentMomentIndex >= sequence.moments.length - 1) {
      setPreloadedUrls({});
      return;
    }

    const nextMoment = sequence.moments[currentMomentIndex + 1];
    const urls: Record<string, string> = {};
    for (const video of nextMoment.videos) {
      if (video.url) {
        urls[video.angle] = video.url;
      } else {
        urls[video.angle] = URL.createObjectURL(video.file);
      }
    }
    setPreloadedUrls(urls);

    return () => {
      Object.entries(urls).forEach(([angle, url]) => {
        const video = nextMoment.videos.find(v => v.angle === angle);
        if (video && !video.url) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [sequence?.id, currentMomentIndex]);

  // Track play promises to handle abort errors
  const playPromisesRef = useRef<Record<string, Promise<void> | null>>({});
  
  // Get currently visible angles based on layout
  const getVisibleAngles = useCallback((): string[] => {
    if (!currentMoment) return [];
    const available = currentMoment.videos.map(v => v.angle);
    
    switch (layout) {
      case 'single':
        return [selectedAngle];
      case 'pip':
        // For PiP, return configured corner angles (no dynamic substitution)
        return [selectedAngle, ...layoutConfig.pip.corners.filter(c => c !== 'none' && c !== 'map' && available.includes(c))];
      case 'triple':
        return layoutConfig.triple.cameras.filter(c => available.includes(c));
      case 'all':
        return [...layoutConfig.all.topRow, ...layoutConfig.all.bottomRow].filter(c => available.includes(c));
      default:
        return [selectedAngle];
    }
  }, [layout, selectedAngle, layoutConfig, currentMoment]);
  
  // Safe play function that handles abort errors
  const safePlay = useCallback(async (video: HTMLVideoElement | null, angle: string) => {
    if (!video || video.paused === false) return;
    
    // Cancel any existing play promise for this angle
    const existingPromise = playPromisesRef.current[angle];
    if (existingPromise) {
      try {
        await existingPromise;
      } catch {
        // Ignore errors from previous play attempts
      }
    }
    
    try {
      const playPromise = video.play();
      playPromisesRef.current[angle] = playPromise;
      await playPromise;
    } catch (err: any) {
      // Ignore AbortError as it's expected when switching layouts
      if (err?.name !== 'AbortError') {
        console.warn(`Failed to play video ${angle}:`, err);
      }
    } finally {
      playPromisesRef.current[angle] = null;
    }
  }, []);
  
  // Safe pause function
  const safePause = useCallback((video: HTMLVideoElement | null, angle: string) => {
    if (!video || video.paused) return;
    
    try {
      video.pause();
    } catch (err: any) {
      // Ignore errors from pause attempts
      if (err?.name !== 'AbortError') {
        console.warn(`Failed to pause video ${angle}:`, err);
      }
    }
  }, []);
  
  // Sync all videos to main video time
  const syncVideos = useCallback((targetTime?: number) => {
    const mainTime = targetTime ?? mainVideoRef.current?.currentTime ?? 0;
    const visibleAngles = getVisibleAngles();
    
    // Only sync visible videos to reduce overhead
    // Include all visible angles, including those matching selectedAngle (for PiP layout)
    Object.entries(videoRefs.current).forEach(([angle, video]) => {
      if (video && visibleAngles.includes(angle)) {
        // Only update if difference is significant (> 0.2s) to reduce jitter
        if (Math.abs(video.currentTime - mainTime) > 0.2) {
          video.currentTime = mainTime;
        }
      }
    });
    if (targetTime !== undefined && mainVideoRef.current) {
      mainVideoRef.current.currentTime = targetTime;
      setLocalTime(targetTime);
    }
  }, [selectedAngle, getVisibleAngles]);

  // Fallback timeupdate handler for when not playing
  const handleTimeUpdate = useCallback(() => {
    if (mainVideoRef.current && !isPlaying) {
      setLocalTime(mainVideoRef.current.currentTime);
      syncVideos();
    }
  }, [syncVideos, isPlaying]);

  // Handle video ended - auto-advance to next clip
  const handleVideoEnded = useCallback(() => {
    if (!sequence) return;

    if (currentMomentIndex < sequence.moments.length - 1) {
      // Advance to next clip
      setCurrentMomentIndex(prev => prev + 1);
      setLocalTime(0);
      // Will auto-play after new video loads
    } else {
      // End of sequence
      setIsPlaying(false);
    }
  }, [sequence, currentMomentIndex]);

  // Track playback state for restoring after layout/angle changes
  const pendingRestoreRef = useRef<{ time: number; playing: boolean } | null>(null);
  const shouldAutoPlayRef = useRef(false);

  const handleLoadedMetadata = useCallback(() => {
    if (mainVideoRef.current) {
      const { videoWidth, videoHeight } = mainVideoRef.current;
      if (videoWidth && videoHeight) {
        setVideoAspectRatio(videoWidth / videoHeight);
      }
      
      // Restore playback position if pending
      if (pendingRestoreRef.current) {
        const { time, playing } = pendingRestoreRef.current;
        mainVideoRef.current.currentTime = time;
        Object.entries(videoRefs.current).forEach(([angle, v]) => {
          if (v) v.currentTime = time;
        });
        
        if (playing) {
          // Use safe play with staggered timing
          setIsPlaying(true);
          safePlay(mainVideoRef.current, 'main');
          
          // Delay playing corner videos to ensure React has updated the refs
          // This is needed because when switching tracks, the video elements may not be fully mounted yet
          setTimeout(() => {
            const visibleAngles = getVisibleAngles();
            let delay = 50;
            Object.entries(videoRefs.current).forEach(([angle, v]) => {
              // Play all visible videos including those matching selectedAngle
              if (v && visibleAngles.includes(angle)) {
                setTimeout(() => safePlay(v, angle), delay);
                delay += 50;
              }
            });
          }, 100);
        }
        pendingRestoreRef.current = null;
      }

      // Auto-play after advancing to next clip
      if (shouldAutoPlayRef.current) {
        setIsPlaying(true);
        safePlay(mainVideoRef.current, 'main');
        
        // Delay playing corner videos to ensure React has updated the refs
        setTimeout(() => {
          const visibleAngles = getVisibleAngles();
          let delay = 50;
          Object.entries(videoRefs.current).forEach(([angle, v]) => {
            // Play all visible videos including those matching selectedAngle
            if (v && visibleAngles.includes(angle)) {
              setTimeout(() => safePlay(v, angle), delay);
              delay += 50;
            }
          });
        }, 100);
        shouldAutoPlayRef.current = false;
      }
    }
  }, [safePlay, selectedAngle, getVisibleAngles]);

  // When moment index changes, check if we should auto-play
  useEffect(() => {
    if (isPlaying && currentMomentIndex > 0) {
      shouldAutoPlayRef.current = true;
    }
  }, [currentMomentIndex]);

  // Track last camera track update for highlight refresh in triple/all layouts
  const [trackHighlightVersion, setTrackHighlightVersion] = useState(0);
  
  // PiP layout camera switch animation state
  const [pipSwitchAnim, setPipSwitchAnim] = useState<{
    active: boolean;
    fromAngle: string | null;
    toAngle: string | null;
    flashCorners: string[];
  }>({ active: false, fromAngle: null, toAngle: null, flashCorners: [] });
  
  // Refs for measuring video elements
  const mainVideoContainerRef = useRef<HTMLDivElement>(null);
  const cornerVideoRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // Sync corner videos playback state when isPlaying changes
  // This ensures corner videos play when the main video is playing
  useEffect(() => {
    if (layout !== 'pip') return;
    
    if (isPlaying) {
      // When starting playback, ensure all visible corner videos are playing
      // Including those that match the main view angle (for PiP layout)
      const visibleAngles = getVisibleAngles();
      let delay = 0;
      Object.entries(videoRefs.current).forEach(([angle, v]) => {
        // Play all visible videos including those matching selectedAngle
        if (v && visibleAngles.includes(angle) && v.paused) {
          setTimeout(() => safePlay(v, angle), delay);
          delay += 30;
        }
      });
    }
  }, [isPlaying, layout, selectedAngle, getVisibleAngles, safePlay]);

  // Switch cameras based on camera segments (when custom track enabled)
  // Works both during playback AND when scrubbing timeline
  useEffect(() => {
    if (!useCustomCameraTrack || cameraSegments.length === 0) return;

    // Skip while a restore is pending — the video is remounting and localTime
    // may temporarily be 0, which would cause a false switch back
    if (pendingRestoreRef.current) return;

    // Find which segment the current time falls into
    // At boundaries, prefer the right-side segment (next track)
    const currentSegment = findSegmentForTime(cameraSegments, absoluteTime);

    if (currentSegment && currentSegment.angle !== selectedAngle) {
      // Save playback state before switching so video resumes after remount
      pendingRestoreRef.current = { time: localTime, playing: isPlaying };
      
      // Note: PiP corners no longer swap with main view when track changes
      // The layout configuration remains fixed per user requirements
      
      setSelectedAngle(currentSegment.angle);
      
      // Force highlight refresh in triple/all layouts
      if (layout === 'triple' || layout === 'all') {
        setTrackHighlightVersion(v => v + 1);
      }
    }
  }, [useCustomCameraTrack, absoluteTime, cameraSegments, selectedAngle, localTime, isPlaying, layout]);

  // Custom setters that preserve playback state
  const handleLayoutChange = useCallback((newLayout: LayoutType) => {
    if (newLayout === layout) return;
    
    // Pause all videos before switching layout to prevent AbortError
    if (isPlaying) {
      safePause(mainVideoRef.current, 'main');
      Object.entries(videoRefs.current).forEach(([angle, v]) => safePause(v, angle));
      // Clear any pending play promises
      Object.keys(playPromisesRef.current).forEach(key => {
        playPromisesRef.current[key] = null;
      });
    }
    
    pendingRestoreRef.current = { time: localTime, playing: isPlaying };
    
    // Handle triple view compatibility with camera track
    if (newLayout === 'triple' && hasCustomCameraTrack) {
      if (cameraTrackUniqueAngles.length === 3) {
        // Smart merge: only replace non-matching positions, keep matching ones in place
        const currentTripleAngles = layoutConfig.triple.cameras;
        const trackAngles = cameraTrackUniqueAngles;
        
        // Find which track angles are already in the layout and where
        const newTripleAngles = [...currentTripleAngles];
        const usedTrackAngles = new Set<string>();
        
        // First pass: keep matching angles in their current positions
        for (let i = 0; i < 3; i++) {
          if (trackAngles.includes(currentTripleAngles[i])) {
            usedTrackAngles.add(currentTripleAngles[i]);
          }
        }
        
        // Second pass: fill in non-matching positions with unused track angles
        for (let i = 0; i < 3; i++) {
          if (!trackAngles.includes(currentTripleAngles[i])) {
            // Find an unused track angle
            const unusedAngle = trackAngles.find(a => !usedTrackAngles.has(a));
            if (unusedAngle) {
              newTripleAngles[i] = unusedAngle;
              usedTrackAngles.add(unusedAngle);
            }
          }
        }
        
        handleLayoutConfigChange({
          ...layoutConfig,
          triple: { cameras: newTripleAngles as [string, string, string] }
        });
      }
    }
    
    // Note: PiP layout no longer auto-adjusts corners based on camera track
    // The layout configuration remains fixed per user requirements
    
    setLayout(newLayout);
  }, [layout, localTime, isPlaying, hasCustomCameraTrack, cameraTrackUniqueAngles, cameraSegments, layoutConfig, safePause, absoluteTime, selectedAngle, syncVideos, setLocalTime, setSelectedAngle, setLayoutConfig, setCameraSegments]);

  const handleAngleChange = useCallback((newAngle: string) => {
    if (newAngle === selectedAngle) return;
    
    // Pause all videos before switching angle to prevent AbortError
    if (isPlaying) {
      safePause(mainVideoRef.current, 'main');
      Object.entries(videoRefs.current).forEach(([angle, v]) => safePause(v, angle));
      // Clear any pending play promises
      Object.keys(playPromisesRef.current).forEach(key => {
        playPromisesRef.current[key] = null;
      });
    }
    
    pendingRestoreRef.current = { time: localTime, playing: isPlaying };
    
    // Note: PiP corners no longer swap with main view when angle changes
    // The layout configuration remains fixed per user requirements
    
    // Update the current segment's angle if camera segments exist
    // This works both in CustomCameraTrack mode and normal mode
    if (cameraSegments.length > 0) {
      // Find which segment contains the current absolute time
      // At boundaries, prefer the right-side segment
      const currentSegment = findSegmentForTime(cameraSegments, absoluteTime);
      const currentSegmentIndex = currentSegment ? cameraSegments.findIndex(seg => seg === currentSegment) : -1;
      
      if (currentSegmentIndex !== -1) {
        // Update the current segment's angle
        const newSegments = [...cameraSegments];
        newSegments[currentSegmentIndex] = {
          ...newSegments[currentSegmentIndex],
          angle: newAngle
        };
        setCameraSegments(newSegments);
      }
    }
    
    setSelectedAngle(newAngle);
  }, [selectedAngle, localTime, isPlaying, cameraSegments, absoluteTime, setCameraSegments, safePause]);

  // Fullscreen handler
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch(() => {});
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
      }).catch(() => {});
    }
  }, []);

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Toggle trim mode (scissors button) - enters edit mode if needed
  const toggleTrimMode = useCallback(() => {
    if (!isEditMode) {
      // Not in edit mode - enter edit mode AND start trimming
      setIsEditMode(true);
      setIsTrimming(true);
    } else if (isTrimming) {
      // Already trimming - exit edit mode entirely
      setIsEditMode(false);
      setIsTrimming(false);
    } else {
      // In edit mode but not trimming (on camera track) - start trimming
      setIsTrimming(true);
    }
  }, [isEditMode, isTrimming]);

  // Handle trim point changes
  const handleTrimChange = useCallback((newTrimPoints: TrimPoints) => {
    setTrimPoints(newTrimPoints);
  }, []);

  const togglePlay = useCallback(async () => {
    if (!mainVideoRef.current) return;
    
    if (isPlaying) {
      // Pause all videos
      safePause(mainVideoRef.current, 'main');
      Object.entries(videoRefs.current).forEach(([angle, v]) => safePause(v, angle));
      setIsPlaying(false);
    } else {
      // Play main video first
      setIsPlaying(true);
      await safePlay(mainVideoRef.current, 'main');
      
      // Then play visible videos with staggered timing to reduce load
      // Note: In PiP layout, we play all visible angles including those that match selectedAngle
      // This ensures corner videos play even when they show the same angle as main view
      const visibleAngles = getVisibleAngles();
      let delay = 0;
      Object.entries(videoRefs.current).forEach(([angle, v]) => {
        // Play all visible videos, including those matching selectedAngle (for PiP corners)
        // The main video is already playing via safePlay(mainVideoRef.current, 'main') above
        if (v && visibleAngles.includes(angle)) {
          setTimeout(() => safePlay(v, angle), delay);
          delay += 50; // 50ms stagger between each video
        }
      });
    }
  }, [isPlaying, selectedAngle, safePlay, safePause]);

  // Seek to absolute time (handles cross-clip seeking)
  const seekToAbsoluteTime = useCallback((targetAbsoluteTime: number) => {
    if (!sequence) return;

    // Allow seeking slightly beyond totalDuration to ensure progress bar can reach the end
    const clampedTime = Math.max(0, Math.min(targetAbsoluteTime, totalDuration + 0.001));
    const { momentIndex, localTime: newLocalTime } = findMomentForTime(sequence, clampedTime);

    if (momentIndex !== currentMomentIndex) {
      // Need to change clips
      pendingRestoreRef.current = { time: newLocalTime, playing: isPlaying };
      setCurrentMomentIndex(momentIndex);
      setLocalTime(newLocalTime);
    } else {
      // Same clip, just seek
      syncVideos(newLocalTime);
    }
  }, [sequence, totalDuration, currentMomentIndex, isPlaying, syncVideos]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    seekToAbsoluteTime(time);
  }, [seekToAbsoluteTime]);

  const handleTimelineSeek = useCallback((time: number) => {
    seekToAbsoluteTime(time);
  }, [seekToAbsoluteTime]);

  // Handle trim preview - seek video while dragging trim handles
  const handleTrimPreview = useCallback((previewTime: number | null) => {
    if (previewTime !== null) {
      seekToAbsoluteTime(previewTime);
    }
  }, [seekToAbsoluteTime]);

  const handlePlaybackRateChange = useCallback((rate: number) => {
    setPlaybackRate(rate);
    if (mainVideoRef.current) {
      mainVideoRef.current.playbackRate = rate;
    }
    Object.values(videoRefs.current).forEach(v => {
      if (v) v.playbackRate = rate;
    });
  }, []);

  // Use requestAnimationFrame for smooth progress bar updates
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const updateFrame = () => {
      if (mainVideoRef.current) {
        const currentTime = mainVideoRef.current.currentTime;
        
        // Check if we've reached the trim end point (for trimmed playback)
        if (!isTrimming && trimPoints && sequence) {
          const currentAbsoluteTime = toAbsoluteTime(sequence, currentMomentIndex, currentTime);
          if (currentAbsoluteTime >= trimPoints.outPoint) {
            // Reached trim end - pause the video element directly first
            mainVideoRef.current.pause();
            Object.values(videoRefs.current).forEach(v => v?.pause());
            // Then update React state
            setIsPlaying(false);
            // Sync to exact trim end position
            syncVideos();
            return;
          }
        }
        
        // Update local time for smooth UI updates (throttled to ~60fps for state updates)
        // Use requestAnimationFrame timestamp for consistent timing
        const now = performance.now();
        if (now - lastTimeUpdateRef.current >= 16) { // ~60fps
          setLocalTime(currentTime);
          lastTimeUpdateRef.current = now;
        }
        // Sync other videos without triggering React state updates
        syncVideos();
      }
      rafRef.current = requestAnimationFrame(updateFrame);
    };

    rafRef.current = requestAnimationFrame(updateFrame);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying, syncVideos, isTrimming, trimPoints, sequence, currentMomentIndex]);

  // Skip to previous/next clip
  const skipToPreviousClip = useCallback(() => {
    if (!sequence || currentMomentIndex <= 0) return;
    pendingRestoreRef.current = { time: 0, playing: isPlaying };
    setCurrentMomentIndex(prev => prev - 1);
    setLocalTime(0);
  }, [sequence, currentMomentIndex, isPlaying]);

  const skipToNextClip = useCallback(() => {
    if (!sequence || currentMomentIndex >= sequence.moments.length - 1) return;
    pendingRestoreRef.current = { time: 0, playing: isPlaying };
    setCurrentMomentIndex(prev => prev + 1);
    setLocalTime(0);
  }, [sequence, currentMomentIndex, isPlaying]);

  const formatTime = (time: number, showMs: boolean = false): string => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    const ms = Math.round((time % 1) * 1000);
    
    if (showMs) {
      return `${minutes}:${seconds.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Click on a sub-video to make it the main selected angle
  const handleVideoClick = useCallback((angle: string) => {
    if (layout === 'single') {
      togglePlay();
    } else {
      handleAngleChange(angle);
    }
  }, [layout, togglePlay, handleAngleChange]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!mainVideoRef.current || !sequence) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekToAbsoluteTime(absoluteTime - 5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekToAbsoluteTime(absoluteTime + 5);
          break;
        case 'u':
          setSpeedUnit((prev) => (prev === 'mph' ? 'kmh' : 'mph'));
          break;
        case '1':
          handleLayoutChange('single');
          break;
        case '2':
          handleLayoutChange('pip');
          break;
        case '3':
          handleLayoutChange('triple');
          break;
        case '4':
          handleLayoutChange('all');
          break;
        case 'm':
          setShowMap(prev => !prev);
          break;
        case 't':
          setShowTelemetry(prev => !prev);
          break;
        case 'd':
          setShowDateTime(prev => !prev);
          break;
        case 'f':
          toggleFullscreen();
          break;
        case '[':
          skipToPreviousClip();
          break;
        case ']':
          skipToNextClip();
          break;
        case 'e':
          toggleTrimMode();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, absoluteTime, sequence, seekToAbsoluteTime, handleLayoutChange, toggleFullscreen, skipToPreviousClip, skipToNextClip, toggleTrimMode]);

  // Close map size control when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showMapSizeControl) {
        const target = e.target as HTMLElement;
        if (!target.closest('.relative') || target.closest('input[type="range"]')) {
          return;
        }
        setShowMapSizeControl(false);
      }
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [showMapSizeControl]);

  if (!sequence || !currentMoment || Object.keys(videoUrls).length === 0) {
    return (
      <div className="bg-gray-900 rounded-xl aspect-video flex items-center justify-center">
        <div className="text-center text-gray-500">
          <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <p>Select a sequence to play</p>
        </div>
      </div>
    );
  }

  const availableAngles = currentMoment.videos.map(v => v.angle);

  // Render a single video element
  const renderVideo = (angle: string, isMain: boolean, className: string = '', showLabel: boolean = false, moreLabelSpacing: boolean = false) => {
    const url = videoUrls[angle];
    const isAvailable = availableAngles.includes(angle);

    // Debug: Log when main view URL is missing
    if (isMain && (!url || !isAvailable)) {
      console.log('[RenderVideo] Main view URL issue:', {
        angle,
        hasUrl: !!url,
        isAvailable,
        availableAngles,
        videoUrlsKeys: Object.keys(videoUrls),
        currentMomentId: currentMoment?.id
      });
    }

    if (!url || !isAvailable) {
      // For main view, show last frame or black to minimize flicker
      if (isMain) {
        return (
          <div className={`bg-black flex items-center justify-center ${className}`}>
            {/* Show subtle loading indicator only briefly */}
            <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin opacity-50" />
          </div>
        );
      }
      return (
        <div className={`bg-gray-900 flex items-center justify-center text-gray-600 text-xs ${className}`}>
          {ANGLE_LABELS[angle] || angle}
        </div>
      );
    }

    return (
      <div className={`relative ${className}`}>
        <video
          key={`video-${angle}`}
          ref={(el) => {
            videoRefs.current[angle] = el;
            if (isMain) {
              (mainVideoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
            }
          }}
          src={url}
          className="w-full h-full object-contain bg-black"
          muted={!isMain}
          preload={isMain ? "auto" : "metadata"}
          playsInline
          onTimeUpdate={isMain ? handleTimeUpdate : undefined}
          onLoadedMetadata={isMain ? handleLoadedMetadata : undefined}
          onEnded={isMain ? handleVideoEnded : undefined}
          onPlay={isMain ? () => setIsPlaying(true) : undefined}
          onPause={isMain ? () => setIsPlaying(false) : undefined}
          onClick={() => isMain ? togglePlay() : handleAngleChange(angle)}
        />
        {isMain && layout !== 'single' && layout !== 'pip' && (
          <div className="absolute top-1 right-1 w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        )}
        {/* Angle label for all videos (green for main in multi-view, blue for pip main, black for others) */}
        {showLabel && (
          <div className={`absolute bottom-1 ${moreLabelSpacing ? 'left-2' : 'left-1'} px-1.5 py-0.5 backdrop-blur-sm rounded text-[10px] text-white/90 font-medium pointer-events-none ${
            isMain && layout !== 'single' && layout !== 'pip' ? 'bg-green-600/70 border border-green-400/50' : 
            isMain ? 'bg-blue-600/50' : 'bg-black/50'
          }`}>
            {ANGLE_LABELS[angle] || angle}
          </div>
        )}
      </div>
    );
  };

  // Play button overlay
  const renderPlayOverlay = () => {
    if (isPlaying || isTimelineDragging) return null;
    return (
      <button
        onClick={togglePlay}
        className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors z-10"
      >
        <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
          <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 20 20">
            <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
          </svg>
        </div>
      </button>
    );
  };

  // Render video grid based on layout
  const renderVideoGrid = () => {
    // Single view - just one camera
    if (layout === 'single') {
      return (
        <div className="relative w-full bg-black flex items-center justify-center aspect-video max-h-full">
          <div className="w-full h-full">
            {renderVideo(selectedAngle, true, 'w-full h-full')}
          </div>
          <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm rounded px-2 py-1 text-xs font-medium flex items-center gap-1">
            {ANGLE_ICONS[selectedAngle]} {ANGLE_LABELS[selectedAngle]}
          </div>
          {/* Clip indicator for multi-clip sequences */}
          {sequence.clipCount > 1 && (
            <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm rounded px-2 py-1 text-xs font-medium">
              Clip {currentMomentIndex + 1}/{sequence.clipCount}
            </div>
          )}
          {/* Bottom center angle label */}
          <div 
            key={`angle-label-${selectedAngle}`}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur-md rounded-full px-4 py-1.5 text-sm font-medium flex items-center gap-2 border border-white/20 shadow-lg animate-fadeIn"
          >
            <span className="text-blue-400">{ANGLE_ICONS[selectedAngle]}</span>
            <span className="text-white">{ANGLE_LABELS[selectedAngle]}</span>
          </div>
          {renderPlayOverlay()}
        </div>
      );
    }

    // PiP view - main camera with configurable corners
    // corners: [bottom-left, bottom-center, bottom-right, top-left, top-right]
    if (layout === 'pip') {
      const corners = layoutConfig.pip.corners;
      const ar = videoAspectRatio || 16 / 9;

      const hasGps = !!(mapSeiData?.latitude_deg && mapSeiData?.longitude_deg);

      // Position classes for each corner slot
      const cornerPositions = [
        'absolute bottom-3 left-3',                        // 0: bottom-left
        'absolute bottom-3 left-1/2 -translate-x-1/2',    // 1: bottom-center
        'absolute bottom-3 right-3',                       // 2: bottom-right
        'absolute top-3 left-3',                           // 3: top-left
        'absolute top-3 right-3',                          // 4: top-right
      ];

      // Handle PiP corner click - swap with main view (Front/Rear only) and update track
      const handlePipCornerClick = (angle: string, idx: number) => {
        if (angle === 'map' || angle === 'none') return;
        
        // Pause all videos before switching angle to prevent AbortError
        if (isPlaying) {
          safePause(mainVideoRef.current, 'main');
          Object.entries(videoRefs.current).forEach(([a, v]) => safePause(v, a));
          // Clear any pending play promises
          Object.keys(playPromisesRef.current).forEach(key => {
            playPromisesRef.current[key] = null;
          });
        }
        
        pendingRestoreRef.current = { time: localTime, playing: isPlaying };
        
        // Determine whether to swap in layout
        // If both current main angle and clicked angle are Front/Rear, swap them
        const FRONT_REAR_ANGLES = ['front', 'back'];
        const isFrontRearSwap = FRONT_REAR_ANGLES.includes(selectedAngle) && 
                                FRONT_REAR_ANGLES.includes(angle) &&
                                selectedAngle !== angle;
        
        if (isFrontRearSwap) {
          // Swap: the clicked corner gets current main angle
          const newCorners = [...corners] as [string, string, string, string, string];
          newCorners[idx] = selectedAngle;
          
          // Update layout config with swapped corners
          const newConfig = { ...layoutConfig, pip: { corners: newCorners } };
          setLayoutConfig(newConfig);
          saveLayoutConfig(newConfig);
        }
        
        // Update the current segment's angle to the clicked angle
        // This replaces the current track
        if (cameraSegments.length > 0) {
          const currentSegment = findSegmentForTime(cameraSegments, absoluteTime);
          const currentSegmentIndex = currentSegment ? cameraSegments.findIndex(seg => seg === currentSegment) : -1;
          
          if (currentSegmentIndex !== -1) {
            const newSegments = [...cameraSegments];
            newSegments[currentSegmentIndex] = {
              ...newSegments[currentSegmentIndex],
              angle: angle
            };
            setCameraSegments(newSegments);
          }
        }
        
        // Set selected angle to the clicked angle (main view changes to corner view)
        setSelectedAngle(angle);
      };

      // Use configured corners directly - no dynamic display substitution
      // This ensures video elements stay mounted and keep playing
      const displayCorners = corners;

      return (
        <div className="relative w-full bg-black flex items-center justify-center aspect-video max-h-full overflow-hidden">
          <div
            ref={mainVideoContainerRef}
            className="relative max-w-full max-h-full"
            style={{ aspectRatio: `${ar}` }}
          >
            <div className="w-full h-full">
              {renderVideo(selectedAngle, true, 'w-full h-full')}
            </div>
            {/* All 5 PiP corners - each absolutely positioned */}
            {/* Render all corners - show configured angle with breathing glow when config matches main view */}
            {displayCorners.map((angle, idx) => {
              if (angle === 'none' || angle === 'map') return null;
              const pos = cornerPositions[idx];
              // Show placeholder if angle not available instead of hiding completely
              const isAvailable = availableAngles.includes(angle);
              
              // Check if this corner should show flash animation
              const cornerKey = `${idx}-${angle}`;
              const shouldFlash = pipSwitchAnim.active && pipSwitchAnim.flashCorners.includes(cornerKey);
              
              // Check if this corner's CONFIGURED angle matches the main view angle
              // If so, show green breathing glow effect
              const isMatchingMainView = angle === selectedAngle;
              
              return (
                <div
                  key={`pip-corner-${idx}-${angle}`}
                  ref={el => { cornerVideoRefs.current[idx] = el; }}
                  className={`${pos} w-[18%] rounded-lg overflow-hidden shadow-lg cursor-pointer hover:ring-2 hover:ring-white/50 border ${
                    shouldFlash ? 'animate-pipFlash' : ''
                  } ${isMatchingMainView ? 'animate-pipGlow border-green-500/60' : 'border-white/20'}`}
                  style={{ 
                    transition: 'opacity 150ms ease-out',
                    zIndex: 10 
                  }}
                  onClick={() => isAvailable && handlePipCornerClick(angle, idx)}
                >
                  {isAvailable ? renderVideo(angle, false, 'w-full', true) : (
                    <div className="bg-gray-900 w-full h-full flex items-center justify-center text-gray-600 text-xs">
                      {ANGLE_LABELS[angle] || angle}
                    </div>
                  )}
                </div>
              );
            })}
            {/* Map corners (separate from video corners) */}
            {corners.map((value, idx) => {
              if (value !== 'map') return null;
              const pos = cornerPositions[idx];
              
              return (
                <div key={`pip-map-${idx}`} className={`${pos} w-[18%] aspect-square rounded-lg overflow-hidden border border-white/20 shadow-lg pointer-events-auto`}>
                  <Suspense fallback={<div className="bg-gray-900 w-full h-full" />}>
                    <MapView seiData={mapSeiData} eventReason={sequence?.event?.reasonLabel} isEventJsonGps={isEventJsonGps} city={sequence?.event?.city} street={sequence?.event?.street} />
                  </Suspense>
                </div>
              );
            })}

            {renderPlayOverlay()}
          </div>
        </div>
      );
    }

    // Triple view - front + left + right in a row
    if (layout === 'triple') {
      const tripleAngles = layoutConfig.triple.cameras;

      return (
        <div key={`triple-${selectedAngle}-${trackHighlightVersion}`} className="relative w-full bg-black flex items-center justify-center overflow-hidden aspect-video max-h-full">
          <div className="grid grid-cols-3 w-full">
            {tripleAngles.map((angle, idx) => {
              const isMain = angle === selectedAngle;
              const isAvailable = availableAngles.includes(angle);

              return (
                <div
                  key={idx}
                  className={`relative overflow-hidden transition-all duration-150 ${
                    isMain ? 'ring-2 ring-inset ring-green-500 shadow-[0_0_15px_rgba(34,197,94,0.3)]' : ''
                  } ${isAvailable ? 'cursor-pointer' : 'opacity-40'}`}
                  onClick={() => isAvailable && handleAngleChange(angle)}
                >
                  {renderVideo(angle, isMain, 'w-full', true)}
                </div>
              );
            })}
          </div>
          {renderPlayOverlay()}
        </div>
      );
    }

    // All 6 cameras - 2 rows of 3
    if (layout === 'all') {
      const { topRow, bottomRow } = layoutConfig.all;
      const rows = [topRow, bottomRow];

      return (
        <div key={`all-${selectedAngle}-${trackHighlightVersion}`} className="relative w-full bg-black flex items-center justify-center overflow-hidden aspect-video max-h-full">
          <div className="absolute inset-0 flex flex-col gap-1 p-1">
            {rows.map((row, rowIdx) => (
              <div key={rowIdx} className="flex-1 flex gap-1 min-h-0">
                {row.map((angle, colIdx) => {
                  const isMain = angle === selectedAngle;
                  const isAvailable = availableAngles.includes(angle);

                  return (
                    <div
                      key={colIdx}
                      className={`relative flex-1 rounded overflow-hidden transition-all duration-150 ${
                        isMain ? 'ring-2 ring-green-500 shadow-[0_0_15px_rgba(34,197,94,0.3)]' : ''
                      } ${isAvailable ? 'cursor-pointer' : 'opacity-40'}`}
                      onClick={() => isAvailable && handleAngleChange(angle)}
                    >
                      {renderVideo(angle, isMain, 'w-full h-full', true, true)}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {renderPlayOverlay()}
        </div>
      );
    }

    return null;
  };

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col gap-2 ${
        isFullscreen
          ? 'fixed inset-0 z-50 bg-black p-4'
          : 'max-w-[1800px] mx-auto h-[calc(100vh-2rem)]'
      }`}
    >
      {/* Video Container with Overlays */}
      <div
        ref={videoContainerRef}
        className={`relative bg-black rounded-xl overflow-hidden flex items-center justify-center ${
          isFullscreen ? 'flex-1' : 'max-h-[60vh]'
        }`}
      >
        {renderVideoGrid()}

        {/* Overlay anchor - matches visible video area */}
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-20"
        >
          <div
            className={`relative pointer-events-none ${
              layout === 'pip' && videoAspectRatio ? 'max-w-full max-h-full h-full' : 'w-full h-full'
            }`}
            style={layout === 'pip' && videoAspectRatio ? { aspectRatio: `${videoAspectRatio}` } : undefined}
          >
            {/* Date/Time Overlay - Top Center */}
            {showDateTime && (
              <div className="absolute top-1 left-1/2 -translate-x-1/2 pointer-events-none">
                <div className="px-2 py-1 rounded-md bg-black/50 backdrop-blur-sm text-white/90 text-xs font-medium">
                  {(() => {
                    const realTime = new Date(currentMoment.timestamp.getTime() + localTime * 1000);
                    // Use local time formatting to avoid UTC conversion
                    const year = realTime.getFullYear();
                    const month = String(realTime.getMonth() + 1).padStart(2, '0');
                    const day = String(realTime.getDate()).padStart(2, '0');
                    const hours = String(realTime.getHours()).padStart(2, '0');
                    const minutes = String(realTime.getMinutes()).padStart(2, '0');
                    const seconds = String(realTime.getSeconds()).padStart(2, '0');
                    return <>{year}-{month}-{day} &nbsp; {hours}:{minutes}:{seconds}</>;
                  })()}
                </div>
              </div>
            )}

            {/* Telemetry Overlay - Below Date/Time */}
            {showTelemetry && (
              <div className={`absolute left-1/2 -translate-x-1/2 pointer-events-auto ${
                showDateTime ? 'top-8' : 'top-1'
              }`}>
                <TelemetryCard
                  seiData={seiData}
                  isLoading={isLoading}
                  error={error}
                  speedUnit={speedUnit}
                  onSpeedUnitToggle={() => setSpeedUnit(prev => prev === 'mph' ? 'kmh' : 'mph')}
                />
              </div>
            )}

            {/* Main Camera label for PiP layout - Below Telemetry */}
            {layout === 'pip' && (
              <div 
                key={`pip-main-label-${selectedAngle}`}
                className={`absolute left-1/2 -translate-x-1/2 pointer-events-none animate-fadeIn ${
                  showTelemetry ? (showDateTime ? 'top-[120px]' : 'top-[88px]') : (showDateTime ? 'top-8' : 'top-1')
                }`}
              >
                <div className="px-2 py-0.5 rounded-md bg-green-600/50 backdrop-blur-md text-white text-[10px] font-medium flex items-center gap-1 border border-green-400/30">
                  <span>Main:</span>
                  <span className="font-semibold">{ANGLE_LABELS[selectedAngle]}</span>
                </div>
              </div>
            )}

            {/* Map Overlay - only for non-PiP layouts */}
            {showMap && layout !== 'pip' && (
              <div className="absolute rounded-lg overflow-hidden shadow-xl opacity-90 hover:opacity-100 transition-opacity pointer-events-auto bottom-4 right-4" style={{ width: mapSize, height: mapSize }}>
                <Suspense fallback={
                  <div className="bg-gray-900 w-full h-full flex items-center justify-center">
                    <div className="text-gray-500 text-xs">Loading...</div>
                  </div>
                }>
                  <MapView seiData={mapSeiData} eventReason={sequence?.event?.reasonLabel} isEventJsonGps={isEventJsonGps} city={sequence?.event?.city} street={sequence?.event?.street} />
                </Suspense>
              </div>
            )}
          </div>
        </div>

        {/* PiP External Map - positioned at video container level (right side black area) */}
        {showMap && layout === 'pip' && !layoutConfig.pip.corners.includes('map') && (
          <div className="absolute bottom-4 right-4 rounded-lg overflow-hidden shadow-xl opacity-90 hover:opacity-100 transition-opacity pointer-events-auto z-30" style={{ width: mapSize, height: mapSize }}>
            <Suspense fallback={
              <div className="bg-gray-900 w-full h-full flex items-center justify-center">
                <div className="text-gray-500 text-xs">Loading...</div>
              </div>
            }>
              <MapView seiData={mapSeiData} eventReason={sequence?.event?.reasonLabel} isEventJsonGps={isEventJsonGps} city={sequence?.event?.city} street={sequence?.event?.street} />
            </Suspense>
          </div>
        )}
      </div>

      {/* Controls Area - Scrollable if needed */}
      <div className={`flex-1 overflow-y-auto space-y-2 min-h-0 ${isFullscreen ? '' : ''}`}>
        {/* Playback Controls - Under Video */}
        <div className="bg-gray-800/50 rounded-xl px-4 py-3">
        <div className="flex items-center gap-2">
          {/* Skip to Previous Clip */}
          {sequence.clipCount > 1 && (
            <Tooltip content="Previous clip ([)" position="bottom">
              <button
                onClick={skipToPreviousClip}
                disabled={currentMomentIndex === 0}
                className={`w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-all ${
                  currentMomentIndex === 0
                    ? 'bg-white/5 text-gray-600 cursor-not-allowed'
                    : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                <IconPlayerSkipBack size={16} />
              </button>
            </Tooltip>
          )}

          {/* Skip Back 15s */}
          <Tooltip content="Back 15s" position="bottom">
            <button
              onClick={() => seekToAbsoluteTime(absoluteTime - 15)}
              className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-all"
            >
              <IconRewindBackward15 size={18} className="text-white" />
            </button>
          </Tooltip>

          {/* Play/Pause Button */}
          <Tooltip content={isPlaying ? "Pause (Space)" : "Play (Space)"} position="bottom">
            <button
              onClick={togglePlay}
              className="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-full bg-white/15 hover:bg-white/25 transition-all"
            >
              {isPlaying ? (
                <IconPlayerPause size={24} className="text-white" />
              ) : (
                <IconPlayerPlay size={24} className="text-white ml-0.5" />
              )}
            </button>
          </Tooltip>

          {/* Skip Forward 15s */}
          <Tooltip content="Forward 15s" position="bottom">
            <button
              onClick={() => seekToAbsoluteTime(absoluteTime + 15)}
              className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-all"
            >
              <IconRewindForward15 size={18} className="text-white" />
            </button>
          </Tooltip>

          {/* Skip to Next Clip */}
          {sequence.clipCount > 1 && (
            <Tooltip content="Next clip (])" position="bottom">
              <button
                onClick={skipToNextClip}
                disabled={currentMomentIndex >= sequence.moments.length - 1}
                className={`w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-all ${
                  currentMomentIndex >= sequence.moments.length - 1
                    ? 'bg-white/5 text-gray-600 cursor-not-allowed'
                    : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                <IconPlayerSkipForward size={16} />
              </button>
            </Tooltip>
          )}

          {/* Time + Timeline */}
          {(() => {
            // When trimmed (and not in trim mode), show trimmed range
            const effectiveStart = (!isTrimming && trimPoints) ? trimPoints.inPoint : 0;
            const effectiveEnd = (!isTrimming && trimPoints) ? trimPoints.outPoint : totalDuration;
            // Allow seeking slightly past the end to ensure progress bar can reach the end
            const clampedTime = Math.max(effectiveStart, Math.min(effectiveEnd + 0.001, absoluteTime));

            return (
              <>
                <span className="text-sm text-gray-400 w-[4.5rem] tabular-nums ml-2 will-change-contents">{formatTime(clampedTime - effectiveStart, true)}</span>
                <input
                  type="range"
                  min={effectiveStart}
                  max={(effectiveEnd + 0.001) || 0}
                  step={0.001}
                  value={clampedTime}
                  onChange={handleSeek}
                  className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer will-change-transform"
                  style={{ contain: 'layout style' }}
                />
                <span className="text-sm text-gray-400 w-[4.5rem] tabular-nums will-change-contents">{formatTime(effectiveEnd - effectiveStart, true)}</span>
              </>
            );
          })()}

          {/* Playback Speed */}
          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
            {[0.5, 1, 1.5, 2].map((rate) => (
              <button
                key={rate}
                onClick={() => handlePlaybackRateChange(rate)}
                className={`px-2 py-1 text-xs font-medium rounded-lg transition-colors ${
                  playbackRate === rate ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Control Bar: Camera + Layout + Date + Toggles */}
      <div className="bg-gray-800/50 rounded-xl px-3 py-2 relative z-20">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Camera buttons — always visible, disabled for triple/all unless in edit mode */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-500 mr-1">Cameras:</span>
            {BUTTON_ORDER.map((angle) => {
              const isAvailable = availableAngles.includes(angle);
              // In triple/all layouts, disable camera buttons (they show all cameras at once)
              // PIP and single layouts allow camera switching
              const isTripleOrAll = layout === 'triple' || layout === 'all';
              const canSelect = layout === 'single' || layout === 'pip' || isEditMode || hasCustomCameraTrack;
              const isDisabled = !isAvailable || isTripleOrAll || !canSelect;
              const isActive = selectedAngle === angle && !useCustomCameraTrack && canSelect;

              return (
                <Tooltip key={angle} content={ANGLE_LABELS[angle]} position="top">
                  <button
                    disabled={isDisabled}
                    onClick={() => {
                      if (!isDisabled) {
                        setUseCustomCameraTrack(false);
                        handleAngleChange(angle);
                      }
                    }}
                    className={`p-1.5 rounded text-xs font-medium transition-all ${
                      isActive
                        ? isTrimming 
                          ? 'bg-yellow-500 text-black'
                          : 'bg-blue-600 text-white'
                        : isDisabled
                        ? 'bg-gray-800/50 text-gray-600 cursor-not-allowed'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {ANGLE_ICONS[angle]}
                  </button>
                </Tooltip>
              );
            })}
            {/* Custom camera track button */}
            {hasCustomCameraTrack && (
              <Tooltip content="Use custom camera track" position="top">
                <button
                  onClick={() => setUseCustomCameraTrack(true)}
                  className={`px-2 py-1 rounded text-xs font-medium transition-all flex items-center gap-1 ${
                    useCustomCameraTrack
                      ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  <IconWand size={14} />
                  <span>Custom</span>
                </button>
              </Tooltip>
            )}
          </div>

          {/* Divider */}
          <div className="w-px h-5 bg-gray-700" />

          {/* Layout buttons */}
          <div className="flex items-center gap-1 relative">
            <span className="text-[10px] text-gray-500 mr-1">Layout:</span>
            {LAYOUTS.map((l) => {
              // Check if triple view is disabled due to camera track incompatibility
              const isTripleDisabled = l.id === 'triple' && hasCustomCameraTrack && cameraTrackUniqueAngles.length !== 3;
              // Dynamic tooltip based on camera track count
              let tooltipContent = l.label;
              if (l.id === 'triple' && hasCustomCameraTrack) {
                const count = cameraTrackUniqueAngles.length;
                if (count < 3) {
                  tooltipContent = `Triple view requires 3 camera angles (current: ${count}). Add ${3 - count} more track(s) to enable.`;
                } else if (count > 3) {
                  tooltipContent = `Triple view requires 3 camera angles (current: ${count}). Remove ${count - 3} track(s) to enable.`;
                }
              }
              
              return (
                <Tooltip 
                  key={l.id} 
                  content={
                    <div className="flex flex-col items-center">
                      <span>{tooltipContent}</span>
                      {l.id !== 'single' && <span className="text-[10px] text-gray-400 mt-1">Right-click to configure</span>}
                    </div>
                  } 
                  position="top"
                >
                  <button
                    onClick={() => !isTripleDisabled && handleLayoutChange(l.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (l.id !== 'single') {
                        // Open layout config for this specific layout
                        setLayout(l.id);
                        setShowLayoutConfig(true);
                      }
                    }}
                    disabled={isTripleDisabled}
                    className={`p-1.5 rounded text-xs font-medium transition-all ${
                      layout === l.id
                        ? 'bg-blue-600 text-white'
                        : isTripleDisabled
                          ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                          : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                  >
                    {l.icon}
                  </button>
                </Tooltip>
              );
            })}
            {/* Layout config button - positioned after all layout buttons */}
            {layout !== 'single' && (
              <Tooltip content="Configure layout" position="top">
                <button
                  onClick={() => setShowLayoutConfig(prev => !prev)}
                  className={`p-1.5 rounded text-xs font-medium transition-all ml-1 ${
                    showLayoutConfig
                      ? 'bg-blue-500 text-white ring-2 ring-blue-400/50'
                      : 'bg-gray-700 text-cyan-400 hover:bg-gray-600 hover:text-cyan-300 ring-1 ring-cyan-500/30 hover:ring-cyan-400/50'
                  }`}
                >
                  <IconSettings2 size={14} />
                </button>
              </Tooltip>
            )}
            {showLayoutConfig && layout !== 'single' && (
              <LayoutConfigPopover
                layout={layout}
                config={layoutConfig}
                onChange={handleLayoutConfigChange}
                onClose={() => setShowLayoutConfig(false)}
              />
            )}
          </div>

          {/* Divider */}
          <div className="w-px h-5 bg-gray-700" />

          {/* Trim button - for entering trim mode */}
          {!isTrimming && (
            <Tooltip content={trimPoints && (trimPoints.inPoint > 0 || trimPoints.outPoint < totalDuration) ? "Edit trim (E)" : "Trim video (E)"} position="top">
              <button
                onClick={toggleTrimMode}
                className={`px-2 py-1 rounded text-xs font-medium transition-all flex items-center gap-1 ${
                  trimPoints && (trimPoints.inPoint > 0 || trimPoints.outPoint < totalDuration)
                    ? 'bg-yellow-500/80 text-black hover:bg-yellow-500'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                <IconScissors size={14} />
                <span>{trimPoints && (trimPoints.inPoint > 0 || trimPoints.outPoint < totalDuration) ? 'Edit Trim' : 'Trim'}</span>
              </button>
            </Tooltip>
          )}

          {/* Done button - for exiting trim mode */}
          {isTrimming && (
            <Tooltip content="Done trimming" position="top">
              <button
                onClick={() => setIsTrimming(false)}
                className="px-2 py-1 rounded text-xs font-medium transition-all bg-yellow-500 text-black hover:bg-yellow-400 flex items-center gap-1"
              >
                <span>Done</span>
              </button>
            </Tooltip>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Overlay Toggles */}
          <div className="flex items-center gap-1 relative z-10">
            <span className="text-[10px] text-gray-500 mr-1">Show:</span>
            <Tooltip content="Date/Time (D)" position="top">
              <button
                onClick={() => setShowDateTime(prev => !prev)}
                className={`p-1.5 rounded transition-all ${
                  showDateTime
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                <IconClock size={16} />
              </button>
            </Tooltip>
            <Tooltip content={hasTelemetryData ? "Telemetry (T)" : "No telemetry data available"} position="top">
              <button
                onClick={() => hasTelemetryData && setShowTelemetry(prev => !prev)}
                className={`p-1.5 rounded transition-all ${
                  hasTelemetryData
                    ? showTelemetry
                      ? 'bg-green-600 text-white'
                      : 'bg-green-600/30 text-green-400 hover:bg-green-600/50'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                }`}
              >
                <IconBolt size={16} />
              </button>
            </Tooltip>
            <div className="relative flex items-center z-10">
              <Tooltip content={hasGpsData ? "Map (M) - Right-click to resize" : "No GPS data available"} position="top">
                <button
                  onClick={() => hasGpsData && setShowMap(prev => !prev)}
                  onContextMenu={(e) => {
                    if (hasGpsData) {
                      e.preventDefault();
                      setShowMapSizeControl(prev => !prev);
                    }
                  }}
                  className={`p-1.5 rounded transition-all h-[28px] flex items-center justify-center ${
                    hasGpsData
                      ? showMap
                        ? 'bg-green-600 text-white'
                        : 'bg-green-600/30 text-green-400 hover:bg-green-600/50'
                      : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  <IconMapPin size={16} />
                </button>
              </Tooltip>
              {/* Map Size Control Popover */}
              {showMapSizeControl && showMap && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-gray-800 rounded-lg p-3 shadow-xl border border-gray-700 z-[100] w-40">
                  <div className="text-xs text-gray-400 mb-2">Map Size ({mapSize}px)</div>
                  <input
                    type="range"
                    min={180}
                    max={330}
                    value={mapSize}
                    onChange={(e) => handleMapSizeChange(parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              )}
            </div>
            <Tooltip 
              content={
                !sequence?.event 
                  ? "No event data available" 
                  : (!isTrimming && !isEventMarkerInTrimRange)
                    ? "Event marker outside trim range" 
                    : "Event Marker"
              } 
              position="top"
            >
              <button
                onClick={() => sequence?.event && (isTrimming || isEventMarkerInTrimRange) && setShowEventMarker(prev => !prev)}
                className={`p-1.5 rounded transition-all ${
                  !sequence?.event || (!isTrimming && !isEventMarkerInTrimRange)
                    ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                    : showEventMarker
                      ? 'bg-green-600 text-white'
                      : 'bg-green-600/30 text-green-400 hover:bg-green-600/50'
                }`}
              >
                <div className="w-4 h-4 flex items-center justify-center">
                  <IconSquare size={12} className="rotate-45" />
                </div>
              </button>
            </Tooltip>
            <Tooltip content={`Speed: ${speedUnit === 'mph' ? 'MPH' : 'km/h'} (click to switch)`} position="top">
              <button
                onClick={() => setSpeedUnit(prev => prev === 'mph' ? 'kmh' : 'mph')}
                className="px-1.5 h-[28px] flex items-center rounded transition-all bg-gray-700 text-gray-300 hover:bg-gray-600 text-[10px] font-bold leading-none"
              >
                {speedUnit === 'mph' ? 'MPH' : 'km/h'}
              </button>
            </Tooltip>

            {/* Divider */}
            <div className="w-px h-4 bg-gray-600 mx-1" />

            {/* Fullscreen */}
            <Tooltip content={isFullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"} position="top">
              <button
                onClick={toggleFullscreen}
                className="p-1.5 rounded bg-gray-700 text-gray-400 hover:bg-gray-600 transition-all"
              >
                {isFullscreen ? <IconMinimize size={16} /> : <IconMaximize size={16} />}
              </button>
            </Tooltip>

            {/* Divider */}
            <div className="w-px h-4 bg-gray-600 mx-1" />

            {/* Video Browser Button (only when folder imported) */}
            {folderStructure && onOpenVideoBrowser && (
              <Tooltip content="Browse videos by date" position="top">
                <button
                  onClick={onOpenVideoBrowser}
                  className="flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium transition-all bg-amber-600/20 text-amber-400 border border-amber-500/30 hover:bg-amber-600/30 h-[28px]"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>Calendar</span>
                </button>
              </Tooltip>
            )}

            {/* Sequence Selector */}
            <button
              onClick={() => setShowSequenceMenu(true)}
              className={`flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium transition-all ${
                sequences.length > 0
                  ? 'bg-green-600/20 text-green-400 border border-green-500/30 hover:bg-green-600/30'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <IconList size={14} />
              <span>
                {sequences.length > 1 ? `${sequences.indexOf(sequence) + 1}/${sequences.length}` : sequences.length === 1 ? '1/1' : 'Files'}
              </span>
            </button>

            {/* Divider */}
            <div className="w-px h-4 bg-gray-600 mx-1" />

            {/* Export */}
            <VideoExporter
              sequence={sequence}
              selectedAngle={selectedAngle}
              allSeiMessages={allSeiMessages}
              fps={fps}
              speedUnit={speedUnit}
              filename={`tesla-${sequence.dateRange}-${sequence.timeRange.split(' - ')[0].replace(/:/g, '-')}`}
              trimPoints={trimPoints}
              cameraSegments={cameraSegments}
              showTelemetry={showTelemetry}
              showDateTime={showDateTime}
              showMap={showMap}
              layout={layout}
              layoutConfig={layoutConfig}
            />
          </div>
        </div>
      </div>

      {/* Sequence Dialog - moved outside Control Bar to avoid z-index stacking context issues */}
      {showSequenceMenu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowSequenceMenu(false)}>
          <div className="bg-gray-900 rounded-xl w-80 max-h-[70vh] shadow-2xl border border-gray-700 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Video Files</h3>
              <button onClick={() => setShowSequenceMenu(false)} className="text-gray-400 hover:text-white">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto">
              {[...sequences].sort((a, b) => {
                // Sort by start time (date first, then time)
                return a.startTime.getTime() - b.startTime.getTime();
              }).map((seq) => {
                const isSelected = seq.id === sequence.id;
                return (
                  <div
                    key={seq.id}
                    className={`w-full px-4 py-3 flex items-center gap-3 text-left transition-colors group ${
                      isSelected
                        ? 'bg-blue-600/20 text-white'
                        : 'hover:bg-gray-800 text-gray-300'
                    }`}
                  >
                    <button
                      onClick={() => {
                        onSelectSequence(seq);
                        setShowSequenceMenu(false);
                      }}
                      className="flex-1 min-w-0 text-left"
                    >
                      {/* Date on top (larger) */}
                      <div className="text-sm font-medium text-white">
                        {seq.dateRange}
                      </div>
                      {/* Time range below (smaller) */}
                      <div className="text-xs text-gray-400/60 truncate">
                        {seq.timeRange}
                      </div>
                      {/* Duration and clip count - always show clip count */}
                      <div className="text-xs text-gray-500 flex items-center gap-2">
                        <span>Duration: {seq.durationFormatted}</span>
                        <span>·</span>
                        <span>{seq.clipCount} clip{seq.clipCount !== 1 ? 's' : ''}</span>
                      </div>
                    </button>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isSelected && <IconCheck size={16} className="text-blue-400" />}
                      {/* Delete button - visible on hover or when selected */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (sequences.length === 1) {
                            // If only one sequence, Discard all
                            onClear();
                          } else {
                            // Delete this specific sequence
                            onDeleteSequence?.(seq.id);
                          }
                          setShowSequenceMenu(false);
                        }}
                        className={`p-1.5 rounded transition-all ${
                          isSelected 
                            ? 'text-red-400 hover:bg-red-600/20 opacity-100' 
                            : 'text-gray-500 hover:text-red-400 hover:bg-red-600/20 opacity-0 group-hover:opacity-100'
                        }`}
                        title={sequences.length === 1 ? 'Discard all' : 'Delete this sequence'}
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div className="border-t border-gray-700 p-3 flex gap-2">
              <button
                onClick={() => {
                  onClear();
                  setShowSequenceMenu(false);
                }}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 text-xs font-medium transition-colors"
              >
                <IconTrash size={14} />
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

        {/* Telemetry Timeline */}
        {totalDuration > 0 && (
          <TelemetryTimeline
            allSeiMessages={allSeiMessages}
            fps={fps}
            duration={totalDuration}
            currentTime={absoluteTime}
            onSeek={handleTimelineSeek}
            onDraggingChange={setIsTimelineDragging}
            clipBoundaries={sequence.momentOffsets}
            event={sequence.event}
            sequenceStartTime={sequence.startTime}
            isEditMode={isEditMode}
            isTrimming={isTrimming}
            onTrimmingChange={setIsTrimming}
            trimPoints={trimPoints}
            onTrimChange={handleTrimChange}
            onTrimPreview={handleTrimPreview}
            cameraSegments={cameraSegments}
            onCameraSegmentsChange={setCameraSegments}
            selectedAngle={selectedAngle}
            availableAngles={availableAngles}
            disableEventTooltip={showSequenceMenu}
            showEventMarker={showEventMarker}
            layout={layout}
            tripleViewAngles={layoutConfig.triple.cameras}
            hasCustomCameraTrack={hasCustomCameraTrack}
          />
        )}
      </div>
    </div>
  );
}
