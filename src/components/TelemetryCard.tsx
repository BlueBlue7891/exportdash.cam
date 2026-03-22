'use client';

import { useMemo } from 'react';
import { SeiData } from '@/lib/dashcam-mp4';
import Image from 'next/image';
import { useLanguage } from '@/lib/i18n';

interface TelemetryCardProps {
  seiData: SeiData | null;
  isLoading: boolean;
  error: string | null;
  speedUnit: 'mph' | 'kmh';
  onSpeedUnitToggle: () => void;
}

export function TelemetryCard({
  seiData,
  isLoading,
  error,
  speedUnit,
  onSpeedUnitToggle,
}: TelemetryCardProps) {
  const { t } = useLanguage();

  const displaySpeed = useMemo(() => {
    if (!seiData?.vehicle_speed_mps) return 0;
    return speedUnit === 'mph'
      ? Math.round(seiData.vehicle_speed_mps * 2.23694)
      : Math.round(seiData.vehicle_speed_mps * 3.6);
  }, [seiData, speedUnit]);

  const gearLetter = useMemo(() => {
    if (seiData?.gear_state === undefined) return 'P';
    return ['P', 'D', 'R', 'N'][seiData.gear_state] || 'P';
  }, [seiData]);

  const steeringAngle = seiData?.steering_wheel_angle || 0;
  // Clamp accelerator to 0-100% (value might already be 0-100 or 0-1)
  const rawAccel = seiData?.accelerator_pedal_position || 0;
  const acceleratorPosition = Math.min(100, rawAccel > 1 ? rawAccel : rawAccel * 100);
  
  const autopilotLabels: Record<number, string> = {
    0: 'OFF',
    1: t.telemetry.selfDriving,
    2: t.telemetry.autosteer,
    3: t.telemetry.tacc,
  };
  const autopilotLabel = autopilotLabels[seiData?.autopilot_state ?? 0] || 'OFF';
  const isAutopilotActive = (seiData?.autopilot_state ?? 0) > 0;

  if (isLoading) {
    return (
      <div className="telemetry-card">
        <div className="flex items-center justify-center py-4 text-gray-500">
          <div className="w-5 h-5 border-2 border-gray-400 border-t-white rounded-full animate-spin mr-2" />
          {t.telemetry.loading}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="telemetry-card">
        <div className="text-center py-3 text-gray-500 text-sm">{error}</div>
      </div>
    );
  }

  if (!seiData) {
    return (
      <div className="telemetry-card">
        <div className="text-center py-3 text-gray-500 text-sm">{t.telemetry.noData}</div>
      </div>
    );
  }

  return (
    <div className="telemetry-wrapper">
      <div className="telemetry-card">
        {/* Column 1: Gear + Brake */}
        <div className="telemetry-column">
          <div className="telemetry-circle telemetry-gear">{gearLetter}</div>
          <div className={`telemetry-circle telemetry-brake ${seiData.brake_applied ? 'active' : ''}`}>
            <Image src="/left-pedal.png" alt={t.telemetry.brake} width={13} height={13} className="pedal-icon" />
          </div>
        </div>

        {/* Left Blinker */}
        <div className={`telemetry-blinker left ${seiData.blinker_on_left ? 'active' : ''}`}>
          <Image src="/blinker.svg" alt={t.telemetry.left} width={16} height={16} />
        </div>

        {/* Speed Display */}
        <div className="telemetry-speed" onClick={onSpeedUnitToggle}>
          <div className="speed-value">{displaySpeed}</div>
          <div className="speed-unit">{speedUnit === 'mph' ? t.player.mph : t.player.kmh}</div>
        </div>

        {/* Right Blinker */}
        <div className={`telemetry-blinker right ${seiData.blinker_on_right ? 'active' : ''}`}>
          <Image src="/blinker.svg" alt={t.telemetry.right} width={16} height={16} className="rotate-180" />
        </div>

        {/* Column 2: Steering + Accelerator */}
        <div className="telemetry-column">
          <div className={`telemetry-circle telemetry-steering ${isAutopilotActive ? 'autopilot' : ''}`}>
            <Image
              src="/wheel.svg"
              alt={t.telemetry.steering}
              width={16}
              height={16}
              className="wheel-icon"
              style={{ transform: `rotate(${steeringAngle}deg)` }}
            />
          </div>
          <div className="telemetry-circle telemetry-accelerator">
            <div className="accelerator-fill" style={{ height: `${acceleratorPosition}%` }} />
            <Image src="/right-pedal.png" alt={t.telemetry.accelerator} width={6} height={6} className="pedal-icon overlay" />
          </div>
        </div>
      </div>

      {/* Autopilot Label */}
      {isAutopilotActive && <div className="telemetry-autopilot">{autopilotLabel}</div>}

      <style jsx>{`
        .telemetry-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .telemetry-card {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 5px;
          background: rgba(12, 12, 12, 0.65);
          backdrop-filter: blur(5px);
          border-radius: 12px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        .telemetry-column {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .telemetry-circle {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: #3f3f3fde;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .telemetry-gear {
          font-size: 14px;
          font-weight: 700;
          color: #c0c0c0ff;
        }

        .telemetry-brake.active {
          background: #ff4444;
        }

        .telemetry-steering.autopilot {
          background: #006deb;
        }

        .telemetry-steering :global(.wheel-icon) {
          transition: transform 0.1s ease-out;
        }

        .telemetry-accelerator {
          position: relative;
          overflow: hidden;
        }

        .accelerator-fill {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: linear-gradient(to top, #4caf50, #8bc34a);
          transition: height 0.1s ease-out;
          border-radius: 0 0 50% 50%;
        }

        :global(.pedal-icon) {
          filter: brightness(1);
          object-fit: contain;
        }

        :global(.pedal-icon.overlay) {
          position: relative;
          z-index: 1;
        }

        .telemetry-blinker {
          opacity: 0.2;
          transition: opacity 0.2s;
        }

        .telemetry-blinker.active {
          opacity: 1;
          animation: blink 1s steps(1) infinite;
        }

        .telemetry-speed {
          display: flex;
          flex-direction: column;
          align-items: center;
          min-width: 50px;
          cursor: pointer;
          user-select: none;
        }

        .speed-value {
          font-size: 32px;
          font-weight: 500;
          line-height: 1;
          color: #c0c0c0;
        }

        .speed-unit {
          font-size: 10px;
          font-weight: 600;
          color: #9ca3af;
        }

        .telemetry-autopilot {
          margin-top: -1px;
          padding: 2px 12px;
          background: rgba(59, 130, 246, 0.9);
          border-radius: 0 0 8px 8px;
          font-size: 11px;
          font-weight: 600;
          color: #c0c0c0;
        }

        @keyframes blink {
          0% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        @media (max-width: 640px) {
          .telemetry-card {
            gap: 5px;
            padding: 4px;
          }

          .telemetry-column {
            gap: 4px;
          }  

          .telemetry-circle {
            width: 22px;
            height: 22px;
          }

          .telemetry-gear {
            font-size: 16px;
          }

          .speed-value {
            font-size: 28px;
          }

          .speed-unit {
            font-size: 10px;
          }

          .telemetry-blinker :global(img) {
            width: 12px;
            height: 12px;
          }
        }
      `}</style>
    </div>
  );
}
