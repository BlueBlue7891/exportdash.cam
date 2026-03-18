'use client';

import { useEffect, useCallback } from 'react';
import { LayoutCameraConfig, DEFAULT_LAYOUT_CONFIG, ANGLE_LABELS } from '@/types/video';
import { IconRefresh, IconX } from '@tabler/icons-react';

type LayoutType = 'pip' | 'triple' | 'all';

interface LayoutConfigPopoverProps {
  layout: LayoutType;
  config: LayoutCameraConfig;
  onChange: (config: LayoutCameraConfig) => void;
  onClose: () => void;
}

const ALL_ANGLES = ['front', 'back', 'left_repeater', 'right_repeater', 'left_pillar', 'right_pillar'];

const PIP_OPTIONS = ['none', ...ALL_ANGLES, 'map'];
const PIP_LABELS: Record<string, string> = {
  ...ANGLE_LABELS,
  none: 'None',
  map: 'Map',
};

// Position-specific allowed options for PiP layout
// corners: [bottom-left, bottom-center, bottom-right, top-left, top-right]
const PIP_POSITION_OPTIONS: string[][] = [
  ['left_pillar', 'none', 'map'],      // 0: bottom-left (L Pillar)
  ['front', 'back', 'none', 'map'],    // 1: bottom-center (Front/Rear)
  ['right_pillar', 'none', 'map'],     // 2: bottom-right (R Pillar)
  ['left_repeater', 'none', 'map'],    // 3: top-left (Left)
  ['right_repeater', 'none', 'map'],   // 4: top-right (Right)
];

// Default values for each position when clearing
const PIP_POSITION_DEFAULTS = ['left_pillar', 'back', 'right_pillar', 'left_repeater', 'right_repeater'];

function CameraSelect({
  value,
  onChange,
  label,
  options,
  labels,
}: {
  value: string;
  onChange: (angle: string) => void;
  label: string;
  options?: string[];
  labels?: Record<string, string>;
}) {
  const opts = options || ALL_ANGLES;
  const lbls = labels || ANGLE_LABELS;

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[9px] text-gray-500 uppercase tracking-wide">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-gray-700 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600 hover:border-gray-500 focus:border-blue-500 focus:outline-none cursor-pointer w-[80px] text-center appearance-none"
      >
        {opts.map((angle) => (
          <option key={angle} value={angle}>
            {lbls[angle] || angle}
          </option>
        ))}
      </select>
    </div>
  );
}

export function LayoutConfigPopover({
  layout,
  config,
  onChange,
  onClose,
}: LayoutConfigPopoverProps) {
  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  const handleReset = useCallback(() => {
    onChange({ ...DEFAULT_LAYOUT_CONFIG });
  }, [onChange]);

  // PiP config — screen simulation
  // corners: [bottom-left, bottom-center, bottom-right, top-left, top-right]
  const renderPipConfig = () => {
    const corners = config.pip.corners;

    const update = (index: number, newAngle: string) => {
      const currentAngle = corners[index];
      if (newAngle === currentAngle) return;

      const c = [...corners] as [string, string, string, string, string];
      
      // Handle map uniqueness: if setting new map, clear previous map
      // Map is a special display element that can only appear once
      if (newAngle === 'map') {
        const existingMapIndex = c.findIndex((angle, i) => i !== index && angle === 'map');
        if (existingMapIndex !== -1) {
          // Restore previous map position to its default value
          c[existingMapIndex] = PIP_POSITION_DEFAULTS[existingMapIndex];
        }
      }
      
      // Note: Camera angles can appear in multiple corners (including same as main view)
      // No uniqueness check for camera angles - they can repeat
      
      c[index] = newAngle;
      onChange({ ...config, pip: { corners: c } });
    };

    return (
      <div className="space-y-2">
        <div className="text-[10px] text-gray-400 text-center">Corner cameras around main view</div>
        {/* Screen simulation */}
        <div className="relative bg-gray-900 rounded-lg border border-gray-600 aspect-video mx-auto max-w-[320px]">
          {/* Main label */}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] text-gray-600">Main Camera</span>
          </div>
          {/* Top row */}
          <div className="absolute top-1.5 left-1.5 right-1.5 flex justify-between">
            <CameraSelect value={corners[3]} onChange={(a) => update(3, a)} label="" options={PIP_POSITION_OPTIONS[3]} labels={PIP_LABELS} />
            <CameraSelect value={corners[4]} onChange={(a) => update(4, a)} label="" options={PIP_POSITION_OPTIONS[4]} labels={PIP_LABELS} />
          </div>
          {/* Bottom row */}
          <div className="absolute bottom-1.5 left-1.5 right-1.5 flex justify-between items-end">
            <CameraSelect value={corners[0]} onChange={(a) => update(0, a)} label="" options={PIP_POSITION_OPTIONS[0]} labels={PIP_LABELS} />
            <CameraSelect value={corners[1]} onChange={(a) => update(1, a)} label="" options={PIP_POSITION_OPTIONS[1]} labels={PIP_LABELS} />
            <CameraSelect value={corners[2]} onChange={(a) => update(2, a)} label="" options={PIP_POSITION_OPTIONS[2]} labels={PIP_LABELS} />
          </div>
        </div>
      </div>
    );
  };

  // Triple config — screen simulation
  const renderTripleConfig = () => {
    const cameras = config.triple.cameras;

    const updateCamera = (index: number, newAngle: string) => {
      const currentAngle = cameras[index];
      if (newAngle === currentAngle) return;

      const newCameras = [...cameras] as [string, string, string];
      
      // Check if the new angle is already used by another position
      // If so, don't swap - just prevent the change (angles must be unique)
      const existingIndex = newCameras.findIndex((angle, i) => i !== index && angle === newAngle);
      
      if (existingIndex !== -1) {
        // Don't allow duplicate angles in triple view
        // Revert to previous value by not updating
        return;
      }
      
      newCameras[index] = newAngle;
      onChange({ ...config, triple: { cameras: newCameras } });
    };

    return (
      <div className="space-y-2">
        <div className="text-[10px] text-gray-400 text-center">Three cameras side by side</div>
        <div className="relative bg-gray-900 rounded-lg border border-gray-600 aspect-video mx-auto max-w-[320px]">
          <div className="absolute inset-0 flex items-end justify-center gap-2 p-2">
            <CameraSelect value={cameras[0]} onChange={(a) => updateCamera(0, a)} label="Left" />
            <CameraSelect value={cameras[1]} onChange={(a) => updateCamera(1, a)} label="Center" />
            <CameraSelect value={cameras[2]} onChange={(a) => updateCamera(2, a)} label="Right" />
          </div>
        </div>
      </div>
    );
  };

  // All 6 config — screen simulation
  const renderAllConfig = () => {
    const { topRow, bottomRow } = config.all;

    const updateTop = (index: number, newAngle: string) => {
      const currentAngle = topRow[index];
      if (newAngle === currentAngle) return;

      const newTopRow = [...topRow] as [string, string, string];
      const newBottomRow = [...bottomRow] as [string, string, string];
      const allAngles = [...topRow, ...bottomRow];
      
      // Check if the new angle is already used by another position
      // If so, don't allow the change (angles must be unique in all 6 layout)
      const existingGlobalIndex = allAngles.findIndex((angle, i) => {
        if (i === index) return false; // Skip self
        return angle === newAngle;
      });
      
      if (existingGlobalIndex !== -1) {
        // Don't allow duplicate angles
        return;
      }
      
      newTopRow[index] = newAngle;
      onChange({ ...config, all: { ...config.all, topRow: newTopRow, bottomRow: newBottomRow } });
    };

    const updateBottom = (index: number, newAngle: string) => {
      const currentAngle = bottomRow[index];
      if (newAngle === currentAngle) return;

      const newTopRow = [...topRow] as [string, string, string];
      const newBottomRow = [...bottomRow] as [string, string, string];
      const allAngles = [...topRow, ...bottomRow];
      
      // Check if the new angle is already used by another position
      // If so, don't allow the change (angles must be unique in all 6 layout)
      const existingGlobalIndex = allAngles.findIndex((angle, i) => {
        if (i === index + 3) return false; // Skip self (index + 3 is the global position)
        return angle === newAngle;
      });
      
      if (existingGlobalIndex !== -1) {
        // Don't allow duplicate angles
        return;
      }
      
      newBottomRow[index] = newAngle;
      onChange({ ...config, all: { ...config.all, topRow: newTopRow, bottomRow: newBottomRow } });
    };

    return (
      <div className="space-y-2">
        <div className="text-[10px] text-gray-400 text-center">Two rows of three cameras</div>
        <div className="relative bg-gray-900 rounded-lg border border-gray-600 aspect-video mx-auto max-w-[320px]">
          <div className="absolute inset-0 flex flex-col justify-center gap-2 p-2">
            <div className="flex justify-center gap-2">
              <CameraSelect value={topRow[0]} onChange={(a) => updateTop(0, a)} label="Top L" />
              <CameraSelect value={topRow[1]} onChange={(a) => updateTop(1, a)} label="Top C" />
              <CameraSelect value={topRow[2]} onChange={(a) => updateTop(2, a)} label="Top R" />
            </div>
            <div className="flex justify-center gap-2">
              <CameraSelect value={bottomRow[0]} onChange={(a) => updateBottom(0, a)} label="Bot L" />
              <CameraSelect value={bottomRow[1]} onChange={(a) => updateBottom(1, a)} label="Bot C" />
              <CameraSelect value={bottomRow[2]} onChange={(a) => updateBottom(2, a)} label="Bot R" />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const titles: Record<LayoutType, string> = {
    pip: 'PiP Layout',
    triple: 'Triple Layout',
    all: 'All 6 Layout',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-gray-800 border border-gray-600 rounded-xl shadow-2xl p-4 min-w-[340px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-gray-200">{titles[layout]}</h4>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-200 transition-colors"
            >
              <IconRefresh size={10} />
              Reset
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
              <IconX size={14} />
            </button>
          </div>
        </div>

        {layout === 'pip' && renderPipConfig()}
        {layout === 'triple' && renderTripleConfig()}
        {layout === 'all' && renderAllConfig()}
      </div>
    </div>
  );
}
