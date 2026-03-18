'use client';

import { useMemo, useRef, useCallback, useEffect, useState, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { IconArrowUp, IconArrowDown, IconArrowDownLeft, IconArrowDownRight, IconArrowLeft, IconArrowRight } from '@tabler/icons-react';
import { SeiWithFrameIndex } from '@/lib/dashcam-mp4';
import { TrimPoints, CameraSegment, ANGLE_COLORS, ANGLE_LABELS, TeslaEvent } from '@/types/video';
import { Tooltip } from './Tooltip';

// Camera angle icons for track labels
const ANGLE_ICONS: Record<string, ReactNode> = {
  front: <IconArrowUp size={10} />,
  back: <IconArrowDown size={10} />,
  left_repeater: <IconArrowDownLeft size={10} />,
  right_repeater: <IconArrowDownRight size={10} />,
  left_pillar: <IconArrowLeft size={10} />,
  right_pillar: <IconArrowRight size={10} />,
};

// Helper function to merge adjacent segments with the angle
function mergeAdjacentSegments(segments: CameraSegment[]): CameraSegment[] {
  if (segments.length <= 1) return segments;
  
  const merged: CameraSegment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && last.angle === seg.angle && Math.abs(last.endTime - seg.startTime) < 0.1) {
      last.endTime = seg.endTime;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

// Event Tooltip Component with fixed positioning to avoid clipping
interface EventTooltipProps {
  event: TeslaEvent;
  markerRect: DOMRect | null;
}

function EventTooltip({ event, markerRect }: EventTooltipProps) {
  const [tooltipRect, setTooltipRect] = useState<DOMRect | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      setTooltipRect(contentRef.current.getBoundingClientRect());
    }
  }, []);

  if (!markerRect) return null;

  const tooltipWidth = tooltipRect?.width ?? 200;
  const tooltipHeight = tooltipRect?.height ?? 60;
  const padding = 8;
  const shiftOffset = 24; // 24px shift for left/right alignment
  
  // Calculate marker center
  const markerCenterX = markerRect.left + markerRect.width / 2;
  // The diamond tip is visually near the top of the marker element
  const markerTipY = markerRect.top + 4; // Approximate tip position
  
  // Determine horizontal alignment based on viewport edges
  let left: number;
  let align: 'left' | 'center' | 'right' = 'center';
  
  const wouldClipLeft = markerCenterX - tooltipWidth / 2 < padding;
  const wouldClipRight = markerCenterX + tooltipWidth / 2 > window.innerWidth - padding;
  
  if (wouldClipLeft) {
    // Left align: shift left by 10px
    left = Math.max(padding, markerCenterX - tooltipWidth + shiftOffset);
    align = 'left';
  } else if (wouldClipRight) {
    // Right align: shift right by 10px
    left = Math.min(window.innerWidth - tooltipWidth - padding, markerCenterX - shiftOffset);
    align = 'right';
  } else {
    // Center align
    left = markerCenterX - tooltipWidth / 2;
    align = 'center';
  }
  
  // Position tooltip arrow to align with diamond tip
  // Arrow tip is at: top + tooltipHeight - 4 (arrow offset)
  // We want this to equal markerTipY - shiftOffset (shift up by 10px)
  const top = markerTipY - shiftOffset - tooltipHeight + 2; // +4 for arrow, -2 for fine tuning

  // Arrow position: point to the diamond
  const arrowX = markerCenterX - left;
  const arrowPadding = 12;
  const arrowLeft = {
    left: Math.min(Math.max(arrowX, arrowPadding), tooltipWidth - arrowPadding),
    center: tooltipWidth / 2,
    right: Math.min(Math.max(arrowX, arrowPadding), tooltipWidth - arrowPadding),
  };

  return createPortal(
    <div 
      className="fixed pointer-events-none z-[9999]"
      style={{ left, top }}
    >
      <div 
        ref={contentRef}
        className="bg-gray-900/30 backdrop-blur-sm border border-orange-500/40 rounded-lg px-3 py-2 text-xs shadow-xl whitespace-nowrap"
      >
        <div className="font-semibold text-orange-400">{event.reasonLabel}</div>
        {(event.city || event.street) && (
          <div className="text-gray-400 mt-0.5">
            {[event.street, event.city].filter(Boolean).join(', ')}
          </div>
        )}
        <div className="text-gray-500 mt-0.5 text-[10px]">
          {event.timestamp.toLocaleTimeString('en-US', { hour12: false })}
        </div>
      </div>
      <div 
        className="absolute w-2 h-2 bg-gray-900/95 border-r border-b border-orange-500/40 rotate-45 -bottom-1"
        style={{ left: arrowLeft[align] - 4 }}
      />
    </div>,
    document.body
  );
}

interface TelemetryTimelineProps {
  allSeiMessages: SeiWithFrameIndex[];
  fps: number;
  duration: number;
  currentTime: number;
  onSeek: (time: number) => void;
  onDraggingChange?: (isDragging: boolean) => void;
  clipBoundaries?: number[];  // Offset times where each clip starts (for multi-clip sequences)
  event?: TeslaEvent;
  sequenceStartTime?: Date;
  // Edit mode props
  isEditMode?: boolean;
  isTrimming?: boolean;  // When true, show full timeline for trimming
  onTrimmingChange?: (isTrimming: boolean) => void;
  trimPoints?: TrimPoints | null;
  onTrimChange?: (trimPoints: TrimPoints) => void;
  onTrimPreview?: (time: number | null) => void;
  cameraSegments?: CameraSegment[];
  onCameraSegmentsChange?: (segments: CameraSegment[]) => void;
  selectedAngle?: string;
  availableAngles?: string[];  // For drag-drop palette
  // When true, hide event tooltip (e.g., when Video Files panel is open)
  disableEventTooltip?: boolean;
  // When false, hide event marker on timeline
  showEventMarker?: boolean;
  // Triple view compatibility
  layout?: 'single' | 'pip' | 'triple' | 'all';
  tripleViewAngles?: string[];
  hasCustomCameraTrack?: boolean;
}

interface EventSegment {
  startTime: number;
  endTime: number;
  intensity?: number; // 0-1 for continuous values like gas
}

interface TrackData {
  id: string;
  label: string;
  color: string;
  segments: EventSegment[];
}

export function TelemetryTimeline({
  allSeiMessages,
  fps,
  duration,
  currentTime,
  onSeek,
  onDraggingChange,
  clipBoundaries = [],
  event,
  sequenceStartTime,
  isEditMode = false,
  isTrimming = false,
  onTrimmingChange,
  trimPoints,
  onTrimChange,
  onTrimPreview,
  cameraSegments = [],
  onCameraSegmentsChange,
  selectedAngle,
  availableAngles = [],
  disableEventTooltip = false,
  showEventMarker = true,
  layout = 'single',
  tripleViewAngles = [],
  hasCustomCameraTrack = false,
}: TelemetryTimelineProps) {
  // Process telemetry data into timeline tracks
  const tracks = useMemo((): TrackData[] => {
    if (allSeiMessages.length === 0 || fps <= 0) return [];

    const frameToTime = (frameIndex: number) => frameIndex / fps;
    const frameDuration = 1 / fps;

    // Helper to build segments from boolean events
    const buildBooleanSegments = (
      predicate: (sei: SeiWithFrameIndex) => boolean
    ): EventSegment[] => {
      const segments: EventSegment[] = [];
      let currentSegment: EventSegment | null = null;

      for (const msg of allSeiMessages) {
        const time = frameToTime(msg.frameIndex);
        const isActive = predicate(msg);

        if (isActive && !currentSegment) {
          currentSegment = { startTime: time, endTime: time + frameDuration };
        } else if (isActive && currentSegment) {
          currentSegment.endTime = time + frameDuration;
        } else if (!isActive && currentSegment) {
          segments.push(currentSegment);
          currentSegment = null;
        }
      }

      if (currentSegment) {
        segments.push(currentSegment);
      }

      return segments;
    };

    // Helper to build segments with intensity for continuous values
    const buildIntensitySegments = (
      getValue: (sei: SeiWithFrameIndex) => number,
      threshold: number = 0.05
    ): EventSegment[] => {
      const segments: EventSegment[] = [];
      let currentSegment: EventSegment | null = null;

      for (const msg of allSeiMessages) {
        const time = frameToTime(msg.frameIndex);
        const value = getValue(msg);
        const isActive = value > threshold;

        if (isActive && !currentSegment) {
          currentSegment = { startTime: time, endTime: time + frameDuration, intensity: value };
        } else if (isActive && currentSegment) {
          currentSegment.endTime = time + frameDuration;
          // Update intensity to max seen in this segment
          currentSegment.intensity = Math.max(currentSegment.intensity || 0, value);
        } else if (!isActive && currentSegment) {
          segments.push(currentSegment);
          currentSegment = null;
        }
      }

      if (currentSegment) {
        segments.push(currentSegment);
      }

      return segments;
    };

    // Build all tracks
    return [
      {
        id: 'gas',
        label: 'Gas',
        color: '#22c55e', // green
        segments: buildIntensitySegments((msg) => {
          const val = msg.sei.accelerator_pedal_position || 0;
          return val > 1 ? val / 100 : val; // Normalize to 0-1
        }, 0.05), 
      },
      {
        id: 'brake',
        label: 'Brake',
        color: '#ef4444', // red
        segments: buildBooleanSegments((msg) => msg.sei.brake_applied === true),
      },
      {
        id: 'left-blinker',
        label: 'Left',
        color: '#f59e0b', // amber
        segments: buildBooleanSegments((msg) => msg.sei.blinker_on_left === true),
      },
      {
        id: 'right-blinker',
        label: 'Right',
        color: '#f59e0b', // amber
        segments: buildBooleanSegments((msg) => msg.sei.blinker_on_right === true),
      },
      {
        id: 'steering',
        label: 'Steer',
        color: '#3b82f6', // blue
        segments: buildIntensitySegments((msg) => {
          const angle = Math.abs(msg.sei.steering_wheel_angle || 0);
          return Math.min(1, angle / 180); // Normalize to 0-1 (180° = full)
        }, 0.005),
      },
    ];
  }, [allSeiMessages, fps]);

  // Dragging/scrubbing state
  const timelineRef = useRef<HTMLDivElement>(null);
  const cameraTrackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggingTrimHandle, setDraggingTrimHandle] = useState<'in' | 'out' | null>(null);
  const [draggingSegmentBoundary, setDraggingSegmentBoundary] = useState<number | null>(null);
  const [draggingAngle, setDraggingAngle] = useState<string | null>(null); // For drag-drop from palette
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null); // Mouse position for drag ghost

  // Calculate event position in absolute time
  const eventAbsoluteTime = useMemo(() => {
    if (!event || !sequenceStartTime) return null;
    const offsetSeconds = (event.timestamp.getTime() - sequenceStartTime.getTime()) / 1000;
    return offsetSeconds;
  }, [event, sequenceStartTime]);

  // Calculate view bounds based on trim state
  // Always ensure view includes any post-video events
  const viewStart = isTrimming ? 0 : (trimPoints?.inPoint ?? 0);
  let viewEnd = isTrimming ? duration : (trimPoints?.outPoint ?? duration);
  
  // If event is after video end, extend view to show it (with buffer for marker visibility)
  if (eventAbsoluteTime !== null && eventAbsoluteTime > duration) {
    // Add 2 seconds buffer after event to ensure marker is fully visible
    viewEnd = Math.max(viewEnd, eventAbsoluteTime + 2);
  }
  
  const viewDuration = viewEnd - viewStart;

  const [showEventTooltip, setShowEventTooltip] = useState(false);
  const [markerRect, setMarkerRect] = useState<DOMRect | null>(null);
  const eventMarkerRef = useRef<HTMLDivElement>(null);

  // Notify parent when dragging state changes
  useEffect(() => {
    onDraggingChange?.(isDragging || draggingTrimHandle !== null || draggingSegmentBoundary !== null);
  }, [isDragging, draggingTrimHandle, draggingSegmentBoundary, onDraggingChange]);

  // Calculate time from mouse position (view-aware)
  const getTimeFromEvent = useCallback((clientX: number): number => {
    if (!timelineRef.current) return 0;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    return viewStart + (percentage * viewDuration);
  }, [viewStart, viewDuration]);

  // Handle mouse down - start dragging
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Don't start dragging if clicking on interactive elements
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-seek]')) {
      return;
    }
    e.preventDefault();
    setIsDragging(true);
    const time = getTimeFromEvent(e.clientX);
    onSeek(time);
  }, [getTimeFromEvent, onSeek]);

  // Handle touch start - start dragging
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    // Don't start dragging if touching interactive elements
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-seek]')) {
      return;
    }
    setIsDragging(true);
    const time = getTimeFromEvent(e.touches[0].clientX);
    onSeek(time);
  }, [getTimeFromEvent, onSeek]);

  // Handle mouse/touch move while dragging (playhead, trim handles, or segment boundaries)
  useEffect(() => {
    if (!isDragging && !draggingTrimHandle && draggingSegmentBoundary === null) return;

    const handleMouseMove = (e: MouseEvent) => {
      const time = getTimeFromEvent(e.clientX);

      if (draggingTrimHandle && trimPoints && onTrimChange) {
        let previewTime: number;
        if (draggingTrimHandle === 'in') {
          // In point can't go past out point - 1 second
          const newInPoint = Math.max(0, Math.min(time, trimPoints.outPoint - 1));
          onTrimChange({ ...trimPoints, inPoint: newInPoint });
          previewTime = newInPoint;
        } else {
          // Out point can't go before in point + 1 second
          const newOutPoint = Math.min(duration, Math.max(time, trimPoints.inPoint + 1));
          onTrimChange({ ...trimPoints, outPoint: newOutPoint });
          previewTime = newOutPoint;
        }
        // Preview video at the trim position
        onTrimPreview?.(previewTime);
      } else if (draggingSegmentBoundary !== null && onCameraSegmentsChange) {
        // Dragging a segment boundary - allow merging by dragging to edges
        const segIdx = draggingSegmentBoundary;
        if (segIdx > 0 && segIdx < cameraSegments.length) {
          const prevSeg = cameraSegments[segIdx - 1];
          const currSeg = cameraSegments[segIdx];
          // Allow boundary to go all the way to previous segment's start or current segment's end
          // This enables one segment to completely cover another
          const minTime = prevSeg.startTime;
          const maxTime = currSeg.endTime;
          const newBoundary = Math.max(minTime, Math.min(maxTime, time));

          // If dragged to the edge, merge the segments based on direction
          if (newBoundary <= prevSeg.startTime) {
            // Dragged all the way left - current (right) segment wins, remove previous
            const newSegments = cameraSegments.filter((_, idx) => idx !== segIdx - 1).map((seg, idx, arr) => {
              if (idx === segIdx - 1) {
                // This was the current segment, now extends to cover previous
                return { ...seg, startTime: prevSeg.startTime };
              }
              return seg;
            });
            onCameraSegmentsChange(mergeAdjacentSegments(newSegments));
          } else if (newBoundary >= currSeg.endTime) {
            // Dragged all the way right - previous (left) segment wins, remove current
            const newSegments = cameraSegments.filter((_, idx) => idx !== segIdx).map((seg, idx, arr) => {
              if (idx === segIdx - 1) {
                return { ...seg, endTime: currSeg.endTime };
              }
              return seg;
            });
            onCameraSegmentsChange(mergeAdjacentSegments(newSegments));
          } else {
            const newSegments = cameraSegments.map((seg, idx) => {
              if (idx === segIdx - 1) {
                return { ...seg, endTime: newBoundary };
              } else if (idx === segIdx) {
                return { ...seg, startTime: newBoundary };
              }
              return seg;
            });
            // Check if the two segments now have the same angle and should be merged
            onCameraSegmentsChange(mergeAdjacentSegments(newSegments));
          }
          onTrimPreview?.(newBoundary);
        }
      } else if (isDragging) {
        onSeek(time);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      const time = getTimeFromEvent(e.touches[0].clientX);

      if (draggingTrimHandle && trimPoints && onTrimChange) {
        let previewTime: number;
        if (draggingTrimHandle === 'in') {
          const newInPoint = Math.max(0, Math.min(time, trimPoints.outPoint - 1));
          onTrimChange({ ...trimPoints, inPoint: newInPoint });
          previewTime = newInPoint;
        } else {
          const newOutPoint = Math.min(duration, Math.max(time, trimPoints.inPoint + 1));
          onTrimChange({ ...trimPoints, outPoint: newOutPoint });
          previewTime = newOutPoint;
        }
        onTrimPreview?.(previewTime);
      } else if (draggingSegmentBoundary !== null && onCameraSegmentsChange) {
        const segIdx = draggingSegmentBoundary;
        if (segIdx > 0 && segIdx < cameraSegments.length) {
          const prevSeg = cameraSegments[segIdx - 1];
          const currSeg = cameraSegments[segIdx];
          const minTime = prevSeg.startTime;
          const maxTime = currSeg.endTime;
          const newBoundary = Math.max(minTime, Math.min(maxTime, time));

          if (newBoundary <= prevSeg.startTime) {
            // Dragged all the way left - current (right) segment wins
            const newSegments = cameraSegments.filter((_, idx) => idx !== segIdx - 1).map((seg, idx, arr) => {
              if (idx === segIdx - 1) {
                return { ...seg, startTime: prevSeg.startTime };
              }
              return seg;
            });
            onCameraSegmentsChange(mergeAdjacentSegments(newSegments));
          } else if (newBoundary >= currSeg.endTime) {
            // Dragged all the way right - previous (left) segment wins
            const newSegments = cameraSegments.filter((_, idx) => idx !== segIdx).map((seg, idx, arr) => {
              if (idx === segIdx - 1) {
                return { ...seg, endTime: currSeg.endTime };
              }
              return seg;
            });
            onCameraSegmentsChange(mergeAdjacentSegments(newSegments));
          } else {
            const newSegments = cameraSegments.map((seg, idx) => {
              if (idx === segIdx - 1) {
                return { ...seg, endTime: newBoundary };
              } else if (idx === segIdx) {
                return { ...seg, startTime: newBoundary };
              }
              return seg;
            });
            // Check if the two segments now have the same angle and should be merged
            onCameraSegmentsChange(mergeAdjacentSegments(newSegments));
          }
          onTrimPreview?.(newBoundary);
        }
      } else if (isDragging) {
        onSeek(time);
      }
    };

    const handleEnd = () => {
      setIsDragging(false);
      setDraggingTrimHandle(null);
      setDraggingSegmentBoundary(null);
      // Clear preview when done dragging
      onTrimPreview?.(null);
    };

    // Listen on document to catch events outside the component
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging, draggingTrimHandle, draggingSegmentBoundary, getTimeFromEvent, onSeek, trimPoints, onTrimChange, onTrimPreview, duration, cameraSegments, onCameraSegmentsChange]);

  // Handle trim handle mouse down
  const handleTrimHandleMouseDown = useCallback((handle: 'in' | 'out') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingTrimHandle(handle);
  }, []);

  
  // Handle segment boundary drag start
  const handleSegmentBoundaryMouseDown = useCallback((segmentIndex: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingSegmentBoundary(segmentIndex);
  }, []);

  // Handle segment double-click to remove (merge with adjacent)
  const handleSegmentDoubleClick = useCallback((segmentIndex: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onCameraSegmentsChange || cameraSegments.length <= 1) return;

    // Cannot remove the only segment
    if (cameraSegments.length === 1) return;

    const targetSeg = cameraSegments[segmentIndex];
    let newSegments: CameraSegment[];

    if (segmentIndex === 0) {
      // First segment: merge with next, keep next segment's angle but extend backwards
      const nextSeg = cameraSegments[1];
      newSegments = cameraSegments.filter((_, idx) => idx !== 0).map((seg, idx) => {
        if (idx === 0) {
          return { ...seg, startTime: targetSeg.startTime };
        }
        return seg;
      });
    } else if (segmentIndex === cameraSegments.length - 1) {
      // Last segment: merge with previous, extend previous segment
      const prevSeg = cameraSegments[segmentIndex - 1];
      newSegments = cameraSegments.filter((_, idx) => idx !== segmentIndex).map((seg, idx) => {
        if (idx === segmentIndex - 1) {
          return { ...seg, endTime: targetSeg.endTime };
        }
        return seg;
      });
    } else {
      // Middle segment: merge with previous by extending previous to cover this one
      newSegments = cameraSegments.filter((_, idx) => idx !== segmentIndex).map((seg, idx, arr) => {
        if (idx === segmentIndex - 1) {
          return { ...seg, endTime: targetSeg.endTime };
        }
        return seg;
      });
    }
    
    // Merge adjacent segments with same angle
    onCameraSegmentsChange(mergeAdjacentSegments(newSegments));
  }, [cameraSegments, onCameraSegmentsChange]);

  // Handle segment click to change its angle
  const handleSegmentClick = useCallback((segmentIndex: number, newAngle: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onCameraSegmentsChange) return;

    const newSegments = cameraSegments.map((seg, idx) => {
      if (idx === segmentIndex) {
        return { ...seg, angle: newAngle };
      }
      return seg;
    });

    // Merge adjacent segments with the same angle
    onCameraSegmentsChange(mergeAdjacentSegments(newSegments));
  }, [cameraSegments, onCameraSegmentsChange]);

  // Handle drag start from angle palette
  const handleAngleDragStart = useCallback((angle: string, e: React.MouseEvent) => {
    setDraggingAngle(angle);
    setDragPosition({ x: e.clientX, y: e.clientY });
  }, []);

  // Handle drop on camera track
  const handleCameraTrackDrop = useCallback((e: React.MouseEvent) => {
    if (!draggingAngle || !cameraTrackRef.current || !onCameraSegmentsChange || !trimPoints) return;

    let dropTime: number;
    
    // Check if playhead is at the edges (within 0.5s of start or end)
    const isAtStart = currentTime <= trimPoints.inPoint + 0.5;
    const isAtEnd = currentTime >= trimPoints.outPoint - 0.5;
    
    // Check if playhead is at a segment boundary (within 0.3s of any boundary)
    const boundaries = cameraSegments.slice(1).map(seg => seg.startTime);
    const isAtBoundary = boundaries.some(boundary => Math.abs(currentTime - boundary) < 0.3);
    
    const isFreeDropMode = isAtStart || isAtEnd || isAtBoundary;

    if (isFreeDropMode) {
      // Free drop mode: use mouse position for drop location
      const rect = cameraTrackRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, x / rect.width));
      
      const trimStart = trimPoints.inPoint;
      const trimEnd = trimPoints.outPoint;
      const trimDuration = trimEnd - trimStart;
      dropTime = trimStart + (percentage * trimDuration);
    } else {
      // Fixed mode: use current playhead position
      dropTime = Math.max(trimPoints.inPoint, Math.min(trimPoints.outPoint, currentTime));
    }

    // Find which segment was dropped on and split it
    const segIdx = cameraSegments.findIndex(
      seg => dropTime >= seg.startTime && dropTime < seg.endTime
    );

    if (segIdx === -1) {
      setDraggingAngle(null);
      return;
    }

    const clickedSegment = cameraSegments[segIdx];

    // If dropping near the start, just change the segment's angle
    if (Math.abs(dropTime - clickedSegment.startTime) < 0.5) {
      const newSegments = cameraSegments.map((seg, idx) =>
        idx === segIdx ? { ...seg, angle: draggingAngle } : seg
      );
      // Merge adjacent segments with the same angle
      onCameraSegmentsChange(mergeAdjacentSegments(newSegments));
    } else {
      // Split the segment at drop position
      const newSegments = [...cameraSegments];
      newSegments.splice(segIdx, 1,
        { startTime: clickedSegment.startTime, endTime: dropTime, angle: clickedSegment.angle },
        { startTime: dropTime, endTime: clickedSegment.endTime, angle: draggingAngle }
      );

      // Merge adjacent segments with same angle
      onCameraSegmentsChange(mergeAdjacentSegments(newSegments));
      
      // Move playhead to the split position (boundary)
      onSeek(dropTime);
    }

    setDraggingAngle(null);
  }, [draggingAngle, cameraSegments, onCameraSegmentsChange, trimPoints, currentTime, onSeek]);

  // Track mouse movement and cancel drag on mouse up
  useEffect(() => {
    if (!draggingAngle) return;

    const handleMouseMove = (e: MouseEvent) => {
      setDragPosition({ x: e.clientX, y: e.clientY });
    };

    const handleMouseUp = () => {
      setDraggingAngle(null);
      setDragPosition(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingAngle]);

  if (duration <= 0) {
    return null;
  }

  // Format time as m:ss
  const formatTimeShort = (seconds: number, showMs: boolean = true) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    
    if (showMs) {
      return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Calculate trim values (viewStart/viewEnd/viewDuration already calculated above for getTimeFromEvent)
  const trimStart = trimPoints?.inPoint ?? 0;
  const trimEnd = trimPoints?.outPoint ?? duration;
  const trimmedDuration = trimEnd - trimStart;
  const isTrimmed = trimStart > 0 || trimEnd < duration;

  // Calculate positions relative to current view
  const timeToPosition = (time: number) => ((time - viewStart) / viewDuration) * 100;
  const playheadPosition = timeToPosition(Math.max(viewStart, Math.min(viewEnd, currentTime)));

  // Trim handle positions (relative to full timeline, only when trimming)
  const inPointPosition = trimPoints ? (trimPoints.inPoint / duration) * 100 : 0;
  const outPointPosition = trimPoints ? (trimPoints.outPoint / duration) * 100 : 100;

  // Generate time markers
  const timeMarkers = useMemo(() => {
    const markers: number[] = [];
    // Always include viewStart (usually 0)
    markers.push(viewStart);
    const interval = viewDuration > 120 ? 30 : 15;
    for (let t = viewStart + interval; t <= viewEnd; t += interval) {
      markers.push(t);
    }
    if (markers[markers.length - 1] !== viewEnd) {
      markers.push(viewEnd);
    }
    return markers;
  }, [viewStart, viewEnd, viewDuration]);

  // Filter camera segments to current view
  const visibleCameraSegments = useMemo(() => {
    // When trimming, show full timeline; when not trimming, show trimmed portion
    const rangeStart = isTrimming ? 0 : trimStart;
    const rangeEnd = isTrimming ? duration : trimEnd;

    return cameraSegments
      .filter(seg => seg.endTime > rangeStart && seg.startTime < rangeEnd)
      .map(seg => ({
        ...seg,
        startTime: Math.max(seg.startTime, rangeStart),
        endTime: Math.min(seg.endTime, rangeEnd),
      }));
  }, [cameraSegments, isTrimming, trimStart, trimEnd, duration]);

  return (
    <div className="bg-gray-800/50 rounded-xl p-3 space-y-2 px-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 font-medium">
            {isTrimming ? 'Trim Video' : 'Timeline'}
          </span>

          {/* Trim info badge - show in edit mode, real-time update during trimming */}
          {isEditMode && (
            <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
              isTrimming 
                ? 'bg-yellow-500/30 text-yellow-300 border border-yellow-500/30' 
                : isTrimmed 
                  ? 'bg-yellow-500/20 text-yellow-400' 
                  : 'bg-gray-700 text-gray-400'
            }`}>
              {formatTimeShort(trimStart)} → {formatTimeShort(trimEnd)} ({formatTimeShort(trimmedDuration)})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Track legend */}
          {showEventMarker && event && (
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rotate-45 bg-orange-500" />
              <span className="text-[10px] text-orange-400 font-medium">{event.reasonLabel}</span>
            </div>
          )}
          {tracks.map((track) => (
            <div key={track.id} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: track.color }} />
              <span className="text-[10px] text-gray-500">{track.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Trim mode instructions */}
      {isTrimming && (
        <div className="text-[10px] text-yellow-400">
          Drag the yellow handles to set start and end points, then click Done
        </div>
      )}

      {/* Main Timeline */}
      <div
        ref={timelineRef}
        className={`relative select-none min-h-[60px] rounded bg-gray-700/30 ${isDragging || draggingTrimHandle ? 'cursor-grabbing' : 'cursor-pointer'}`}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        {/* Clip boundary markers */}
        {clipBoundaries.length > 1 && clipBoundaries.slice(1).map((boundary, idx) => {
          if (boundary < viewStart || boundary > viewEnd) return null;
          return (
            <div
              key={`clip-${idx}`}
              className="absolute top-0 bottom-0 w-0.5 z-[2] pointer-events-none"
              style={{
                left: `${timeToPosition(boundary)}%`,
                background: 'repeating-linear-gradient(to bottom, #3b82f6 0, #3b82f6 4px, transparent 4px, transparent 8px)',
              }}
              title={`Clip ${idx + 2} start`}
            />
          );
        })}

        {/* Event marker - always show if in trim range (even if beyond video duration) */}
        {showEventMarker && eventAbsoluteTime !== null && eventAbsoluteTime >= viewStart && (
          // For post-video events, always show them in trimming mode
          // For normal playback, only show if within trim range
          (isTrimming || eventAbsoluteTime <= viewEnd || eventAbsoluteTime > duration)
         ) && (
          <div
            ref={eventMarkerRef}
            className="absolute top-0 bottom-0 z-[5] group"
            style={{ left: `${timeToPosition(eventAbsoluteTime)}%` }}
            onMouseEnter={() => {
              // Get marker position for fixed positioning
              if (eventMarkerRef.current) {
                setMarkerRect(eventMarkerRef.current.getBoundingClientRect());
              }
              setShowEventTooltip(true);
            }}
            onMouseLeave={() => setShowEventTooltip(false)}
          >
            {/* Vertical line */}
            <div className="absolute top-0 bottom-0 w-0.5 bg-orange-500 -translate-x-1/2 pointer-events-none" />
            {/* Diamond marker */}
            <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 pointer-events-auto cursor-default">
              <div className="w-3 h-3 bg-orange-500 rotate-45 transform mx-auto border border-orange-300 shadow-lg shadow-orange-500/30" />
            </div>
            {/* Tooltip */}
            {showEventTooltip && event && (
              <EventTooltip 
                event={event} 
                markerRect={markerRect}
              />
            )}
          </div>
        )}

        {/* Secondary tick marks - dynamic interval based on clip count */}
        {(() => {
          // Calculate secondary tick interval: 1 clip = 1s, 2-4 clips = 2s, 5+ clips = 4s
          const clipCount = Math.max(1, clipBoundaries.length > 0 ? clipBoundaries.length - 1 : 1);
          let secondaryInterval: number;
          if (clipCount === 1) {
            secondaryInterval = 1;
          } else if (clipCount <= 4) {
            secondaryInterval = 2;
          } else {
            secondaryInterval = 4;
          }
          
          return Array.from({ length: Math.ceil((viewEnd - viewStart) / secondaryInterval) }, (_, i) => viewStart + i * secondaryInterval)
            .filter(time => time > viewStart && time < viewEnd && !timeMarkers.includes(time))
            .map((time) => (
              <div
                key={`tick-${time}`}
                className="absolute top-0 bottom-0 w-px bg-gray-700/30 z-[0] pointer-events-none"
                style={{ left: `${timeToPosition(time)}%` }}
              />
            ));
        })()}

        {/* Primary time interval lines - skip boundary markers (viewStart and viewEnd) */}
        {timeMarkers
          .filter(time => time > viewStart && time < viewEnd)
          .map((time) => (
            <div
              key={time}
              className="absolute top-0 bottom-0 w-px bg-gray-600/50 z-[1] pointer-events-none"
              style={{ left: `${timeToPosition(time)}%` }}
            />
          ))}

        {/* Telemetry tracks */}
        {tracks.map((track) => (
          <div
            key={track.id}
            className="relative h-3 rounded-sm mb-0.5 overflow-visible"
            title={track.label}
          >
            {/* Background limited to actual video duration */}
            <div 
              className="absolute top-0 bottom-0 bg-gray-700/50 rounded-sm"
              style={{ 
                left: '0%', 
                width: `${((Math.min(duration, viewEnd) - viewStart) / viewDuration) * 100}%` 
              }}
            />
            {track.segments.map((segment, idx) => {
              if (segment.endTime < viewStart || segment.startTime > viewEnd) return null;
              const segStart = Math.max(segment.startTime, viewStart);
              const segEnd = Math.min(segment.endTime, duration); // Limit to actual video end, not viewEnd
              const left = timeToPosition(segStart);
              const width = ((segEnd - segStart) / viewDuration) * 100;
              const opacity = segment.intensity !== undefined ? 0.4 + segment.intensity * 0.6 : 0.9;

              const isLeftBlinker = track.id === 'left-blinker';
              const isRightBlinker = track.id === 'right-blinker';
              const showArrow = isLeftBlinker || isRightBlinker;

              return (
                <div
                  key={idx}
                  className="absolute top-0 bottom-0 rounded-sm flex items-center"
                  style={{
                    left: `${left}%`,
                    width: `${Math.max(width, 0.5)}%`,
                    backgroundColor: track.color,
                    opacity,
                    justifyContent: 'center',
                  }}
                >
                  {showArrow && width > 1 && (
                    <Image 
                      src="/blinker.svg" 
                      alt={isLeftBlinker ? 'Left' : 'Right'}
                      width={10}
                      height={10}
                      className={`pointer-events-none opacity-30 ${isLeftBlinker ? '' : 'rotate-180'}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {/* === TRIM UI (only when trimming) === */}
        {isTrimming && trimPoints && (
          <>
            {/* Dimmed regions */}
            <div
              className="absolute top-0 bottom-0 bg-black/50 z-[3] pointer-events-none"
              style={{ left: 0, width: `${inPointPosition}%` }}
            />
            <div
              className="absolute top-0 bottom-0 bg-black/50 z-[3] pointer-events-none"
              style={{ left: `${outPointPosition}%`, width: `${100 - outPointPosition}%` }}
            />

            {/* Yellow frame */}
            <div
              className="absolute top-0 h-1 bg-yellow-500 z-[14] pointer-events-none"
              style={{ left: `${inPointPosition}%`, width: `${outPointPosition - inPointPosition}%` }}
            />
            <div
              className="absolute bottom-0 h-1 bg-yellow-500 z-[14] pointer-events-none"
              style={{ left: `${inPointPosition}%`, width: `${outPointPosition - inPointPosition}%` }}
            />

            {/* In handle */}
            <div
              data-no-seek
              className={`absolute top-0 bottom-0 w-4 bg-yellow-500 z-[15] cursor-ew-resize rounded-l-md ${
                draggingTrimHandle === 'in' ? 'bg-yellow-400 w-5 shadow-lg shadow-yellow-500/50' : 'hover:bg-yellow-400'
              }`}
              style={{ left: `${inPointPosition}%`, transform: 'translateX(-100%)' }}
              onMouseDown={handleTrimHandleMouseDown('in')}
              title={`In: ${formatTimeShort(trimPoints.inPoint)}`}
            >
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-3 h-3 text-black/70" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10 17l5-5-5-5v10z" />
                </svg>
              </div>
            </div>

            {/* Out handle */}
            <div
              data-no-seek
              className={`absolute top-0 bottom-0 w-4 bg-yellow-500 z-[15] cursor-ew-resize rounded-r-md ${
                draggingTrimHandle === 'out' ? 'bg-yellow-400 w-5 shadow-lg shadow-yellow-500/50' : 'hover:bg-yellow-400'
              }`}
              style={{ left: `${outPointPosition}%` }}
              onMouseDown={handleTrimHandleMouseDown('out')}
              title={`Out: ${formatTimeShort(trimPoints.outPoint)}`}
            >
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-3 h-3 text-black/70" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M14 7l-5 5 5 5V7z" />
                </svg>
              </div>
            </div>
          </>
        )}

        {/* Playhead */}
        <div
          className={`absolute top-0 bottom-0 w-0.5 bg-white shadow-lg z-10 pointer-events-none will-change-[left] ${
            isDragging ? 'w-1' : ''
          }`}
          style={{ left: `${playheadPosition}%` }}
        >
          <div className={`absolute -top-1 left-1/2 -translate-x-1/2 bg-white rounded-full ${
            isDragging ? 'w-3 h-3 -top-1.5' : 'w-2 h-2'
          }`} />
        </div>
      </div>

      {/* Time legend */}
      <div className="relative h-4">
        {timeMarkers.map((time, idx) => {
          const position = timeToPosition(time);
          const isFirst = idx === 0;
          const isLast = idx === timeMarkers.length - 1;

          return (
            <div
              key={time}
              className="absolute flex flex-col pointer-events-none"
              style={{
                left: isFirst ? '0px' : isLast ? '100%' : `${position}%`,
                transform: isFirst ? 'translateX(0)' : isLast ? 'translateX(-100%)' : 'translateX(-50%)',
                alignItems: isFirst ? 'flex-start' : isLast ? 'flex-end' : 'center',
              }}
            >
              <div className="w-px h-1.5 bg-gray-600" />
              <span className="text-[9px] text-gray-500 tabular-nums">{formatTimeShort(time)}</span>
            </div>
          );
        })}
      </div>

      {/* === CAMERA TRACK (always visible) === */}
      {cameraSegments.length > 0 && (
        <div className="border-t border-gray-700 pt-3 mt-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-purple-400 font-medium">Camera Track</span>
            <span className="text-[10px] text-gray-500">
              {cameraSegments.length > 1 ? 'Drag boundaries • Double-click segment to remove' : ''}
            </span>
          </div>

          {/* Angle palette with drag instruction */}
          <div className="flex items-center gap-2 mb-2">
            <div className="flex items-stretch gap-1">
              {availableAngles.map((angle) => {
                // In triple view, always restrict to layout angles regardless of custom track state
                const isDisabledInTriple = layout === 'triple' && !tripleViewAngles.includes(angle);
                
                return (
                  <div
                    key={angle}
                    className={`h-[24px] px-2 rounded text-[10px] font-medium select-none transition-all shadow-sm flex items-center justify-center ${
                      draggingAngle === angle
                        ? 'opacity-50 scale-95 cursor-grabbing'
                        : isDisabledInTriple
                          ? 'opacity-40 cursor-not-allowed grayscale'
                          : 'cursor-grab hover:scale-105 hover:shadow-md active:scale-95'
                    }`}
                    style={{
                      backgroundColor: ANGLE_COLORS[angle] || '#6B7280',
                      color: 'white',
                      boxShadow: draggingAngle === angle ? 'none' : '0 2px 4px rgba(0,0,0,0.3)'
                    }}
                    onMouseDown={(e) => !isDisabledInTriple && handleAngleDragStart(angle, e)}
                    title={isDisabledInTriple 
                      ? `${ANGLE_LABELS[angle] || angle} is not in triple view layout. Configure layout to enable.`
                      : `Drag ${ANGLE_LABELS[angle] || angle} to timeline`
                    }
                  >
                    <span className="flex items-center gap-0.5 truncate">
                      {ANGLE_ICONS[angle]}
                      <span className="truncate">{ANGLE_LABELS[angle] || angle}</span>
                    </span>
                  </div>
                );
              })}
            </div>
            
            {/* Triple view restriction hint */}
            {layout === 'triple' && (
              <div className="flex items-center gap-1 text-[10px] text-amber-400">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>Only triple view angles enabled. Configure layout to change.</span>
              </div>
            )}
            
            {/* Default drag hint - hide when showing triple view hint */}
            {layout !== 'triple' && (
              <div className="flex items-center gap-1 text-[10px] text-gray-500">
                <svg className="w-4 h-4 text-purple-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 13l-5 5m0 0l-5-5m5 5V6" />
                </svg>
                <span>drag to track</span>
              </div>
            )}
            
            {/* Boundary navigation arrows - show when there are multiple segments */}
            {cameraSegments.length > 1 && (
              <div className="flex items-center gap-1 ml-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    // Find previous boundary or go to start
                    const boundaries = cameraSegments.slice(1).map(seg => seg.startTime);
                    const prevBoundaries = boundaries.filter(b => b < currentTime - 0.1);
                    
                    if (prevBoundaries.length > 0) {
                      // Go to previous boundary
                      onSeek(prevBoundaries[prevBoundaries.length - 1]);
                    } else {
                      // Go to start
                      onSeek(cameraSegments[0].startTime);
                    }
                  }}
                  disabled={currentTime <= cameraSegments[0].startTime + 0.1}
                  className="p-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Previous boundary"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    // Find next boundary or go to end
                    const boundaries = cameraSegments.slice(1).map(seg => seg.startTime);
                    const nextBoundary = boundaries.find(b => b > currentTime + 0.1);
                    
                    if (nextBoundary !== undefined) {
                      // Go to next boundary
                      onSeek(nextBoundary);
                    } else {
                      // Go to end
                      onSeek(cameraSegments[cameraSegments.length - 1].endTime);
                    }
                  }}
                  disabled={currentTime >= cameraSegments[cameraSegments.length - 1].endTime - 0.1}
                  className="p-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Next boundary"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* Camera track - drop zone */}
          <div
            ref={cameraTrackRef}
            className="relative h-10 w-full overflow-visible"
            onMouseUp={draggingAngle ? handleCameraTrackDrop : undefined}
          >
            {/* Background with border limited to actual video duration */}
            <div 
              className={`absolute top-0 bottom-0 rounded-lg transition-all ${
                draggingAngle
                  ? 'bg-purple-500/10 border-2 border-dashed border-purple-500'
                  : 'bg-gray-700/30 border-2 border-dashed border-gray-600/50'
              }`}
              style={{ 
                left: '0%', 
                width: `${((Math.min(duration, viewEnd) - viewStart) / viewDuration) * 100}%` 
              }}
            />
            {/* Render all camera segments - show full timeline when trimming */}
            {cameraSegments.map((segment, idx) => {
              // When trimming, show all segments across full timeline
              // When not trimming, clip to view range
              let left: number, width: number;
              
              if (isTrimming) {
                // Use full timeline (0 to duration)
                left = (segment.startTime / duration) * 100;
                width = ((segment.endTime - segment.startTime) / duration) * 100;
              } else {
                // Clip to visible range
                const clippedStart = Math.max(segment.startTime, viewStart);
                const clippedEnd = Math.min(segment.endTime, viewEnd);
                if (clippedStart >= clippedEnd) return null;
                left = timeToPosition(clippedStart);
                width = ((clippedEnd - clippedStart) / viewDuration) * 100;
              }

              return (
                <div
                  key={idx}
                  className="absolute top-1 bottom-1 flex items-center justify-center rounded transition-all hover:brightness-110 cursor-pointer"
                  style={{
                    left: `${left}%`,
                    width: `${Math.max(width, 1)}%`,
                    backgroundColor: ANGLE_COLORS[segment.angle] || '#6B7280',
                  }}
                  title={`${ANGLE_LABELS[segment.angle]} • Double-click to remove`}
                  onDoubleClick={handleSegmentDoubleClick(idx)}
                >
                  {width > 5 && (
                    <span className="text-[10px] text-white/90 font-medium truncate px-1 pointer-events-none flex items-center gap-0.5">
                      {ANGLE_ICONS[segment.angle]}
                      {ANGLE_LABELS[segment.angle] || segment.angle}
                    </span>
                  )}
                </div>
              );
            })}

            {/* Dimmed overlay for out-of-trim-range areas (similar to main timeline) */}
            {isTrimming && trimPoints && (
              <>
                <div
                  className="absolute top-0 bottom-0 bg-black/50 z-[3] pointer-events-none rounded-l"
                  style={{ left: 0, width: `${(trimPoints.inPoint / duration) * 100}%` }}
                />
                <div
                  className="absolute top-0 bottom-0 bg-black/50 z-[3] pointer-events-none rounded-r"
                  style={{ left: `${(trimPoints.outPoint / duration) * 100}%`, width: `${((duration - trimPoints.outPoint) / duration) * 100}%` }}
                />
              </>
            )}

            {/* Segment boundaries - draggable */}
            {/* Show all boundaries when trimming, only boundaries in trim range when not trimming */}
            {cameraSegments.slice(1).map((segment, idx) => {
              const rangeStart = isTrimming ? 0 : trimStart;
              const rangeEnd = isTrimming ? duration : trimEnd;
              if (segment.startTime <= rangeStart || segment.startTime >= rangeEnd) return null;
              const position = timeToPosition(segment.startTime);

              return (
                <div
                  key={`boundary-${idx}`}
                  data-no-seek
                  className={`absolute top-0 bottom-0 w-4 cursor-ew-resize z-[5] group ${
                    draggingSegmentBoundary === idx + 1 ? 'z-[10]' : ''
                  }`}
                  style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
                  onMouseDown={handleSegmentBoundaryMouseDown(idx + 1)}
                  title="Drag to adjust boundary"
                >
                  <div className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-1 ${
                    draggingSegmentBoundary === idx + 1 ? 'bg-white w-1.5 shadow-lg' : 'bg-white/60 group-hover:bg-white'
                  }`} />
                  <div className={`absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-white shadow ${
                    draggingSegmentBoundary === idx + 1 ? 'bg-purple-500 scale-110' : 'bg-gray-600 group-hover:bg-purple-500'
                  }`} />
                  <div className={`absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-white shadow ${
                    draggingSegmentBoundary === idx + 1 ? 'bg-purple-500 scale-110' : 'bg-gray-600 group-hover:bg-purple-500'
                  }`} />
                </div>
              );
            })}

            {/* Drop indicator when dragging */}
            {draggingAngle && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-purple-500/20 rounded-lg">
                <div className="flex items-center gap-2 text-sm text-purple-300 bg-black/60 px-3 py-1.5 rounded-full">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m0 0l-4-4m4 4l4-4" />
                  </svg>
                  Drop <span className="font-bold">{ANGLE_LABELS[draggingAngle] || draggingAngle}</span> here
                </div>
              </div>
            )}
          </div>

          {/* Playback hint */}
          <div className="text-[10px] text-gray-500 mt-1.5">
            Press play to preview camera switches
          </div>
        </div>
      )}

      {/* Drag ghost - floating badge that follows cursor */}
      {draggingAngle && dragPosition && (
        <div
          className="fixed pointer-events-none z-[1000] px-3 py-1.5 rounded text-xs font-medium shadow-lg transform -translate-x-1/2 -translate-y-1/2"
          style={{
            left: dragPosition.x,
            top: dragPosition.y,
            backgroundColor: ANGLE_COLORS[draggingAngle] || '#6B7280',
            color: 'white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}
        >
          <span className="flex items-center gap-0.5">
            {ANGLE_ICONS[draggingAngle]}
            {ANGLE_LABELS[draggingAngle] || draggingAngle}
          </span>
        </div>
      )}
    </div>
  );
}
