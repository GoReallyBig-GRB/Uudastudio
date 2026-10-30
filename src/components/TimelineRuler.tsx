/**
 * X-PRO AUDIO - Timeline Ruler
 * Top time ruler header (340px) + time marker lane with interactive playhead scrubbing.
 */

import React, { useRef, useEffect } from 'react';
import { Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatTimecode } from '../utils/formatters';
import { getRulerTickConfig } from './timelineRulerScale';

interface TimelineRulerProps {
  pixelsPerSecond: number;
  totalDurationSeconds: number;
  playheadSeconds: number;
  scrollLeft: number;
  onSeek: (seconds: number) => void;
  timelineWidth: number;
  isControlsCollapsed?: boolean;
  onToggleCollapseControls?: () => void;
}

export const TimelineRuler: React.FC<TimelineRulerProps> = ({
  pixelsPerSecond,
  totalDurationSeconds,
  playheadSeconds,
  scrollLeft,
  onSeek,
  timelineWidth,
  isControlsCollapsed = false,
  onToggleCollapseControls,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isScrubbingRef = useRef<boolean>(false);
  const rulerViewportWidth = Math.max(100, timelineWidth);

  // One adaptive scale keeps labels readable from long tracks to sample-level zoom.
  const { majorStepSeconds: majorStepSec, minorDivisions: minorTicks } =
    getRulerTickConfig(pixelsPerSecond);

  // Draw ruler canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = '#0a0a0b';
    ctx.fillRect(0, 0, width, height);

    // Bottom border
    ctx.strokeStyle = '#1c1c20';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height - 0.5);
    ctx.lineTo(width, height - 0.5);
    ctx.stroke();

    // Calculate visible time window
    const startTime = Math.max(0, scrollLeft / pixelsPerSecond);
    const endTime = startTime + width / pixelsPerSecond;

    const firstMajorIndex = Math.floor(startTime / majorStepSec);
    const lastMajorIndex = Math.ceil(endTime / majorStepSec);

    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textBaseline = 'top';

    for (let tickIndex = firstMajorIndex; tickIndex <= lastMajorIndex; tickIndex++) {
      const t = Number((tickIndex * majorStepSec).toPrecision(12));
      if (t < 0) continue;
      const x = Math.round(t * pixelsPerSecond - scrollLeft);

      // Major tick mark (distinguishable, clean 1px line)
      ctx.strokeStyle = '#52525b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, height - 12);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();

      // Timestamp label (crisp text with subtle cyan tint for whole 10s intervals)
      const isTenSec = Math.round(t) % 10 === 0 && t > 0;
      ctx.fillStyle = isTenSec ? '#38bdf8' : '#a1a1aa';
      const label = formatTimecode(t); // Include minutes so long tracks remain unambiguous
      ctx.fillText(label, x + 4, 3);

      // Minor ticks
      const minorStep = majorStepSec / minorTicks;
      for (let m = 1; m < minorTicks; m++) {
        const minorTime = t + m * minorStep;
        const mx = Math.round(minorTime * pixelsPerSecond - scrollLeft);
        if (mx >= 0 && mx <= width) {
          ctx.strokeStyle = '#3f3f46';
          ctx.beginPath();
          ctx.moveTo(mx + 0.5, height - 6);
          ctx.lineTo(mx + 0.5, height);
          ctx.stroke();
        }
      }
    }

  }, [pixelsPerSecond, totalDurationSeconds, playheadSeconds, scrollLeft, rulerViewportWidth, majorStepSec, minorTicks, isControlsCollapsed]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    isScrubbingRef.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    const pixelX = e.clientX - rect.left;
    const time = Math.max(0, (pixelX + scrollLeft) / pixelsPerSecond);
    onSeek(time);

    const onPointerMove = (moveEv: PointerEvent) => {
      if (!isScrubbingRef.current) return;
      const movePixelX = moveEv.clientX - rect.left;
      const moveTime = Math.max(0, (movePixelX + scrollLeft) / pixelsPerSecond);
      onSeek(moveTime);
    };

    const onPointerUp = () => {
      isScrubbingRef.current = false;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  return (
    <div className="h-7 w-full flex shrink-0 border-b border-line bg-surface-0 select-none">
      {/* Collapsible Header matching track controls */}
      {isControlsCollapsed ? (
        <div className="w-[32px] shrink-0 border-r border-line flex items-center justify-center bg-surface-1 transition-all duration-200">
          <button
            type="button"
            onClick={onToggleCollapseControls}
            aria-expanded="false"
            aria-label="Expand Track Controls"
            title="Expand Track Controls (Show volume, pan, mute, solo)"
            className="w-6 h-6 rounded flex items-center justify-center text-ink-dim hover:text-ink hover:bg-white/5 transition-colors cursor-pointer"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="w-[272px] shrink-0 border-r border-line px-2.5 flex items-center justify-between text-ink-dim transition-all duration-200">
          <div className="flex items-center gap-1.5 text-xs font-num font-medium">
            <Clock className="w-3.5 h-3.5 text-ink-faint" />
            <span className="text-ink font-semibold tracking-wider text-[11px]">TIMELINE</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-num text-accent font-bold bg-surface-1 px-2 py-0.5 rounded-full border border-line">
              {formatTimecode(playheadSeconds)}
            </span>
            <button
              type="button"
              onClick={onToggleCollapseControls}
              aria-expanded="true"
              aria-label="Collapse Track Controls"
              title="Collapse Track Controls (Expand waveform workspace)"
              className="p-1 rounded text-ink-faint hover:text-ink hover:bg-white/5 transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Ruler canvas */}
      <div className="flex-1 overflow-hidden relative cursor-ew-resize">
        <canvas
          ref={canvasRef}
          width={rulerViewportWidth}
          height={28}
          onPointerDown={handlePointerDown}
          className="w-full h-full block"
        />
      </div>
    </div>
  );
};
