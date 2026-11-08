/**
 * X-PRO AUDIO - Bottom Status Bar & Transport Footer
 * Displays: Engine Status, Tracks/Clips stats, Master Audio Level Meter, Dual Timer (Position/Total),
 * Zoom Controls, Autosave Badge, and Shortcut Hints.
 */

import { usePlayhead } from '../playback/playheadStore';
import React, { useRef, useState, useEffect } from 'react';
import { Database, HelpCircle, Activity, Radio, ZoomIn, ZoomOut, Maximize2, Clock } from 'lucide-react';
import { formatTimecode, formatVolumeDb } from '../utils/formatters';
import { audioEngine } from '../audio/engine';

interface StatusBarProps {
  sampleRate: number;
  trackCount: number;
  clipCount: number;
  selectedClipCount: number;
  totalDurationSeconds: number;
  isPlaying: boolean;
  pixelsPerSecond: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
  isAutosaving: boolean;
  lastSavedAt: Date | null;
  /** Gain of the single selected clip (linear), or null when no single loose clip is selected */
  selectedClipGain?: number | null;
  onNudgeClipGain?: (deltaDb: number) => void;
}

/** The only part of the status bar that changes while playing */
const PlayheadTime: React.FC = () => <>{formatTimecode(usePlayhead())}</>;

/** The master meter is drawn on a canvas, which cannot use CSS classes, so read the design tokens once per mount. */
function readMeterColors() {
  const css = getComputedStyle(document.documentElement);
  const t = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    bg: t('--color-surface-0', '#0a0a0b'),
    ok: t('--color-ok', '#5fbf94'),
    warn: t('--color-warn', '#d9a441'),
    danger: t('--color-danger', '#e0707a'),
    peak: t('--color-ink', '#f2f2f0'),
    idle: t('--color-line-strong', 'rgb(255 255 255 / 0.13)'),
  };
}

export const StatusBar: React.FC<StatusBarProps> = ({
  sampleRate,
  trackCount,
  clipCount,
  selectedClipCount,
  totalDurationSeconds,
  isPlaying,
  pixelsPerSecond,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  isAutosaving,
  lastSavedAt,
  selectedClipGain = null,
  onNudgeClipGain,
}) => {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const masterMeterRef = useRef<HTMLCanvasElement | null>(null);

  // Master Meter animation loop
  useEffect(() => {
    let animId: number;
    const mc = readMeterColors();
    let peakHold = 0;

    const renderMasterMeter = () => {
      const canvas = masterMeterRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);

          ctx.fillStyle = mc.bg;
          ctx.fillRect(0, 0, w, h);

          if (isPlaying) {
            const meter = audioEngine.getMasterMeter();
            const peak = Math.min(1.2, meter.peak);
            const rms = Math.min(1.0, meter.rms);

            if (peak > peakHold) {
              peakHold = peak;
            } else {
              peakHold = Math.max(0, peakHold * 0.95);
            }

            const rmsWidth = rms * w;
            const grad = ctx.createLinearGradient(0, 0, w, 0);
            grad.addColorStop(0, mc.ok);
            grad.addColorStop(0.7, mc.warn);
            grad.addColorStop(0.9, mc.danger);
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, rmsWidth, h);

            const peakX = Math.min(w - 2, peakHold * w);
            ctx.fillStyle = peakHold >= 0.99 ? mc.danger : mc.peak;
            ctx.fillRect(peakX, 0, 2, h);
          } else {
            peakHold = 0;
            // Draw faint idle baseline
            ctx.fillStyle = mc.idle;
            ctx.fillRect(0, h - 2, w, 1);
          }
        }
      }
      animId = requestAnimationFrame(renderMasterMeter);
    };

    animId = requestAnimationFrame(renderMasterMeter);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying]);

  return (
    <footer className="h-10 bg-surface-0 border-t border-line px-4 flex items-center justify-between text-[11px] text-ink-dim select-none shrink-0 z-30">
      {/* Left info: Engine state & Project counts */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1.5 text-ok font-num text-[10px]">
          <Radio className="w-3 h-3 text-ok animate-pulse" />
          <span className="font-bold tracking-wider">ENGINE READY</span>
        </div>

        <div className="h-3 w-px bg-line hidden sm:block" />

        <div className="hidden sm:flex items-center gap-1 font-num text-[10px] text-ink-faint">
          <Activity className="w-3 h-3 text-ink-faint" />
          <span>{(sampleRate / 1000).toFixed(1)} kHz</span>
          <span className="text-ink-faint">/</span>
          <span>32-bit</span>
        </div>

        <div className="h-3 w-px bg-line" />

        <div className="text-[11px] text-ink-dim">
          <span>Tracks: </span>
          <strong className="text-ink font-num">{trackCount}</strong>
          <span className="mx-1 text-ink-faint">·</span>
          <span>Clips: </span>
          <strong className="text-ink font-num">{clipCount}</strong>
          {selectedClipCount > 0 && (
            <>
              <span className="mx-1 text-ink-faint">·</span>
              <span className="text-accent font-semibold">
                {selectedClipCount} selected
              </span>
            </>
          )}
        </div>

        {/* Gain of the selected clip, nudged in 1 dB steps */}
        {selectedClipGain !== null && onNudgeClipGain && (
          <div className="flex items-center gap-1 text-[11px] text-ink-dim" title="Gain of the selected clip">
            <span>Clip gain</span>
            <button type="button" onClick={() => onNudgeClipGain(-1)} title="Volume -1 dB" className="rounded-full bg-surface-3 px-1.5 py-0.5 font-num text-[10px] hover:bg-white/10 cursor-pointer">-1</button>
            <strong className="min-w-[3.5rem] text-center font-num text-ink">{formatVolumeDb(selectedClipGain)}</strong>
            <button type="button" onClick={() => onNudgeClipGain(1)} title="Volume +1 dB" className="rounded-full bg-surface-3 px-1.5 py-0.5 font-num text-[10px] hover:bg-white/10 cursor-pointer">+1</button>
          </div>
        )}
      </div>

      {/* Center Section: Dual Timer Display & Master VU Level Display */}
      <div className="flex items-center gap-3">
        {/* Dual Timer Display: Position & Total Mix Duration */}
        <div
          title="Playback Position & Total Session Duration"
          className="bg-surface-1 border border-line rounded-full px-3.5 py-0.5 flex items-center gap-2"
        >
          <Clock className="w-3 h-3 text-ink-faint" />
          <div className="flex items-center gap-1.5 font-num">
            <span className="text-[9px] text-ink-faint font-bold uppercase tracking-wider">POS</span>
            <span className="text-accent font-bold tracking-wider text-xs">
              <PlayheadTime />
            </span>
            <span className="text-ink-faint font-normal">/</span>
            <span className="text-[9px] text-ink-faint font-bold uppercase tracking-wider">TOTAL</span>
            <span className="text-ink-dim font-semibold tracking-wider text-xs">
              {formatTimecode(totalDurationSeconds)}
            </span>
          </div>
        </div>

        {/* Master / Idle Audio Level Display */}
        <div
          title="Master Bus Output Level Meter (Live RMS & Peak)"
          className="flex items-center gap-2 bg-surface-1 border border-line rounded-full px-3 py-1"
        >
          <div className="flex flex-col text-[9px] font-num leading-none">
            <span className="text-ink-dim font-bold tracking-wider">MASTER</span>
            <span className={`text-[8px] font-semibold ${isPlaying ? 'text-ok' : 'text-ink-faint'}`}>
              {isPlaying ? 'LIVE' : 'IDLE'}
            </span>
          </div>
          <div className="w-24 h-2.5 bg-surface-0 rounded-full border border-line overflow-hidden">
            <canvas ref={masterMeterRef} width={96} height={10} className="w-full h-full block" />
          </div>
        </div>
      </div>

      {/* Right Controls: Zoom Cluster, Autosave badge, and Shortcuts */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Zoom Controls Cluster */}
        <div
          title="Timeline Zoom Controls"
          className="flex items-center gap-0.5 bg-surface-1 p-0.5 rounded-full border border-line"
        >
          <button
            onClick={onZoomOut}
            title="Zoom Out Timeline (Ctrl + Wheel Down)"
            className="p-1.5 text-ink-dim hover:text-ink hover:bg-white/5 rounded-full transition-colors cursor-pointer"
          >
            <ZoomOut className="w-3 h-3" />
          </button>
          <span className="text-[10px] font-num text-ink-dim px-1 min-w-[42px] text-center select-none">
            {pixelsPerSecond >= 10 ? Math.round(pixelsPerSecond) : pixelsPerSecond.toFixed(1)}px/s
          </span>
          <button
            onClick={onZoomIn}
            title="Zoom In Timeline (Ctrl + Wheel Up)"
            className="p-1.5 text-ink-dim hover:text-ink hover:bg-white/5 rounded-full transition-colors cursor-pointer"
          >
            <ZoomIn className="w-3 h-3" />
          </button>
          <button
            onClick={onZoomFit}
            title="Reset Zoom / Fit to Timeline"
            className="p-1.5 text-ink-dim hover:text-ink hover:bg-white/5 rounded-full transition-colors cursor-pointer"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
        </div>

        <div className="h-3 w-px bg-line hidden md:block" />

        {/* Autosave badge */}
        <div className="hidden md:flex items-center gap-1.5 text-ink-dim">
          <Database className="w-3 h-3 text-ink-faint" />
          {isAutosaving ? (
            <span className="text-warn animate-pulse text-[10px] font-medium">Saving...</span>
          ) : lastSavedAt ? (
            <span className="text-ink-dim font-num text-[10px]">
              Saved {lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          ) : (
            <span className="text-ink-faint font-num text-[10px]">Autosave ready</span>
          )}
        </div>

        <div className="h-3 w-px bg-line" />

        {/* Shortcuts toggle */}
        <div className="relative">
          <button
            onClick={() => setShowShortcuts(!showShortcuts)}
            className="flex items-center gap-1 text-ink-dim hover:text-ink hover:bg-white/5 px-2.5 py-1 rounded-full transition-colors cursor-pointer"
          >
            <HelpCircle className="w-3 h-3 text-ink-dim" />
            <span>Shortcuts</span>
          </button>

          {showShortcuts && (
            <div
              onClick={() => setShowShortcuts(false)}
              className="absolute right-0 bottom-full mb-2 w-64 bg-surface-2 border border-line-strong rounded-card shadow-float p-3 z-50 text-[11px] text-ink-dim"
            >
              <div className="font-semibold text-ink pb-1.5 mb-2 border-b border-line flex justify-between items-center">
                <span>Keyboard Shortcuts</span>
                <span className="text-[10px] text-ink-faint">DAW Controls</span>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-ink-dim">Play / Pause</span>
                  <span className="font-num bg-surface-3 px-1.5 py-0.2 rounded text-ink">Space</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-dim">Record Studio (Input EQ)</span>
                  <span className="font-num bg-surface-3 px-1.5 py-0.2 rounded text-ink">R</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-dim">Select tool / Range tool</span>
                  <span className="font-num bg-surface-3 px-1.5 py-0.2 rounded text-ink">Z / X</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-dim">Single-track view (focus)</span>
                  <span className="font-num bg-surface-3 px-1.5 py-0.2 rounded text-ink">F</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-dim">Split Clip at Playhead</span>
                  <span className="font-num bg-surface-3 px-1.5 py-0.2 rounded text-ink">S</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-dim">Delete Selected</span>
                  <span className="font-num bg-surface-3 px-1.5 py-0.2 rounded text-ink">Del / Backspace</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-dim">Undo / Redo</span>
                  <span className="font-num bg-surface-3 px-1.5 py-0.2 rounded text-ink">Ctrl+Z / Ctrl+Y</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-dim">Select All</span>
                  <span className="font-num bg-surface-3 px-1.5 py-0.2 rounded text-ink">Ctrl+A</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-dim">Move Clip Track</span>
                  <span className="font-num bg-surface-3 px-1.5 py-0.2 rounded text-ink">Arrow Up / Down</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-dim">Zoom In / Out</span>
                  <span className="font-num bg-surface-3 px-1.5 py-0.2 rounded text-ink">Ctrl + Wheel</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-dim">Marker: add / jump</span>
                  <span className="font-num bg-surface-3 px-1.5 py-0.2 rounded text-ink">M / [ ]</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-dim">Quick Actions</span>
                  <span className="font-num bg-surface-3 px-1.5 py-0.2 rounded text-ink">Q / Double Click Clip</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </footer>
  );
};
