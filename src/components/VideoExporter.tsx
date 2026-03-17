'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { IconDownload, IconPlayerStop, IconLoader2, IconCheck } from '@tabler/icons-react';
import { SeiData, SeiWithFrameIndex } from '@/lib/dashcam-mp4';
import { Output, Mp4OutputFormat, BufferTarget, VideoSampleSource, VideoSample } from 'mediabunny';
import { VideoSequence, TrimPoints, CameraSegment, formatDuration, LayoutCameraConfig, DEFAULT_LAYOUT_CONFIG, ANGLE_LABELS } from '@/types/video';
import { Tooltip } from './Tooltip';

type LayoutType = 'single' | 'pip' | 'triple' | 'all';

interface VideoExporterProps {
  sequence: VideoSequence;
  selectedAngle: string;
  allSeiMessages: SeiWithFrameIndex[];
  fps: number;
  speedUnit: 'mph' | 'kmh';
  filename?: string;
  trimPoints?: TrimPoints | null;
  cameraSegments?: CameraSegment[];
  showTelemetry?: boolean;
  showDateTime?: boolean;
  showMap?: boolean;
  layout?: LayoutType;
  layoutConfig?: LayoutCameraConfig;
}

// Map tile cache
const tileCache = new Map<string, HTMLImageElement>();

// Telemetry icon cache
interface TelemetryIcons {
  wheel: HTMLImageElement | null;
  leftPedal: HTMLImageElement | null;
  rightPedal: HTMLImageElement | null;
  blinker: HTMLImageElement | null;
}

// Load an image with promise
async function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Load all telemetry icons
async function loadTelemetryIcons(): Promise<TelemetryIcons> {
  const [wheel, leftPedal, rightPedal, blinker] = await Promise.all([
    loadImage('/wheel.svg'),
    loadImage('/left-pedal.png'),
    loadImage('/right-pedal.png'),
    loadImage('/blinker.svg'),
  ]);
  return { wheel, leftPedal, rightPedal, blinker };
}

// Convert lat/lng to tile coordinates
function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const x = Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
  const y = Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) *
      Math.pow(2, zoom)
  );
  return { x, y };
}

// Get pixel position within tile
function latLngToPixelOffset(lat: number, lng: number, zoom: number): { px: number; py: number } {
  const scale = Math.pow(2, zoom) * 256;
  const px = ((lng + 180) / 360) * scale;
  const py =
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * scale;
  return { px: px % 256, py: py % 256 };
}

// Load map tile with caching
async function loadMapTile(x: number, y: number, zoom: number): Promise<HTMLImageElement | null> {
  const key = `${zoom}/${x}/${y}`;
  if (tileCache.has(key)) {
    return tileCache.get(key)!;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      tileCache.set(key, img);
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
  });
}

export function VideoExporter({
  sequence,
  selectedAngle,
  allSeiMessages,
  fps,
  speedUnit,
  filename = 'tesla-cam-export',
  trimPoints,
  cameraSegments = [],
  showTelemetry = true,
  showDateTime = true,
  showMap = true,
  layout = 'single',
  layoutConfig = DEFAULT_LAYOUT_CONFIG,
}: VideoExporterProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const abortRef = useRef(false);

  // Cleanup
  useEffect(() => {
    return () => {
      if (exportUrl) URL.revokeObjectURL(exportUrl);
    };
  }, [exportUrl]);

  // Get SEI data for a specific time (same logic as useSeiData hook)
  const getSeiForTime = useCallback(
    (time: number): SeiData | null => {
      if (allSeiMessages.length === 0) return null;

      const frameIndex = Math.floor(time * fps);

      // Binary search for nearest SEI message
      let left = 0;
      let right = allSeiMessages.length - 1;

      while (left < right) {
        const mid = Math.floor((left + right + 1) / 2);
        if (allSeiMessages[mid].frameIndex <= frameIndex) {
          left = mid;
        } else {
          right = mid - 1;
        }
      }

      return allSeiMessages[left]?.sei || null;
    },
    [allSeiMessages, fps]
  );

  // Get camera angle for a specific time based on camera segments
  const getAngleForTime = useCallback(
    (time: number): string => {
      if (cameraSegments.length === 0) return selectedAngle;

      for (const segment of cameraSegments) {
        if (time >= segment.startTime && time < segment.endTime) {
          return segment.angle;
        }
      }

      // Fallback to last segment's angle or selected angle
      return cameraSegments[cameraSegments.length - 1]?.angle || selectedAngle;
    },
    [cameraSegments, selectedAngle]
  );

  // Apply CSS-like filter to canvas context
  const applyFilter = (ctx: CanvasRenderingContext2D, filter: string) => {
    // Parse simple brightness and invert filters
    const brightnessMatch = filter.match(/brightness\(([^)]+)\)/);
    const invertMatch = filter.match(/invert\(([^)]+)\)/);
    
    if (brightnessMatch || invertMatch) {
      ctx.filter = filter;
    }
  };

  // Draw telemetry overlay on canvas - matches TelemetryCard.tsx layout exactly
  const drawTelemetry = (
    ctx: CanvasRenderingContext2D,
    seiData: SeiData | null,
    width: number,
    height: number,
    icons: TelemetryIcons,
    frameTime: number, // for blinker animation
    isSingleOrPip: boolean = false // true for single/pip layouts (1.5x scale)
  ) => {
    if (!seiData) return;

    // Use width-based scale for consistent sizing across different layouts
    const baseScale = width / 1920;
    // Single/PiP layouts use 2x scale
    const scaleMultiplier = isSingleOrPip ? 2.0 : 1.25;
    const scale = baseScale * scaleMultiplier;
    
    // From TelemetryCard.tsx:
    // .telemetry-card: padding: 5px, gap: 10px, border-radius: 12px
    // .telemetry-column: gap: 8px
    // .telemetry-circle: width: 22px, height: 22px
    const cardPadding = 5 * scale;
    const columnGap = 10 * scale; // gap between columns
    const innerGap = 8 * scale; // gap between circles in a column
    const circleSize = 22 * scale; // 22px as in CSS
    const blinkerSize = 16 * scale; // Image width=16 height=16
    const speedWidth = 50 * scale; // min-width: 50px
    
    // Calculate total width
    // Layout: [Column] gap [Blinker] gap [Speed] gap [Blinker] gap [Column]
    const columnWidth = circleSize;
    const boxWidth = columnWidth + columnGap + blinkerSize + columnGap + speedWidth + columnGap + blinkerSize + columnGap + columnWidth + cardPadding * 2;
    const boxHeight = circleSize * 2 + innerGap + cardPadding * 2;

    // Position at TOP CENTER, below the date/time display
    const x = (width - boxWidth) / 2;
    // For single/pip: use same top margin as dateTime; for others: add offset for white border
    const dateTopMargin = isSingleOrPip ? 8 * baseScale + 4 : 4 * baseScale + 8;
    const dateBoxHeight = 24 * (isSingleOrPip ? scale : baseScale); // Use correct scale for height
    const dateToTelemetryGap = isSingleOrPip ?  baseScale : 10 * baseScale;
    const y = dateTopMargin + dateBoxHeight + dateToTelemetryGap;

    // Draw background - dark theme to match edit page
    // .telemetry-card: background: rgba(12, 12, 12, 0.65), border-radius: 12px
    ctx.fillStyle = 'rgba(12, 12, 12, 0.65)';
    ctx.beginPath();
    ctx.roundRect(x, y, boxWidth, boxHeight, 12 * scale);
    ctx.fill();

    // Calculate positions starting from left with padding
    let posX = x + cardPadding;
    // Center circles vertically in each column
    const columnCenterY = y + boxHeight / 2;
    const topCircleY = columnCenterY - innerGap / 2 - circleSize / 2;
    const bottomCircleY = columnCenterY + innerGap / 2 + circleSize / 2;
    const centerY = y + boxHeight / 2;
    // Icon size should fill most of the circle (16px for 22px circle)
    const iconSize = 16 * scale;

    // === Left Column: Gear + Brake ===
    // Gear circle - .telemetry-circle: background: #3f3f3fde
    ctx.fillStyle = '#3f3f3fde';
    ctx.beginPath();
    ctx.arc(posX + columnWidth / 2, topCircleY, circleSize / 2, 0, Math.PI * 2);
    ctx.fill();
    
    // Gear letter - .telemetry-gear: font-size: 16px, font-weight: 700, color: #c0c0c0ff
    const gearLetter = ['P', 'D', 'R', 'N'][seiData.gear_state ?? 0] || 'P';
    ctx.fillStyle = '#c0c0c0ff';
    ctx.font = `700 ${16 * scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Center in circle with slight downward offset for visual balance
    ctx.fillText(gearLetter, posX + columnWidth / 2, topCircleY + 1.5 * scale);

    // Brake circle - .telemetry-brake.active: background: #ff4444
    ctx.fillStyle = seiData.brake_applied ? '#ff4444' : '#3f3f3fde';
    ctx.beginPath();
    ctx.arc(posX + columnWidth / 2, bottomCircleY, circleSize / 2, 0, Math.PI * 2);
    ctx.fill();
    
    // Brake pedal icon - :global(.pedal-icon): filter: brightness(1.2)
    // Increased to 14px for better visibility
    if (icons.leftPedal) {
      ctx.save();
      // Apply brightness filter to match CSS
      applyFilter(ctx, 'brightness(1.2)');
      // Fixed height 14px, width auto to maintain aspect ratio
      const pedalH = 14 * scale;
      const pedalW = (icons.leftPedal.width / icons.leftPedal.height) * pedalH;
      ctx.drawImage(
        icons.leftPedal,
        posX + columnWidth / 2 - pedalW / 2,
        bottomCircleY - pedalH / 2,
        pedalW,
        pedalH
      );
      ctx.filter = 'none';
      ctx.restore();
    }

    posX += columnWidth + columnGap;

    // === Left Blinker ===
    // .telemetry-blinker: opacity: 0.2, .telemetry-blinker.active: opacity: 1, animation: blink 1s steps(1) infinite
    // Blink animation: 0.5s cycle (2Hz) for faster blinking
    const blinkPhase = Math.floor(frameTime * 2) % 2; // Toggle every 0.5 seconds
    const leftBlinkerOn = seiData.blinker_on_left && blinkPhase === 0;
    if (icons.blinker) {
      ctx.save();
      ctx.globalAlpha = leftBlinkerOn ? 1 : 0.2;
      // Match TelemetryCard.tsx: Image width={16} height={16}
      ctx.drawImage(
        icons.blinker,
        posX + (blinkerSize - 16 * scale) / 2, // Center horizontally
        centerY - 8 * scale, // 16px height, center vertically
        16 * scale,
        16 * scale
      );
      ctx.restore();
    } else {
      ctx.fillStyle = leftBlinkerOn ? '#22c55e' : 'rgba(100, 100, 100, 0.2)';
      ctx.beginPath();
      ctx.moveTo(posX, centerY);
      ctx.lineTo(posX + blinkerSize, centerY - 8 * scale);
      ctx.lineTo(posX + blinkerSize, centerY + 8 * scale);
      ctx.closePath();
      ctx.fill();
    }

    posX += blinkerSize + columnGap;

    // === Speed Display ===
    // .telemetry-speed: min-width: 50px, flex-direction: column, align-items: center
    const speed = seiData.vehicle_speed_mps
      ? speedUnit === 'mph'
        ? Math.round(seiData.vehicle_speed_mps * 2.23694)
        : Math.round(seiData.vehicle_speed_mps * 3.6)
      : 0;

    // Calculate total height of speed display for vertical centering
    // .speed-value: font-size: 32px, line-height: 1
    // .speed-unit: font-size: 10px
    const speedValueHeight = 32 * scale; // line-height: 1
    const speedUnitHeight = 10 * scale;
    const totalSpeedHeight = speedValueHeight + speedUnitHeight;
    const speedTop = centerY - totalSpeedHeight / 2;

    // .speed-value: font-size: 32px, font-weight: 500, color: #c0c0c0, line-height: 1
    ctx.fillStyle = '#c0c0c0';
    ctx.font = `500 ${32 * scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top'; // Use top baseline for precise positioning
    ctx.fillText(String(speed), posX + speedWidth / 2, speedTop);

    // .speed-unit: font-size: 10px, font-weight: 600, color: #9ca3af
    ctx.fillStyle = '#9ca3af';
    ctx.font = `600 ${10 * scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillText(speedUnit === 'mph' ? 'MPH' : 'km/h', posX + speedWidth / 2, speedTop + speedValueHeight);

    posX += speedWidth + columnGap;

    // === Right Blinker (rotated 180°) ===
    // Same blink animation as left
    const rightBlinkerOn = seiData.blinker_on_right && blinkPhase === 0;
    if (icons.blinker) {
      ctx.save();
      ctx.globalAlpha = rightBlinkerOn ? 1 : 0.2;
      ctx.translate(posX + 8 * scale, centerY);
      ctx.rotate(Math.PI);
      // Match TelemetryCard.tsx: Image width={16} height={16}
      ctx.drawImage(
        icons.blinker,
        -8 * scale,
        -8 * scale,
        16 * scale,
        16 * scale
      );
      ctx.restore();
    } else {
      ctx.fillStyle = rightBlinkerOn ? '#22c55e' : 'rgba(100, 100, 100, 0.2)';
      ctx.beginPath();
      ctx.moveTo(posX + blinkerSize, centerY);
      ctx.lineTo(posX, centerY - 8 * scale);
      ctx.lineTo(posX, centerY + 8 * scale);
      ctx.closePath();
      ctx.fill();
    }

    posX += blinkerSize + columnGap;

    // === Right Column: Steering + Accelerator ===
    // Steering circle - .telemetry-steering.autopilot: background: #006deb
    const isAutopilotActive = (seiData.autopilot_state ?? 0) > 0;
    ctx.fillStyle = isAutopilotActive ? '#006deb' : '#3f3f3fde';
    ctx.beginPath();
    ctx.arc(posX + columnWidth / 2, topCircleY, circleSize / 2, 0, Math.PI * 2);
    ctx.fill();

    // Steering wheel icon
    // .telemetry-steering :global(.wheel-icon): filter: brightness(0.5) invert(0.7)
    const steeringAngle = seiData.steering_wheel_angle || 0;
    if (icons.wheel) {
      ctx.save();
      ctx.translate(posX + columnWidth / 2, topCircleY);
      ctx.rotate((steeringAngle * Math.PI) / 180);
      // Apply CSS filter: brightness(0.5) invert(0.7)
      applyFilter(ctx, 'brightness(0.5) invert(0.7)');
      // Draw wheel icon to fill most of the circle
      ctx.drawImage(icons.wheel, -iconSize / 2, -iconSize / 2, iconSize, iconSize);
      ctx.filter = 'none';
      ctx.restore();
    } else {
      // Fallback: draw simple steering wheel
      ctx.save();
      ctx.translate(posX + columnWidth / 2, topCircleY);
      ctx.rotate((steeringAngle * Math.PI) / 180);
      ctx.strokeStyle = '#aaa';
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.arc(0, 0, circleSize / 2 - 4 * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -circleSize / 2 + 4 * scale);
      ctx.lineTo(0, circleSize / 2 - 4 * scale);
      ctx.stroke();
      ctx.restore();
    }

    // Accelerator circle
    const rawAccel = seiData.accelerator_pedal_position || 0;
    const accelPercent = Math.min(100, rawAccel > 1 ? rawAccel : rawAccel * 100);

    ctx.fillStyle = '#3f3f3fde';
    ctx.beginPath();
    ctx.arc(posX + columnWidth / 2, bottomCircleY, circleSize / 2, 0, Math.PI * 2);
    ctx.fill();

    // Accelerator fill - .accelerator-fill: linear-gradient(to top, #4caf50, #8bc34a)
    if (accelPercent > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(posX + columnWidth / 2, bottomCircleY, circleSize / 2, 0, Math.PI * 2);
      ctx.clip();
      const fillHeight = (accelPercent / 100) * circleSize;
      const gradient = ctx.createLinearGradient(0, bottomCircleY + circleSize / 2, 0, bottomCircleY - circleSize / 2);
      gradient.addColorStop(0, '#4caf50');
      gradient.addColorStop(1, '#8bc34a');
      ctx.fillStyle = gradient;
      ctx.fillRect(posX + columnWidth / 2 - circleSize / 2, bottomCircleY + circleSize / 2 - fillHeight, circleSize, fillHeight);
      ctx.restore();
    }

    // Accelerator pedal icon - :global(.pedal-icon): filter: brightness(1.2)
    // Increased to 14px for better visibility
    if (icons.rightPedal) {
      ctx.save();
      // Apply brightness filter to match CSS
      applyFilter(ctx, 'brightness(1.2)');
      // Fixed height 14px, width auto to maintain aspect ratio
      const pedalH = 14 * scale;
      const pedalW = (icons.rightPedal.width / icons.rightPedal.height) * pedalH;
      ctx.drawImage(
        icons.rightPedal,
        posX + columnWidth / 2 - pedalW / 2,
        bottomCircleY - pedalH / 2,
        pedalW,
        pedalH
      );
      ctx.filter = 'none';
      ctx.restore();
    }

    // === Autopilot label ===
    // .telemetry-autopilot: background: rgba(59, 130, 246, 0.9), border-radius: 0 0 8px 8px
    if (isAutopilotActive) {
      const autopilotLabels: Record<number, string> = { 1: 'Self Driving', 2: 'Autosteer', 3: 'TACC' };
      const label = autopilotLabels[seiData.autopilot_state ?? 0] || '';
      if (label) {
        ctx.font = `600 ${11 * scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
        const labelWidth = ctx.measureText(label).width + 24 * scale;
        const labelX = (width - labelWidth) / 2;
        const labelY = y + boxHeight - 1;

        // .telemetry-autopilot: background: rgba(59, 130, 246, 0.9)
        ctx.fillStyle = 'rgba(59, 130, 246, 0.9)';
        ctx.beginPath();
        ctx.roundRect(labelX, labelY, labelWidth, 20 * scale, [0, 0, 8 * scale, 8 * scale]);
        ctx.fill();

        // Label text - color matches .telemetry-autopilot color
        ctx.fillStyle = '#c0c0c0';
        ctx.textAlign = 'center';
        ctx.fillText(label, width / 2, labelY + 11 * scale);
      }
    }
  };

  // Draw date/time overlay - matches VideoPlayer.tsx: absolute top-1, px-2 py-1
  const drawDateTime = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    date: string,
    time: string,
    frameTime: number, // for potential animation
    isSingleOrPip: boolean = false // true for single/pip layouts (1.5x scale)
  ) => {
    // Use width-based scale for consistent sizing across different layouts
    const baseScale = width / 1920;
    // Single/PiP layouts use 2x scale
    const scaleMultiplier = isSingleOrPip ? 2.0 : 1.25;
    const scale = baseScale * scaleMultiplier;
    
    // Match VideoPlayer.tsx: top-1 = 4px, px-2 = 8px, py-1 = 4px
    // Single/pip layouts need smaller top margin since they use 2x scale
    const topMargin = isSingleOrPip ? 8 * baseScale : 4 * scale + 8 * baseScale;
    const paddingX = 8 * scale; // px-2
    const paddingY = 4 * scale; // py-1

    // Format the date/time string
    const dateTimeStr = `${date}  ${time}`;

    // Match VideoPlayer.tsx: text-xs font-medium = 12px, font-weight 500
    ctx.font = `500 ${12 * scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
    const textWidth = ctx.measureText(dateTimeStr).width;
    const boxWidth = textWidth + paddingX * 2;
    const boxHeight = 24 * scale; // Smaller height to match py-1

    // Position at top center
    const x = (width - boxWidth) / 2;
    const y = topMargin;

    // Draw background - bg-black/50 backdrop-blur-sm
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.roundRect(x, y, boxWidth, boxHeight, 6 * scale);
    ctx.fill();

    // Draw text - text-white/90
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(dateTimeStr, width / 2, y + boxHeight / 2);
  };

  // Draw mini map with actual map tiles
  const drawMiniMap = (
    ctx: CanvasRenderingContext2D,
    seiData: SeiData | null,
    width: number,
    height: number,
    position: 'top-right' | 'bottom-right' | { x: number; y: number; size: number } = 'bottom-right'
  ) => {
    if (!seiData?.latitude_deg || !seiData?.longitude_deg) return;
    if (seiData.latitude_deg === 0 && seiData.longitude_deg === 0) return;

    const scale = Math.min(width / 1280, height / 720);
    const mapSize = typeof position === 'object' ? position.size : 160 * scale;
    const padding = 12 * scale;
    const x = typeof position === 'object' ? position.x : width - mapSize - padding;
    const y = typeof position === 'object' ? position.y : position === 'top-right' ? padding : height - mapSize - padding;

    const lat = seiData.latitude_deg;
    const lng = seiData.longitude_deg;
    const zoom = 17;

    // Get tile coordinates
    const tile = latLngToTile(lat, lng, zoom);
    const offset = latLngToPixelOffset(lat, lng, zoom);

    // Draw map background
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.roundRect(x, y, mapSize, mapSize, 8 * scale);
    ctx.fill();

    // Clip to rounded rectangle
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, mapSize, mapSize, 8 * scale);
    ctx.clip();

    // Draw tiles from cache (3x3 grid around center) - synchronous, skip if not cached
    const tileSize = 256;
    const centerX = x + mapSize / 2;
    const centerY = y + mapSize / 2;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${zoom}/${tile.x + dx}/${tile.y + dy}`;
        const tileImg = tileCache.get(key);
        if (tileImg) {
          const tileX = centerX - offset.px + dx * tileSize;
          const tileY = centerY - offset.py + dy * tileSize;
          ctx.drawImage(tileImg, tileX, tileY, tileSize, tileSize);
        }
      }
    }

    ctx.restore();

    // Draw car marker in center
    const heading = seiData.heading_deg || 0;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate((heading * Math.PI) / 180);

    ctx.fillStyle = '#3B82F6';
    ctx.strokeStyle = '#1E40AF';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(0, -14 * scale);
    ctx.lineTo(-10 * scale, 10 * scale);
    ctx.lineTo(0, 5 * scale);
    ctx.lineTo(10 * scale, 10 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();

    // Coordinates overlay at bottom
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    const coordBoxY = y + mapSize - 20 * scale;
    ctx.beginPath();
    ctx.roundRect(x, coordBoxY, mapSize, 20 * scale, [0, 0, 8 * scale, 8 * scale]);
    ctx.fill();

    const coordStr = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    ctx.fillStyle = '#94a3b8';
    ctx.font = `${10 * scale}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(coordStr, x + mapSize / 2, coordBoxY + 10 * scale);
  };

  const startExport = useCallback(async () => {
    if (!sequence || sequence.moments.length === 0) {
      alert('No video sequence to export');
      return;
    }

    if (typeof VideoEncoder === 'undefined') {
      alert('Your browser does not support video encoding. Please use Chrome or Edge.');
      return;
    }

    setIsExporting(true);
    setProgress(0);
    setExportUrl(null);
    abortRef.current = false;

    // Create temporary video elements for loading clips
    const tempVideo = document.createElement('video');
    tempVideo.muted = true;
    tempVideo.playsInline = true;
    tempVideo.crossOrigin = 'anonymous';
    let currentBlobUrl: string | null = null;

    // Extra video elements for multi-angle layouts (pip/triple)
    const extraVideos: Record<string, { el: HTMLVideoElement; blobUrl: string | null; loadedClipIdx: number }> = {};

    const createExtraVideo = (angle: string) => {
      const el = document.createElement('video');
      el.muted = true;
      el.playsInline = true;
      el.crossOrigin = 'anonymous';
      extraVideos[angle] = { el, blobUrl: null, loadedClipIdx: -1 };
      return extraVideos[angle];
    };

    // Helper to load a video file into a specific video element
    // Handles both standard File objects and Tauri file URLs
    const loadVideoInto = (videoEl: HTMLVideoElement, file: File, tauriUrl: string | undefined, prevUrl: string | null): Promise<string> => {
      return new Promise((resolve, reject) => {
        // Only revoke URL if it was created by createObjectURL (not Tauri asset URL)
        if (prevUrl && !prevUrl.startsWith('asset://') && !prevUrl.startsWith('http')) {
          try {
            URL.revokeObjectURL(prevUrl);
          } catch {
            // Ignore errors from revoking non-object URLs
          }
        }
        
        // Use Tauri URL if available, otherwise create object URL from File
        const url = tauriUrl || URL.createObjectURL(file);
        
        const onError = () => {
          console.error(`Failed to load video: ${file.name}, url: ${url?.substring(0, 100)}`);
          reject(new Error(`Failed to load ${file.name}`));
        };
        
        videoEl.onerror = onError;
        videoEl.onloadedmetadata = () => {
          videoEl.onerror = null;
          resolve(url);
        };
        videoEl.src = url;
      });
    };

    // Helper to load a video file (main video)
    const loadVideo = async (file: File, tauriUrl?: string): Promise<void> => {
      currentBlobUrl = await loadVideoInto(tempVideo, file, tauriUrl, currentBlobUrl);
    };

    // Helper to seek a video element
    const seekVideoEl = (videoEl: HTMLVideoElement, time: number): Promise<void> => {
      return new Promise((resolve) => {
        const onSeeked = () => {
          videoEl.removeEventListener('seeked', onSeeked);
          resolve();
        };
        videoEl.addEventListener('seeked', onSeeked);
        videoEl.currentTime = time;
      });
    };

    // Helper to seek main video
    const seekVideo = (time: number) => seekVideoEl(tempVideo, time);

    try {
      // Get first clip to determine dimensions
      const firstMoment = sequence.moments[0];
      const firstVideo = firstMoment.videos.find(v => v.angle === selectedAngle) || firstMoment.videos[0];
      await loadVideo(firstVideo.file, firstVideo.url);

      const srcWidth = tempVideo.videoWidth || 1280;
      const srcHeight = tempVideo.videoHeight || 720;

      const maxDimension = 1920;

      // Determine export layout angles from config
      const tripleAngles = [...layoutConfig.triple.cameras];
      const pipAngles = layoutConfig.pip.corners.filter(
        a => a !== selectedAngle && a !== 'none' && a !== 'map'
      );

      let width: number;
      let height: number;

      if (layout === 'triple') {
        // Load a side video to get its dimensions
        const pillarVideo = sequence.moments[0].videos.find(v => v.angle === tripleAngles[0]);
        let pillarW = srcWidth;
        let pillarH = srcHeight;
        if (pillarVideo) {
          const pv = document.createElement('video');
          pv.muted = true;
          pv.crossOrigin = 'anonymous';
          // Use Tauri URL if available, otherwise create object URL
          const pvUrl = pillarVideo.url || URL.createObjectURL(pillarVideo.file);
          await new Promise<void>((resolve) => {
            pv.onloadedmetadata = () => { pillarW = pv.videoWidth; pillarH = pv.videoHeight; resolve(); };
            pv.onerror = () => resolve();
            pv.src = pvUrl;
          });
          // Only revoke if it was an object URL
          if (!pillarVideo.url) {
            URL.revokeObjectURL(pvUrl);
          }
        }
        // 3 videos side by side with uniform spacing
        // spacing = 8px for both outer padding and between cells
        const spacing = 8;
        const cellW = pillarW;
        const cellH = pillarH;
        // Total size includes video content + spacing
        width = cellW * 3 + spacing * 4; // left + 2 gaps + right
        height = cellH + spacing * 2; // top + bottom
        // Scale down if too large
        if (width > maxDimension) {
          const s = maxDimension / width;
          width = Math.floor(width * s);
          height = Math.floor(height * s);
        }
        width = width - (width % 2);
        height = height - (height % 2);
      } else if (layout === 'all') {
        // Six views: 3 columns x 2 rows with uniform spacing
        const spacing = 8;
        const cellW = srcWidth;
        const cellH = srcHeight;
        // Total size includes video content + spacing
        width = cellW * 3 + spacing * 4; // left + 2 gaps + right
        height = cellH * 2 + spacing * 3; // top + 1 middle + bottom
        // Scale down if too large
        const maxDim = Math.max(width, height);
        if (maxDim > maxDimension) {
          const s = maxDimension / maxDim;
          width = Math.floor(width * s);
          height = Math.floor(height * s);
        }
        width = width - (width % 2);
        height = height - (height % 2);
      } else {
        width = srcWidth;
        height = srcHeight;
        if (width > maxDimension || height > maxDimension) {
          const videoScale = maxDimension / Math.max(width, height);
          width = Math.floor(width * videoScale);
          height = Math.floor(height * videoScale);
        }
        width = width - (width % 2);
        height = height - (height % 2);
      }

      const exportFps = 30;

      // Calculate export range from trim points
      const exportStart = trimPoints?.inPoint ?? 0;
      const exportEnd = trimPoints?.outPoint ?? sequence.totalDuration;
      const exportDuration = exportEnd - exportStart;
      const totalFrames = Math.floor(exportDuration * exportFps);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;

      setStatus('Loading telemetry icons...');
      const telemetryIcons = await loadTelemetryIcons();

      setStatus('Pre-loading map tiles...');

      // Pre-load map tiles for all unique positions within export range
      const uniqueTiles = new Set<string>();
      for (const msg of allSeiMessages) {
        const msgTime = msg.frameIndex / fps;
        if (msgTime >= exportStart && msgTime <= exportEnd) {
          if (msg.sei.latitude_deg && msg.sei.longitude_deg) {
            const tile = latLngToTile(msg.sei.latitude_deg, msg.sei.longitude_deg, 17);
            for (let dx = -1; dx <= 1; dx++) {
              for (let dy = -1; dy <= 1; dy++) {
                uniqueTiles.add(`17/${tile.x + dx}/${tile.y + dy}`);
              }
            }
          }
        }
      }

      // Load tiles in batches
      const tileArray = Array.from(uniqueTiles);
      for (let i = 0; i < tileArray.length; i++) {
        const [z, x, y] = tileArray[i].split('/').map(Number);
        await loadMapTile(x, y, z);
        if (i % 10 === 0) {
          setStatus(`Pre-loading map tiles... ${Math.round((i / tileArray.length) * 100)}%`);
        }
      }

      setStatus('Initializing encoder...');

      const output = new Output({
        format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
        target: new BufferTarget(),
      });

      const videoSource = new VideoSampleSource({
        codec: 'avc',
        bitrate: 8_000_000,
        latencyMode: 'quality',
        onEncoderConfig: (config) => {
          console.log('Encoder config:', config);
        },
        onEncodedPacket: () => {
          // Packet encoded successfully
        },
      });

      output.addVideoTrack(videoSource);
      await output.start();

      // Helper to find clip and local time for an absolute time
      const findClipForTime = (absTime: number): { clipIdx: number; localTime: number } | null => {
        for (let i = 0; i < sequence.moments.length; i++) {
          const clipStart = sequence.momentOffsets[i];
          const clipEnd = clipStart + sequence.moments[i].duration;
          if (absTime >= clipStart && absTime < clipEnd) {
            return { clipIdx: i, localTime: absTime - clipStart };
          }
        }
        // Handle edge case at the very end
        const lastIdx = sequence.moments.length - 1;
        const lastStart = sequence.momentOffsets[lastIdx];
        const lastEnd = lastStart + sequence.moments[lastIdx].duration;
        if (Math.abs(absTime - lastEnd) < 0.1) {
          return { clipIdx: lastIdx, localTime: sequence.moments[lastIdx].duration - 0.01 };
        }
        return null;
      };

      // Prepare extra video elements for multi-angle layouts
      const sixViewAngles = ['front', 'back', 'left_repeater', 'right_repeater', 'left_pillar', 'right_pillar'];
      const layoutAngles = layout === 'triple' ? tripleAngles
        : layout === 'pip' ? pipAngles
        : layout === 'all' ? sixViewAngles
        : [];

      for (const angle of layoutAngles) {
        createExtraVideo(angle);
      }

      // Process frames within export range, respecting camera segments
      let frameCount = 0;
      let currentLoadedClipIdx = -1;
      let currentLoadedAngle = '';

      for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
        if (abortRef.current) break;

        const absoluteTime = exportStart + (frameIdx / exportFps);

        // Get the camera angle for this time
        const frameAngle = getAngleForTime(absoluteTime);

        // Find which clip contains this time
        const clipInfo = findClipForTime(absoluteTime);
        if (!clipInfo) continue;

        const { clipIdx, localTime } = clipInfo;
        const moment = sequence.moments[clipIdx];

        setStatus(`Processing: ${formatDuration(absoluteTime - exportStart)} / ${formatDuration(exportDuration)}`);

        if (layout === 'triple') {
          // Load and seek all 3 angles
          for (let i = 0; i < tripleAngles.length; i++) {
            const angle = tripleAngles[i];
            const ev = extraVideos[angle];
            const video = moment.videos.find(v => v.angle === angle) || moment.videos[0];

            if (ev.loadedClipIdx !== clipIdx) {
              ev.blobUrl = await loadVideoInto(ev.el, video.file, video.url, ev.blobUrl);
              ev.loadedClipIdx = clipIdx;
            }
            await seekVideoEl(ev.el, localTime);
          }
          await new Promise((r) => setTimeout(r, 10));

          // Draw 3 videos side by side with gaps
          ctx.fillStyle = '#ffffff'; // White background
          ctx.fillRect(0, 0, width, height);
          
          // Uniform spacing: gap between cells equals outer padding
          const spacing = 8; // Unified spacing value for both gap and padding
          // Calculate cell width precisely, accounting for rounding
          // Total spacing: left + 2 gaps + right = 4 * spacing
          const totalSpacingX = spacing * 4;
          const cellW = Math.floor((width - totalSpacingX) / 3);
          // Distribute any remainder pixels to center the content
          const remainderX = width - totalSpacingX - cellW * 3;
          const leftOffset = spacing + Math.floor(remainderX / 2);
          // Calculate cell height to fill the available height exactly
          const cellH = height - spacing * 2;
          // Use width-based scale for consistent UI sizing across layouts
          const baseUIScale = width / 1920;
          const uiScale = baseUIScale * 1.25;
          
          for (let i = 0; i < tripleAngles.length; i++) {
            const angle = tripleAngles[i];
            const ev = extraVideos[angle];
            const isMain = angle === frameAngle;
            
            // Calculate position: leftOffset + i * (cell + spacing)
            const px = leftOffset + i * (cellW + spacing);
            const py = spacing; // Fixed top spacing
            const pw = cellW;
            const ph = cellH;
            
            // Scale video to fill the cell completely (aspect ratio already matches)
            const dx = px;
            const dy = py;
            const dw = pw;
            const dh = ph;
            
            // Create clipping region with rounded corners for the cell
            const cornerRadius = 8 * uiScale;
            
            // Draw video with rounded clipping
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(px, py, pw, ph, cornerRadius);
            ctx.clip();
            ctx.drawImage(ev.el, dx, dy, dw, dh);
            ctx.restore();
            
            // Draw green highlight border for main angle (selected by camera track)
            // Match VideoPlayer.tsx: ring-2 ring-green-500 shadow-[0_0_15px_rgba(34,197,94,0.3)]
            if (isMain) {
              const borderWidth = Math.max(2, Math.floor(3 * uiScale));
              
              // Draw rounded border with glow
              ctx.save();
              ctx.strokeStyle = '#22c55e'; // green-500
              ctx.lineWidth = borderWidth;
              ctx.shadowColor = 'rgba(34, 197, 94, 0.3)'; // shadow from Tailwind
              ctx.shadowBlur = 15 * uiScale;
              ctx.beginPath();
              ctx.roundRect(px + borderWidth / 2, py + borderWidth / 2, pw - borderWidth, ph - borderWidth, cornerRadius);
              ctx.stroke();
              ctx.restore();
              
              // Draw pulsing indicator dot in top-right corner
              // Use baseUIScale for smaller size in triple view
              const dotRadius = 6 * uiScale;
              const dotMargin = 10 * uiScale;
              const dotX = px + pw - dotRadius - dotMargin;
              const dotY = py + dotRadius + dotMargin;
              
              // Pulsing animation - slower frequency (1s cycle, was 0.5s)
              const pulsePhase = (Math.sin((absoluteTime * Math.PI) / 1) + 1) / 2;
              const minOpacity = 0.3;
              const dotOpacity = minOpacity + (1 - minOpacity) * pulsePhase;
              
              // Outer glow that pulses
              ctx.save();
              ctx.shadowColor = '#22c55e';
              ctx.shadowBlur = (8 + 12 * pulsePhase) * uiScale;
              ctx.globalAlpha = dotOpacity;
              ctx.fillStyle = '#22c55e';
              ctx.beginPath();
              ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
            
            // Draw angle label at bottom left of each cell
            // Use baseUIScale (no 1.25x multiplier) for labels
            const label = ANGLE_LABELS[angle] || angle;
            const labelFontSize = Math.max(16, Math.floor(16 * baseUIScale));
            ctx.font = `500 ${labelFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
            
            // Even padding all around: 10px (scaled, no 1.25x)
            const labelPadding = 10 * baseUIScale;
            const labelWidth = ctx.measureText(label).width + labelPadding * 2;
            const labelHeight = labelFontSize + labelPadding * 2;
            
            // Position: margin from border (scaled, no 1.25x)
            const labelMargin = 10 * baseUIScale;
            const labelX = px + labelMargin;
            const labelY = py + ph - labelHeight - labelMargin;
            
            // Label style for main angle: bg-green-600/70 border border-green-400/50
            const labelCornerRadius = 6 * baseUIScale;
            if (isMain) {
              // Background: bg-green-600/70
              ctx.fillStyle = 'rgba(22, 163, 74, 0.7)';
              ctx.beginPath();
              ctx.roundRect(labelX, labelY, labelWidth, labelHeight, labelCornerRadius);
              ctx.fill();
              
              // Border: border-green-400/50
              ctx.strokeStyle = 'rgba(74, 222, 128, 0.5)';
              ctx.lineWidth = Math.max(1, 1.5 * baseUIScale);
              ctx.beginPath();
              ctx.roundRect(labelX, labelY, labelWidth, labelHeight, labelCornerRadius);
              ctx.stroke();
              
              // Text: text-white/90
              ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            } else {
              // Non-main: bg-black/50
              ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
              ctx.beginPath();
              ctx.roundRect(labelX, labelY, labelWidth, labelHeight, labelCornerRadius);
              ctx.fill();
              
              ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            }
            
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            // Slight downward offset for visual balance
            const visualOffset = 1.5 * baseUIScale;
            ctx.fillText(label, labelX + labelWidth / 2, labelY + labelHeight / 2 + visualOffset);
          }

        } else if (layout === 'pip') {
          // Load and seek main video
          const needReload = currentLoadedClipIdx !== clipIdx || currentLoadedAngle !== frameAngle;
          if (needReload) {
            const video = moment.videos.find(v => v.angle === frameAngle) || moment.videos[0];
            await loadVideo(video.file, video.url);
            currentLoadedClipIdx = clipIdx;
            currentLoadedAngle = video.angle;
          }
          await seekVideo(localTime);

          // Load and seek PiP camera angles
          for (const angle of pipAngles) {
            const ev = extraVideos[angle];
            if (!ev) continue;
            const video = moment.videos.find(v => v.angle === angle);
            if (!video) continue;
            if (ev.loadedClipIdx !== clipIdx) {
              ev.blobUrl = await loadVideoInto(ev.el, video.file, video.url, ev.blobUrl);
              ev.loadedClipIdx = clipIdx;
            }
            await seekVideoEl(ev.el, localTime);
          }
          await new Promise((r) => setTimeout(r, 10));

          // Draw main video
          ctx.drawImage(tempVideo, 0, 0, width, height);

          // Draw PiP corners matching the 5-position layout config
          // corners: [bottom-left, bottom-center, bottom-right, top-left, top-right]
          const allCorners = layoutConfig.pip.corners;
          const pipW = Math.floor(width * 0.18);
          const pipMargin = Math.floor(width * 0.02);

          // Track animation state for PiP corner flash
          const pipFlashProgress = cameraSegments.length > 0 ? 
            Math.min(1, Math.max(0, 1 - (absoluteTime % 1) * 2)) : 0; // 0.5s flash
          
          const drawPipAt = (angle: string, px: number, py: number, cornerIdx: number) => {
            const ev = extraVideos[angle];
            if (!ev || !moment.videos.some(v => v.angle === angle)) return;
            const srcW = ev.el.videoWidth || 1;
            const srcH = ev.el.videoHeight || 1;
            const pipH = Math.floor(pipW * (srcH / srcW));
            const cornerRadius = 8 * (width / 1920);
            
            // Draw green flash shadow if this angle was just swapped in
            const isRecentlySwapped = pipFlashProgress > 0 && frameAngle === angle;
            if (isRecentlySwapped) {
              ctx.save();
              ctx.shadowColor = '#22c55e';
              ctx.shadowBlur = (20 * pipFlashProgress) * (width / 1920);
              ctx.beginPath();
              ctx.roundRect(px, py, pipW, pipH, cornerRadius);
              ctx.stroke();
              ctx.restore();
            }
            
            // Draw video with rounded corners
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(px, py, pipW, pipH, cornerRadius);
            ctx.clip();
            ctx.drawImage(ev.el, px, py, pipW, pipH);
            ctx.restore();
            
            // Draw border
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = Math.max(1, 2 * (width / 1920));
            ctx.beginPath();
            ctx.roundRect(px, py, pipW, pipH, cornerRadius);
            ctx.stroke();
            
            // Draw angle label at bottom-left of PiP
            const label = ANGLE_LABELS[angle] || angle;
            const labelScale = width / 1920;
            const labelFontSize = Math.max(10, Math.floor(12 * labelScale));
            ctx.font = `500 ${labelFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
            const labelPaddingX = 8 * labelScale;
            const labelPaddingY = 4 * labelScale;
            const labelWidth = ctx.measureText(label).width + labelPaddingX * 2;
            const labelHeight = labelFontSize + labelPaddingY * 2;
            const labelX = px + 6 * labelScale;
            const labelY = py + pipH - labelHeight - 6 * labelScale;
            
            // Label background
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.beginPath();
            ctx.roundRect(labelX, labelY, labelWidth, labelHeight, 4 * labelScale);
            ctx.fill();
            
            // Label text
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, labelX + labelWidth / 2, labelY + labelHeight / 2);
          };

          // Compute pip height for positioning (use first available pip video)
          let defaultPipH = Math.floor(pipW * 0.75); // fallback 4:3
          for (const angle of pipAngles) {
            const ev = extraVideos[angle];
            if (ev?.el.videoWidth) {
              defaultPipH = Math.floor(pipW * (ev.el.videoHeight / ev.el.videoWidth));
              break;
            }
          }

          // Bottom-left [0]
          if (allCorners[0] !== 'none' && allCorners[0] !== 'map' && allCorners[0] !== selectedAngle) {
            drawPipAt(allCorners[0], pipMargin, height - defaultPipH - pipMargin, 0);
          }
          // Bottom-center [1]
          if (allCorners[1] !== 'none' && allCorners[1] !== 'map' && allCorners[1] !== selectedAngle) {
            drawPipAt(allCorners[1], Math.floor((width - pipW) / 2), height - defaultPipH - pipMargin, 1);
          }
          // Bottom-right [2]
          if (allCorners[2] !== 'none' && allCorners[2] !== 'map' && allCorners[2] !== selectedAngle) {
            drawPipAt(allCorners[2], width - pipW - pipMargin, height - defaultPipH - pipMargin, 2);
          }
          // Top-left [3]
          if (allCorners[3] !== 'none' && allCorners[3] !== 'map' && allCorners[3] !== selectedAngle) {
            drawPipAt(allCorners[3], pipMargin, pipMargin, 3);
          }
          // Top-right [4]
          if (allCorners[4] !== 'none' && allCorners[4] !== 'map' && allCorners[4] !== selectedAngle) {
            drawPipAt(allCorners[4], width - pipW - pipMargin, pipMargin, 4);
          }

          // Draw map at corners configured as 'map'
          // corner positions: [bottom-left, bottom-center, bottom-right, top-left, top-right]
          const mapCornerPositions = [
            { x: pipMargin, y: height - pipW - pipMargin },                         // bottom-left
            { x: Math.floor((width - pipW) / 2), y: height - pipW - pipMargin },    // bottom-center
            { x: width - pipW - pipMargin, y: height - pipW - pipMargin },           // bottom-right
            { x: pipMargin, y: pipMargin },                                          // top-left
            { x: width - pipW - pipMargin, y: pipMargin },                           // top-right
          ];
          const rawPipSei = getSeiForTime(absoluteTime);
          const pipMapSeiData = rawPipSei?.latitude_deg && rawPipSei?.longitude_deg
            ? rawPipSei
            : sequence.event?.est_lat && sequence.event?.est_lon
              ? { ...(rawPipSei || {}), latitude_deg: sequence.event.est_lat, longitude_deg: sequence.event.est_lon } as typeof rawPipSei
              : rawPipSei;
          for (let ci = 0; ci < allCorners.length; ci++) {
            if (allCorners[ci] === 'map') {
              const mp = mapCornerPositions[ci];
              await drawMiniMap(ctx, pipMapSeiData, width, height, { x: mp.x, y: mp.y, size: pipW });
            }
          }
          
          // Draw main angle label below telemetry for PiP layout
          // Calculate fade animation based on segment boundary proximity
          let mainLabelOpacity = 1;
          if (cameraSegments.length > 0) {
            // Find current segment and calculate fade at boundaries
            const currentSeg = cameraSegments.find(seg => 
              absoluteTime >= seg.startTime && absoluteTime < seg.endTime
            );
            if (currentSeg) {
              const segDuration = currentSeg.endTime - currentSeg.startTime;
              const timeInSeg = absoluteTime - currentSeg.startTime;
              const fadeDuration = 0.3; // 0.3s fade at start
              if (timeInSeg < fadeDuration) {
                mainLabelOpacity = Math.min(1, timeInSeg / fadeDuration);
              }
            }
          }
          
          const mainLabel = ANGLE_LABELS[frameAngle] || frameAngle;
          const mainLabelScale = width / 1920 * 1.25;
          const mainLabelFontSize = Math.max(12, Math.floor(14 * mainLabelScale));
          ctx.font = `600 ${mainLabelFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
          const mainLabelPaddingX = 16 * mainLabelScale;
          const mainLabelPaddingY = 6 * mainLabelScale;
          const mainLabelWidth = ctx.measureText(mainLabel).width + mainLabelPaddingX * 2;
          const mainLabelHeight = mainLabelFontSize + mainLabelPaddingY * 2;
          
          // Position below telemetry panel (estimated position)
          const telemetryBottomY = 16 * mainLabelScale + 24 * mainLabelScale + 10 * mainLabelScale + 70 * mainLabelScale;
          const mainLabelX = (width - mainLabelWidth) / 2;
          const mainLabelY = telemetryBottomY + 8 * mainLabelScale;
          
          // Draw label with fade opacity
          ctx.globalAlpha = mainLabelOpacity;
          ctx.fillStyle = 'rgba(34, 197, 94, 0.5)'; // green-500/50
          ctx.beginPath();
          ctx.roundRect(mainLabelX, mainLabelY, mainLabelWidth, mainLabelHeight, 6 * mainLabelScale);
          ctx.fill();
          ctx.strokeStyle = 'rgba(34, 197, 94, 0.3)';
          ctx.lineWidth = Math.max(1, mainLabelScale);
          ctx.stroke();
          
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(mainLabel, width / 2, mainLabelY + mainLabelHeight / 2);
          ctx.globalAlpha = 1; // Reset opacity

        } else if (layout === 'all') {
          // Six views layout: 3 columns x 2 rows
          const { topRow, bottomRow } = layoutConfig.all;
          const rows = [topRow, bottomRow];
          // Uniform spacing: gap between cells equals outer padding
          const spacing = 8; // Unified spacing value for gap and padding
          // Calculate cell width precisely, accounting for rounding
          // Total spacing: left + 2 gaps + right = 4 * spacing
          const totalSpacingX = spacing * 4;
          const cellW = Math.floor((width - totalSpacingX) / 3);
          // Distribute any remainder pixels to center the content
          const remainderX = width - totalSpacingX - cellW * 3;
          const leftOffset = spacing + Math.floor(remainderX / 2);
          // Calculate cell height to fill the available height exactly
          const totalSpacingY = spacing * 3; // top + middle + bottom
          const cellH = Math.floor((height - totalSpacingY) / 2);
          // Use fixed topOffset to ensure exact spacing
          const topOffset = spacing;
          // Use width-based scale for consistent UI sizing across layouts
          const baseUIScale = width / 1920;
          const uiScale = baseUIScale * 1.25;

          // Load and seek all 6 angles
          for (const angle of sixViewAngles) {
            const ev = extraVideos[angle];
            if (!ev) continue;
            const video = moment.videos.find(v => v.angle === angle);
            if (!video) continue;
            if (ev.loadedClipIdx !== clipIdx) {
              ev.blobUrl = await loadVideoInto(ev.el, video.file, video.url, ev.blobUrl);
              ev.loadedClipIdx = clipIdx;
            }
            await seekVideoEl(ev.el, localTime);
          }
          await new Promise((r) => setTimeout(r, 10));

          // Draw background
          ctx.fillStyle = '#ffffff'; // White background
          ctx.fillRect(0, 0, width, height);

          // Draw 6 videos in 2x3 grid with gaps
          for (let rowIdx = 0; rowIdx < 2; rowIdx++) {
            const row = rows[rowIdx];
            for (let colIdx = 0; colIdx < 3; colIdx++) {
              const angle = row[colIdx];
              const ev = extraVideos[angle];
              const isMain = angle === frameAngle;
              
              if (!ev || !moment.videos.some(v => v.angle === angle)) {
                // Draw placeholder for unavailable angle
                const px = leftOffset + colIdx * (cellW + spacing);
                const py = topOffset + rowIdx * (cellH + spacing);
                const pw = cellW;
                const ph = cellH;
                ctx.fillStyle = '#1a1a1a';
                ctx.fillRect(px, py, pw, ph);
                
                // Draw angle label
                ctx.fillStyle = '#666';
                ctx.font = `600 ${14 * uiScale}px -apple-system, BlinkMacSystemFont, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const label = ANGLE_LABELS[angle] || angle;
                ctx.fillText(label, px + pw / 2, py + ph / 2);
                continue;
              }

              // Calculate position: leftOffset and topOffset for even margins
              const px = leftOffset + colIdx * (cellW + spacing);
              const py = topOffset + rowIdx * (cellH + spacing);
              const pw = cellW;
              const ph = cellH;
              
              // Scale video to fill the cell completely (aspect ratio already matches)
              const dx = px;
              const dy = py;
              const dw = pw;
              const dh = ph;
              
              // Create clipping region with rounded corners for the cell
              const cornerRadius = 8 * uiScale;
              
              // Draw video with rounded clipping
              ctx.save();
              ctx.beginPath();
              ctx.roundRect(px, py, pw, ph, cornerRadius);
              ctx.clip();
              ctx.drawImage(ev.el, dx, dy, dw, dh);
              ctx.restore();

              // Draw green highlight border for main angle (selected by camera track)
              // Match VideoPlayer.tsx: ring-2 ring-green-500 shadow-[0_0_15px_rgba(34,197,94,0.3)]
              if (isMain) {
                const borderWidth = Math.max(2, Math.floor(3 * uiScale));
                
                // Draw rounded border with glow
                ctx.save();
                ctx.strokeStyle = '#22c55e'; // green-500
                ctx.lineWidth = borderWidth;
                ctx.shadowColor = 'rgba(34, 197, 94, 0.3)'; // shadow from Tailwind
                ctx.shadowBlur = 15 * uiScale;
                ctx.beginPath();
                ctx.roundRect(px + borderWidth / 2, py + borderWidth / 2, pw - borderWidth, ph - borderWidth, cornerRadius);
                ctx.stroke();
                ctx.restore();
                
                // Draw pulsing indicator dot in top-right corner
                const dotRadius = 6 * uiScale;
                const dotMargin = 12 * uiScale;
                const dotX = px + pw - dotRadius - dotMargin; // right margin
                const dotY = py + dotRadius + dotMargin; // top margin
                
                // Pulsing animation - slower frequency (1s cycle)
                const pulsePhase = (Math.sin((absoluteTime * Math.PI) / 1) + 1) / 2; // 0 to 1, 1s cycle
                
                // Opacity varies from 0.3 to 1 for stronger contrast
                const minOpacity = 0.3;
                const dotOpacity = minOpacity + (1 - minOpacity) * pulsePhase;
                
                // Outer glow that pulses - enlarged to match bigger dot
                ctx.save();
                ctx.shadowColor = '#22c55e';
                ctx.shadowBlur = (8 + 12 * pulsePhase) * uiScale; // 2x glow effect
                ctx.globalAlpha = dotOpacity;
                ctx.fillStyle = '#22c55e'; // bg-green-500
                ctx.beginPath();
                ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
              }

              // Draw angle label at bottom left of each cell
              // Use baseUIScale (no 1.25x multiplier) for labels
              const label = ANGLE_LABELS[angle] || angle;
              const labelFontSize = Math.max(16, Math.floor(16 * baseUIScale));
              ctx.font = `500 ${labelFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
              
              // Even padding all around: 10px (scaled, no 1.25x)
              const labelPadding = 10 * baseUIScale;
              const labelWidth = ctx.measureText(label).width + labelPadding * 2;
              const labelHeight = labelFontSize + labelPadding * 2;
              
              // Position: margin from border (scaled, no 1.25x)
              const labelMargin = 10 * baseUIScale;
              const labelX = px + labelMargin;
              const labelY = py + ph - labelHeight - labelMargin;
              
              // Label style for main angle: bg-green-600/70 border border-green-400/50
              const labelCornerRadius = 6 * baseUIScale;
              if (isMain) {
                // Background: bg-green-600/70
                ctx.fillStyle = 'rgba(22, 163, 74, 0.7)';
                ctx.beginPath();
                ctx.roundRect(labelX, labelY, labelWidth, labelHeight, labelCornerRadius);
                ctx.fill();
                
                // Border: border-green-400/50
                ctx.strokeStyle = 'rgba(74, 222, 128, 0.5)';
                ctx.lineWidth = Math.max(1, 1.5 * baseUIScale);
                ctx.beginPath();
                ctx.roundRect(labelX, labelY, labelWidth, labelHeight, labelCornerRadius);
                ctx.stroke();
                
                // Text: text-white/90
                ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
              } else {
                // Non-main: bg-black/50
                ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                ctx.beginPath();
                ctx.roundRect(labelX, labelY, labelWidth, labelHeight, labelCornerRadius);
                ctx.fill();
                
                ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
              }
              
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              // Slight downward offset for visual balance
              const visualOffset = 1.5 * baseUIScale;
              ctx.fillText(label, labelX + labelWidth / 2, labelY + labelHeight / 2 + visualOffset);
            }
          }

        } else {
          // Single layout - export single angle
          const needReload = currentLoadedClipIdx !== clipIdx || currentLoadedAngle !== frameAngle;
          if (needReload) {
            const video = moment.videos.find(v => v.angle === frameAngle) || moment.videos[0];
            await loadVideo(video.file, video.url);
            currentLoadedClipIdx = clipIdx;
            currentLoadedAngle = video.angle;
          }
          await seekVideo(localTime);
          await new Promise((r) => setTimeout(r, 10));

          ctx.drawImage(tempVideo, 0, 0, width, height);
          
          // Draw bottom center angle label capsule for single layout
          // Match VideoPlayer.tsx: bottom-4 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur-md rounded-full
          const capsuleScale = width / 1920;
          const capsulePaddingX = 24 * capsuleScale;
          const capsulePaddingY = 6 * capsuleScale;
          const capsuleFontSize = Math.max(14, Math.floor(16 * capsuleScale));
          ctx.font = `500 ${capsuleFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
          const angleLabel = ANGLE_LABELS[selectedAngle] || selectedAngle;
          const labelWidth = ctx.measureText(angleLabel).width + capsulePaddingX * 2;
          const labelHeight = capsuleFontSize + capsulePaddingY * 2;
          const capsuleX = (width - labelWidth) / 2;
          const capsuleY = height - labelHeight - 16 * capsuleScale; // bottom-4 equivalent
          
          // Draw capsule background with border
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.beginPath();
          ctx.roundRect(capsuleX, capsuleY, labelWidth, labelHeight, labelHeight / 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.lineWidth = Math.max(1, capsuleScale);
          ctx.stroke();
          
          // Draw angle label text
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(angleLabel, width / 2, capsuleY + labelHeight / 2);
        }

        // Get SEI data for this absolute time, with event.json GPS fallback
        const rawSeiData = getSeiForTime(absoluteTime);
        const seiData = rawSeiData?.latitude_deg && rawSeiData?.longitude_deg
          ? rawSeiData
          : sequence.event?.est_lat && sequence.event?.est_lon
            ? { ...(rawSeiData || {}), latitude_deg: sequence.event.est_lat, longitude_deg: sequence.event.est_lon } as typeof rawSeiData
            : rawSeiData;

        // Draw overlays based on toggle states
        // Draw date/time FIRST (on top), then telemetry below it
        if (showDateTime) {
          const realTime = new Date(moment.timestamp.getTime() + localTime * 1000);
          // Use local time formatting to avoid UTC conversion
          const year = realTime.getFullYear();
          const month = String(realTime.getMonth() + 1).padStart(2, '0');
          const day = String(realTime.getDate()).padStart(2, '0');
          const hours = String(realTime.getHours()).padStart(2, '0');
          const minutes = String(realTime.getMinutes()).padStart(2, '0');
          const seconds = String(realTime.getSeconds()).padStart(2, '0');
          const dynamicDate = `${year}-${month}-${day}`;
          const dynamicTime = `${hours}:${minutes}:${seconds}`;
          const isSingleOrPip = layout === 'single' || layout === 'pip';
          drawDateTime(ctx, width, height, dynamicDate, dynamicTime, absoluteTime, isSingleOrPip);
        }
        if (showTelemetry) {
          const isSingleOrPip = layout === 'single' || layout === 'pip';
          drawTelemetry(ctx, seiData, width, height, telemetryIcons, absoluteTime, isSingleOrPip);
        }
        if (showMap && !(layout === 'pip' && layoutConfig.pip.corners.includes('map'))) {
          drawMiniMap(ctx, seiData, width, height, layout === 'pip' ? 'top-right' : 'bottom-right');
        }

        // Frame timestamp is relative to export start (0-based for exported video)
        const exportedTime = absoluteTime - exportStart;
        const frame = new VideoFrame(canvas, {
          timestamp: exportedTime * 1_000_000,
          duration: (1 / exportFps) * 1_000_000,
        });

        const sample = new VideoSample(frame);
        await videoSource.add(sample, { keyFrame: frameCount % 30 === 0 });
        sample.close();
        frame.close();

        frameCount++;
        setProgress(Math.round((frameCount / totalFrames) * 90));
      }

      // Cleanup extra video elements
      for (const angle of Object.keys(extraVideos)) {
        const ev = extraVideos[angle];
        if (ev.blobUrl) URL.revokeObjectURL(ev.blobUrl);
      }

      if (abortRef.current) {
        setIsExporting(false);
        return;
      }

      setStatus('Finalizing...');

      await output.finalize();

      const buffer = output.target.buffer;
      if (!buffer) {
        throw new Error('Failed to generate video output');
      }
      const blob = new Blob([buffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);

      setExportUrl(url);
      setProgress(100);
      setStatus('Export complete!');
      setIsComplete(true);
      // Keep isExporting true to show the dialog with download button

    } catch (err) {
      console.error('Export error:', err);
      setStatus(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setIsExporting(false);
    } finally {
      // Cleanup - only revoke if it's an object URL (not Tauri asset URL)
      if (currentBlobUrl && !currentBlobUrl.startsWith('asset://') && !currentBlobUrl.startsWith('http')) {
        try {
          URL.revokeObjectURL(currentBlobUrl);
        } catch {
          // Ignore errors
        }
      }
      tempVideo.src = '';
    }
  }, [sequence, selectedAngle, allSeiMessages, fps, speedUnit, getSeiForTime, getAngleForTime, trimPoints, showTelemetry, showDateTime, showMap, layout, layoutConfig]);

  const stopExport = useCallback(() => {
    abortRef.current = true;
    setIsExporting(false);
    setIsComplete(false);
  }, []);

  const closeDialog = useCallback(() => {
    setIsExporting(false);
    setIsComplete(false);
    setProgress(0);
    setStatus('');
  }, []);

  const downloadExport = useCallback(() => {
    if (!exportUrl) return;

    const a = document.createElement('a');
    a.href = exportUrl;
    a.download = `${filename}-${Date.now()}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [exportUrl, filename]);

  return (
    <>
      <Tooltip content="Export to MP4" position="top">
        <button
          onClick={startExport}
          disabled={isExporting}
          className="flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          <IconDownload size={14} />
          <span>Export</span>
        </button>
      </Tooltip>

      {(isExporting || isComplete) && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-gray-900 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl border border-gray-700">
            <div className="text-center">
              {/* Icon - spinning loader or success check */}
              <div className="mb-6">
                {isComplete ? (
                  <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
                    <IconCheck size={40} className="text-green-500" />
                  </div>
                ) : (
                  <IconLoader2 size={48} className="animate-spin text-blue-500 mx-auto" />
                )}
              </div>

              <h3 className="text-xl font-semibold text-white mb-2">
                {isComplete ? 'Export Complete!' : 'Exporting Video'}
              </h3>
              <p className="text-gray-400 mb-6">{status}</p>

              {/* Progress bar - only show when not complete */}
              {!isComplete && (
                <>
                  <div className="w-full bg-gray-700 rounded-full h-3 mb-4 overflow-hidden">
                    <div
                      className="bg-blue-500 h-full rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-2xl font-bold text-white mb-6">{Math.round(progress)}%</p>
                </>
              )}

              {/* Action buttons */}
              <div className="flex flex-col gap-3">
                {isComplete ? (
                  <>
                    <button
                      onClick={downloadExport}
                      className="flex items-center gap-2 justify-center w-full px-6 py-3 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-500 transition-all"
                    >
                      <IconDownload size={18} />
                      Download MP4
                    </button>
                    <button
                      onClick={closeDialog}
                      className="px-6 py-2.5 rounded-lg text-sm font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 transition-all"
                    >
                      Close
                    </button>
                  </>
                ) : (
                  <button
                    onClick={stopExport}
                    className="flex items-center gap-2 mx-auto px-6 py-2.5 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-500 transition-all"
                  >
                    <IconPlayerStop size={18} />
                    Cancel Export
                  </button>
                )}
              </div>

              {/* CTA - only show during export, not on success */}
              {!isComplete && (
                <>
                  <a
                    href="https://nobig.deals"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-6 flex items-center gap-3 p-3 rounded-xl bg-gray-800/50 border border-gray-700 hover:border-gray-600 hover:bg-gray-800 transition-all"
                  >
                    <svg className="w-8 h-8 flex-shrink-0" viewBox="0 0 84 88" fill="none">
                      <path d="M33.241 68.7528C32.255 68.051 31.1554 67.5977 29.9415 67.3912C30.7378 67.129 31.4931 66.8013 32.2071 66.4057C33.6242 65.6425 34.7347 64.5737 35.5391 63.2C36.3816 61.8258 36.8029 60.1845 36.8029 58.2762C36.8029 56.3679 36.3054 54.5359 35.3096 53.0094C34.3134 51.4445 32.8392 50.2231 30.8862 49.3455C28.9712 48.4295 26.5965 47.9717 23.7628 47.9717H0V87.9315H24.5097C27.2671 87.9315 29.6224 87.4738 31.5754 86.5574C33.567 85.6414 35.0797 84.363 36.1136 82.7217C37.1861 81.0809 37.7225 79.2105 37.7225 77.1115C37.7225 75.3938 37.3203 73.81 36.5159 72.3594C35.7114 70.8709 34.6196 69.6688 33.241 68.7528ZM4.75917 54.4361H8.11589V54.4409L22.6134 54.4409C24.4898 54.4409 25.945 54.8802 26.9789 55.7577C28.0513 56.6358 28.5877 57.8758 28.5877 59.4791C28.5877 61.0823 28.0513 62.3608 26.9789 63.2004C25.945 64.04 24.4898 64.4598 22.6134 64.4598L8.04169 64.4598V59.4758C8.04169 59.0261 7.9983 58.5768 7.90019 58.1376C7.57785 56.6935 6.77222 55.6624 4.75876 55.6624L4.75917 54.4361ZM27.8984 80.0311C26.8264 80.9471 25.3133 81.4049 23.3602 81.4049H8.04169V75.6844C8.04169 75.2346 7.9983 74.7857 7.90059 74.3465C7.57826 72.9025 6.77222 71.8709 4.75917 71.8709V70.645H8.04169V70.6418L23.1879 70.6418C25.141 70.6418 26.6922 71.1384 27.8408 72.1307C28.9899 73.0847 29.5644 74.4205 29.5644 76.1381C29.5644 77.8557 29.0093 79.1152 27.8984 80.0311Z" fill="#EEE9E8"/>
                      <path d="M73.724 2.54189C70.6632 0.847296 67.2141 0 63.3757 0C59.5373 0 56.1372 0.847296 53.0278 2.54189C49.9184 4.23648 47.4411 6.63291 45.5947 9.73158C43.7973 12.7818 42.8984 16.4126 42.8984 20.6248C42.8984 24.837 43.773 28.4436 45.5217 31.5908C47.3191 34.689 49.7242 37.0859 52.7363 38.7804C55.7966 40.475 59.2218 41.3223 63.0112 41.3223C66.8005 41.3223 70.347 40.475 73.505 38.7804C76.6631 37.0859 79.1647 34.6894 81.0111 31.5908C82.9058 28.444 83.8533 24.7886 83.8533 20.6248C83.8533 16.4611 82.9301 12.7818 81.0841 9.73158C79.2867 6.63291 76.8334 4.23648 73.7244 2.54189H73.724ZM73.5054 28.1769C72.3398 30.162 70.8092 31.6627 68.9145 32.6793C67.0681 33.6474 65.1005 34.1314 63.0116 34.1314C60.9227 34.1314 58.9794 33.6474 57.182 32.6793C55.4329 31.6627 54.024 30.1616 52.9552 28.1769C51.8865 26.1433 51.3521 23.6261 51.3521 20.6244C51.3521 17.6227 51.9108 15.057 53.0282 13.0719C54.1456 11.0868 55.6028 9.61036 57.4006 8.64185C59.1979 7.67374 61.1417 7.18929 63.2305 7.18929C65.3194 7.18929 67.2627 7.67334 69.0601 8.64185C70.9065 9.60996 72.4123 11.0868 73.5784 13.0719C74.7441 15.057 75.3275 17.5742 75.3275 20.6244C75.3275 23.6746 74.7202 26.1437 73.5054 28.1769Z" fill="#EEE9E8"/>
                      <path d="M28.6122 2.07802C26.143 0.775354 23.3349 0.124023 20.1882 0.124023C18.5088 0.124023 16.9012 0.353929 15.3657 0.812931C12.7291 1.7269 10.3029 3.1839 9.5374 5.76014H8.28658V5.33265C8.28415 5.33588 8.28172 5.33871 8.27888 5.34194V0.775354H0V40.6508H8.27847V18.3613C8.27847 15.9006 8.69001 13.8505 9.51307 12.21C10.3844 10.5696 11.5707 9.33922 13.0713 8.519C14.5723 7.69877 16.3392 7.28866 18.3726 7.28866C21.3741 7.28866 23.7946 8.2297 25.6342 10.111C27.4737 11.9441 28.3941 14.6945 28.3941 18.3609V40.6504H36.6V17.1309C36.6 13.4161 35.8734 10.3041 34.4211 7.79534C33.017 5.23851 31.0806 3.3326 28.6118 2.07802H28.6122Z" fill="#EEE9E8"/>
                      <path d="M73.9775 50.4019C70.8288 48.7562 67.1035 47.9336 62.8025 47.9336H46.1484V88.0001H62.8025C67.1035 88.0001 70.8283 87.1779 73.9775 85.5322C77.1643 83.8865 79.6222 81.5713 81.3502 78.5865C83.1167 75.6018 83.9998 72.0809 83.9998 68.0246C83.9998 63.9684 83.1167 60.4285 81.3502 57.4054C79.6222 54.3823 77.1647 52.0472 73.9775 50.4019ZM72.3066 77.7255C70.041 80.0217 66.7771 81.1697 62.5146 81.1697H54.2124V59.7658C54.2124 59.3149 54.1691 58.8644 54.0705 58.4244C53.747 56.9767 52.9389 55.9427 50.921 55.9427V54.7136H54.2124V54.7075H62.5146C66.7771 54.7075 70.041 55.8938 72.3066 58.2664C74.6108 60.639 75.7631 63.892 75.7631 68.0251C75.7631 72.1581 74.6108 75.3909 72.3066 77.7255Z" fill="#EEE9E8"/>
                    </svg>
                    <div className="text-left">
                      <p className="text-xs text-gray-400">Got an idea? Looking for an AI-native team?</p>
                      <p className="text-sm text-gray-300 font-medium">we are nobig.deals ready to help you →</p>
                    </div>
                  </a>
                  <div className="flex items-center gap-3 mt-4 mb-3">
                    <div className="flex-1 h-px bg-gray-700" />
                    <span className="text-sm text-gray-500">or</span>
                    <div className="flex-1 h-px bg-gray-700" />
                  </div>
                  <a
                    href="https://buymeacoffee.com/nobigdeals"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block hover:opacity-90 transition-opacity"
                  >
                    <img
                      src="/bmc-button.png"
                      alt="Buy me a coffee"
                      className="w-full rounded-xl"
                    />
                  </a>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
