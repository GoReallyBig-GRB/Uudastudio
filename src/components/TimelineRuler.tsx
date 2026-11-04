/**
 * X-PRO AUDIO - Timeline Ruler
 * Top time ruler header (340px) + time marker lane with interactive playhead scrubbing.
 */

import { usePlayhead } from '../playback/playheadStore';
import React, { useRef, useEffect } from 'react';
import { perfCount } from '../perf/perfProbe';
import { Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatTimecode } from '../utils/formatters';
import { formatRulerLabel, getRulerTickConfig } from './timelineRulerScale';

interface TimelineRulerProps {
  pixelsPerSecond: number;
  totalDurationSeconds: number;
  scrollLeft: number;
  onSeek: (seconds: number) => void;
  timelineWidth: number;
  isControlsCollapsed?: boolean;
  onToggleCollapseControls?: () => void;
}

/** CSS height of the ruler canvas (h-7) */
const RULER_HEIGHT = 28;

const PlayheadTime: React.FC = () => <>{formatTimecode(usePlayhead())}</>;

// The ruler is drawn on a canvas, which cannot use CSS classes, so read the design tokens once.
// Fallbacks match the token values so a missing stylesheet still draws a sensible ruler.
interface RulerColors { bg: string; bgBottom: string; border: string; tickMajor: string; tickMinor: string; label: string; labelStrong: string; accent: string; gold: string }
let rulerColorCache: RulerColors | null = null;
function getRulerColors(): RulerColors {
  if (rulerColorCache) return rulerColorCache;
  const css = getComputedStyle(document.documentElement);
  const tok = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  rulerColorCache = {
    bg: tok('--color-surface-1', '#101012'),
    bgBottom: tok('--color-surface-0', '#0a0a0b'),
    border: tok('--color-line-strong', 'rgb(255 255 255 / 0.13)'),
    tickMajor: tok('--color-ink-faint', '#6b6b72'),
    tickMinor: tok('--color-line-strong', 'rgb(255 255 255 / 0.13)'),
    label: tok('--color-ink-dim', '#a3a3a8'),
    labelStrong: tok('--color-ink', '#f2f2f0'),
    accent: tok('--color-accent', '#00f0ff'),
    gold: tok('--color-gold', '#e3be62'),
  };
  return rulerColorCache;
}

export const TimelineRuler: React.FC<TimelineRulerProps> = ({
  pixelsPerSecond,
  totalDurationSeconds,
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

  // Draw ruler canvas. The canvas is sized in device pixels and drawn in CSS pixels, so lines and text stay sharp on
  // high-density and scaled screens (it used to be sized in CSS pixels and then stretched, which blurred everything).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    perfCount('ruler draw');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = rulerViewportWidth;
    const height = RULER_HEIGHT;
    const pxW = Math.round(width * dpr);
    const pxH = Math.round(height * dpr);
    if (canvas.width !== pxW) canvas.width = pxW;
    if (canvas.height !== pxH) canvas.height = pxH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // A 1 device-pixel line centred on a device pixel, whatever the scale
    const crisp = (v: number) => (Math.round(v * dpr) + 0.5) / dpr;
    const line = 1 / dpr;

    const colors = getRulerColors();
    ctx.clearRect(0, 0, width, height);

    // Background: a soft step from the panel tone at the top to the app tone at the bottom
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, colors.bg);
    bg.addColorStop(1, colors.bgBottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Calculate visible time window
    const startTime = Math.max(0, scrollLeft / pixelsPerSecond);
    const endTime = startTime + width / pixelsPerSecond;

    const firstMajorIndex = Math.floor(startTime / majorStepSec);
    const lastMajorIndex = Math.ceil(endTime / majorStepSec);
    const minuteStep = Math.max(1, Math.round(60 / majorStepSec)); // whole minutes, when the step divides a minute

    // Time blocks: every other major interval gets a faint cyan wash, so the scale reads as blocks
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = colors.accent;
    for (let tickIndex = firstMajorIndex; tickIndex <= lastMajorIndex; tickIndex++) {
      if (tickIndex % 2 !== 0) continue;
      const x0 = tickIndex * majorStepSec * pixelsPerSecond - scrollLeft;
      const x1 = (tickIndex + 1) * majorStepSec * pixelsPerSecond - scrollLeft;
      if (x1 < 0 || x0 > width) continue;
      ctx.fillRect(x0, 0, x1 - x0, height - 1);
    }
    ctx.globalAlpha = 1;

    // Bottom border
    ctx.fillStyle = colors.border;
    ctx.fillRect(0, height - line, width, line);

    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textBaseline = 'top';

    for (let tickIndex = firstMajorIndex; tickIndex <= lastMajorIndex; tickIndex++) {
      const t = Number((tickIndex * majorStepSec).toPrecision(12));
      if (t < 0) continue;
      const rawX = t * pixelsPerSecond - scrollLeft;
      const isMinute = t > 0 && majorStepSec <= 60 && tickIndex % minuteStep === 0 && Math.abs(t / 60 - Math.round(t / 60)) < 1e-9;
      const isTenSec = !isMinute && Math.round(t) % 10 === 0 && t > 0;

      // Major tick: gold for whole minutes (taller), brighter for 10 s marks, quiet otherwise
      ctx.fillStyle = isMinute ? colors.gold : isTenSec ? colors.labelStrong : colors.tickMajor;
      ctx.fillRect(crisp(rawX) - line / 2, height - (isMinute ? 16 : 12), line, isMinute ? 16 : 12);

      // Timestamp label
      ctx.fillStyle = isMinute ? colors.gold : isTenSec ? colors.labelStrong : colors.label;
      ctx.fillText(formatRulerLabel(t, majorStepSec), Math.round(rawX) + 5, 4);

      // Minor ticks
      const minorStep = majorStepSec / minorTicks;
      ctx.fillStyle = colors.tickMinor;
      for (let m = 1; m < minorTicks; m++) {
        const mx = (t + m * minorStep) * pixelsPerSecond - scrollLeft;
        if (mx >= 0 && mx <= width) ctx.fillRect(crisp(mx) - line / 2, height - 6, line, 6);
      }
    }

  }, [pixelsPerSecond, totalDurationSeconds, scrollLeft, rulerViewportWidth, majorStepSec, minorTicks, isControlsCollapsed]);

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
              <PlayheadTime />
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
          onPointerDown={handlePointerDown}
          className="w-full h-full block"
        />
      </div>
    </div>
  );
};
