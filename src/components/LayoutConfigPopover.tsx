'use client';

import { useEffect, useCallback } from 'react';
import { LayoutCameraConfig, DEFAULT_LAYOUT_CONFIG } from '@/types/video';
import { IconRefresh, IconX } from '@tabler/icons-react';
import { useLanguage } from '@/lib/i18n';

type LayoutType = 'pip' | 'triple' | 'all';

interface LayoutConfigPopoverProps {
  layout: LayoutType;
  config: LayoutCameraConfig;
  onChange: (config: LayoutCameraConfig) => void;
  onClose: () => void;
}

const ALL_ANGLES = ['front', 'back', 'left_repeater', 'right_repeater', 'left_pillar', 'right_pillar'];

const PIP_OPTIONS = ['none', ...ALL_ANGLES, 'map'];

// Position-specific allowed options for PiP layout
// corners: [bottom-left, bottom-center, bottom-right, top-left, top-right]
const PIP_POSITION_OPTIONS: string[][] = [
  ['left_pillar', 'front', 'back', 'map', 'none'],      // 0: bottom-left
  ['front', 'back', 'left_repeater', 'right_repeater', 'left_pillar', 'right_pillar', 'map', 'none'],  // 1: bottom-center
  ['right_pillar', 'front', 'back', 'map', 'none'],     // 2: bottom-right
  ['left_repeater', 'front', 'back', 'map', 'none'],    // 3: top-left
  ['right_repeater', 'front', 'back', 'map', 'none'],   // 4: top-right
];

// Default values for each position when clearing
const PIP_POSITION_DEFAULTS = ['left_pillar', 'back', 'right_pillar', 'left_repeater', 'right_repeater'];

// Special values that should be unique across corners (like map, front, back)
const PIP_UNIQUE_VALUES = ['map', 'front', 'back'];

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
  const { t } = useLanguage();
  const opts = options || ALL_ANGLES;
  const defaultLabels: Record<string, string> = {
    ...t.angles,
    none: t.layoutConfig.none,
    map: t.layoutConfig.map,
  };
  const lbls = labels || defaultLabels;

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[9px] text-gray-500 uppercase tracking-wide">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-gray-700 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600 hover:border-gray-500 focus:border-blue-500 focus:outline-none cursor-pointer w-[80px] text-center appearance-none truncate overflow-hidden"
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
  const { t } = useLanguage();

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

  // Get PIP labels with translations
  const pipLabels: Record<string, string> = {
    ...t.angles,
    none: t.layoutConfig.none,
    map: t.layoutConfig.map,
  };

  // PiP config — screen simulation
  // corners: [bottom-left, bottom-center, bottom-right, top-left, top-right]
  const renderPipConfig = () => {
    const corners = config.pip.corners;

    const update = (index: number, newAngle: string) => {
      const currentAngle = corners[index];
      if (newAngle === currentAngle) return;

      const c = [...corners] as [string, string, string, string, string];
      
      // Handle unique values (map, front, back): if setting a unique value, clear previous occurrence
      // These are special display elements that can only appear once across all corners
      if (PIP_UNIQUE_VALUES.includes(newAngle)) {
        const existingIndex = c.findIndex((angle, i) => i !== index && angle === newAngle);
        if (existingIndex !== -1) {
          // Restore previous position to its default value
          const defaultValue = PIP_POSITION_DEFAULTS[existingIndex];
          // If the default is also a unique value (e.g., index 1 defaults to 'back'),
          // set to 'none' instead to avoid duplicates
          if (PIP_UNIQUE_VALUES.includes(defaultValue)) {
            c[existingIndex] = 'none';
          } else {
            c[existingIndex] = defaultValue;
          }
        }
      }
      
      // Handle side camera angles (left_repeater, right_repeater, left_pillar, right_pillar)
      // These are mutually exclusive between center (index 1) and corners (indices 0, 2, 3, 4)
      const SIDE_ANGLES = ['left_repeater', 'right_repeater', 'left_pillar', 'right_pillar'];
      if (SIDE_ANGLES.includes(newAngle)) {
        const CENTER_INDEX = 1;
        const CORNER_INDICES = [0, 2, 3, 4];
        
        if (index === CENTER_INDEX) {
          // Setting center: clear any corner that has the same angle
          CORNER_INDICES.forEach(cornerIdx => {
            if (c[cornerIdx] === newAngle) {
              c[cornerIdx] = 'none';
            }
          });
        } else if (CORNER_INDICES.includes(index)) {
          // Setting a corner: reset center to default ('back')
          c[CENTER_INDEX] = 'back';
        }
      }
      
      c[index] = newAngle;
      onChange({ ...config, pip: { corners: c } });
    };

    return (
      <div className="space-y-2">
        <div className="text-[10px] text-gray-400 text-center">{t.layoutConfig.cornerCamerasAroundMain}</div>
        {/* Screen simulation */}
        <div className="relative bg-gray-900 rounded-lg border border-gray-600 aspect-video mx-auto max-w-[320px]">
          {/* Main label */}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] text-gray-600">{t.layoutConfig.mainCameraLabel}</span>
          </div>
          {/* Top row */}
          <div className="absolute top-1.5 left-1.5 right-1.5 flex justify-between">
            <CameraSelect value={corners[3]} onChange={(a) => update(3, a)} label="" options={PIP_POSITION_OPTIONS[3]} labels={pipLabels} />
            <CameraSelect value={corners[4]} onChange={(a) => update(4, a)} label="" options={PIP_POSITION_OPTIONS[4]} labels={pipLabels} />
          </div>
          {/* Bottom row */}
          <div className="absolute bottom-1.5 left-1.5 right-1.5 flex justify-between items-end">
            <CameraSelect value={corners[0]} onChange={(a) => update(0, a)} label="" options={PIP_POSITION_OPTIONS[0]} labels={pipLabels} />
            <CameraSelect value={corners[1]} onChange={(a) => update(1, a)} label="" options={PIP_POSITION_OPTIONS[1]} labels={pipLabels} />
            <CameraSelect value={corners[2]} onChange={(a) => update(2, a)} label="" options={PIP_POSITION_OPTIONS[2]} labels={pipLabels} />
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
        <div className="text-[10px] text-gray-400 text-center">{t.layoutConfig.threeCamerasSideBySide}</div>
        <div className="relative bg-gray-900 rounded-lg border border-gray-600 aspect-video mx-auto max-w-[320px]">
          <div className="absolute inset-0 flex items-end justify-center gap-2 p-2">
            <CameraSelect value={cameras[0]} onChange={(a) => updateCamera(0, a)} label={t.layoutConfig.left} />
            <CameraSelect value={cameras[1]} onChange={(a) => updateCamera(1, a)} label={t.layoutConfig.center} />
            <CameraSelect value={cameras[2]} onChange={(a) => updateCamera(2, a)} label={t.layoutConfig.right} />
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
        <div className="text-[10px] text-gray-400 text-center">{t.layoutConfig.twoRowsOfThree}</div>
        <div className="relative bg-gray-900 rounded-lg border border-gray-600 aspect-video mx-auto max-w-[320px]">
          <div className="absolute inset-0 flex flex-col justify-center gap-2 p-2">
            <div className="flex justify-center gap-2">
              <CameraSelect value={topRow[0]} onChange={(a) => updateTop(0, a)} label={t.layoutConfig.topLeftShort} />
              <CameraSelect value={topRow[1]} onChange={(a) => updateTop(1, a)} label={t.layoutConfig.topCenterShort} />
              <CameraSelect value={topRow[2]} onChange={(a) => updateTop(2, a)} label={t.layoutConfig.topRightShort} />
            </div>
            <div className="flex justify-center gap-2">
              <CameraSelect value={bottomRow[0]} onChange={(a) => updateBottom(0, a)} label={t.layoutConfig.bottomLeftShort} />
              <CameraSelect value={bottomRow[1]} onChange={(a) => updateBottom(1, a)} label={t.layoutConfig.bottomCenterShort} />
              <CameraSelect value={bottomRow[2]} onChange={(a) => updateBottom(2, a)} label={t.layoutConfig.bottomRightShort} />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const titles: Record<LayoutType, string> = {
    pip: t.layoutConfig.pipTitle,
    triple: t.layoutConfig.tripleTitle,
    all: t.layoutConfig.all6Title,
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30" onClick={onClose}>
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
              {t.layoutConfig.resetToDefault}
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
