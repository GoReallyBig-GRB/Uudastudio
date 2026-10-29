/**
 * X-PRO AUDIO - Bottom Status Bar & Transport Footer
 * Displays: Engine Status, Tracks/Clips stats, Master Audio Level Meter, Dual Timer (Position/Total),
 * Zoom Controls, Autosave Badge, and Shortcut Hints.
 */

import React, { useRef, useState, useEffect } from 'react';
import { Database, HelpCircle, Activity, Radio, ZoomIn, ZoomOut, Maximize2, Clock } from 'lucide-react';
import { formatTimecode } from '../utils/formatters';
import { audioEngine } from '../audio/engine';

interface StatusBarProps {
  sampleRate: number;
  trackCount: number;
  clipCount: number;
  selectedClipCount: number;
  playheadSeconds: number;
  totalDurationSeconds: number;
  isPlaying: boolean;
  pixelsPerSecond: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
  isAutosaving: boolean;
  lastSavedAt: Date | null;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  sampleRate,
  trackCount,
  clipCount,
  selectedClipCount,
  playheadSeconds,
  totalDurationSeconds,
  isPlaying,
  pixelsPerSecond,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  isAutosaving,
  lastSavedAt,
}) => {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const masterMeterRef = useRef<HTMLCanvasElement | null>(null);

  // Master Meter animation loop
  useEffect(() => {
    let animId: number;
    let peakHold = 0;

    const renderMasterMeter = () => {
      const canvas = masterMeterRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);

          ctx.fillStyle = '#0a0a0f';
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
            grad.addColorStop(0, '#00e5a3');
            grad.addColorStop(0.7, '#ffd000');
            grad.addColorStop(0.9, '#ff3b30');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, rmsWidth, h);

            const peakX = Math.min(w - 2, peakHold * w);
            ctx.fillStyle = peakHold >= 0.99 ? '#ff2a2a' : '#ffffff';
            ctx.fillRect(peakX, 0, 2, h);
          } else {
            peakHold = 0;
            // Draw faint idle baseline
            ctx.fillStyle = '#1c1c24';
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

        <div className="hidden sm:flex items-center gap-1 font-num text-[10px] text-zinc-500">
          <Activity className="w-3 h-3 text-ink-faint" />
          <span>{(sampleRate / 1000).toFixed(1)} kHz</span>
          <span className="text-zinc-700">/</span>
          <span>32-bit</span>
        </div>

        <div className="h-3 w-px bg-line" />

        <div className="text-[11px] text-zinc-400">
          <span>Tracks: </span>
          <strong className="text-zinc-200 font-num">{trackCount}</strong>
          <span className="mx-1 text-zinc-700">·</span>
          <span>Clips: </span>
          <strong className="text-zinc-200 font-num">{clipCount}</strong>
          {selectedClipCount > 0 && (
            <>
              <span className="mx-1 text-zinc-700">·</span>
              <span className="text-accent font-semibold">
                {selectedClipCount} selected
              </span>
            </>
          )}
        </div>
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
            <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">POS</span>
            <span className="text-accent font-bold tracking-wider text-xs">
              {formatTimecode(playheadSeconds)}
            </span>
            <span className="text-zinc-600 font-normal">/</span>
            <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">TOTAL</span>
            <span className="text-zinc-300 font-semibold tracking-wider text-xs">
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
            <span className="text-zinc-400 font-bold tracking-wider">MASTER</span>
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
          <span className="text-[10px] font-num text-zinc-400 px-1 min-w-[42px] text-center select-none">
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
        <div className="hidden md:flex items-center gap-1.5 text-zinc-400">
          <Database className="w-3 h-3 text-ink-faint" />
          {isAutosaving ? (
            <span className="text-warn animate-pulse text-[10px] font-medium">Saving...</span>
          ) : lastSavedAt ? (
            <span className="text-zinc-400 font-num text-[10px]">
              Saved {lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          ) : (
            <span className="text-zinc-500 font-num text-[10px]">Autosave ready</span>
          )}
        </div>

        <div className="h-3 w-px bg-line" />

        {/* Shortcuts toggle */}
        <div className="relative">
          <button
            onClick={() => setShowShortcuts(!showShortcuts)}
            className="flex items-center gap-1 text-ink-dim hover:text-ink hover:bg-white/5 px-2.5 py-1 rounded-full transition-colors cursor-pointer"
          >
            <HelpCircle className="w-3 h-3 text-zinc-400" />
            <span>Shortcuts</span>
          </button>

          {showShortcuts && (
            <div
              onClick={() => setShowShortcuts(false)}
              className="absolute right-0 bottom-full mb-2 w-64 bg-surface-2 border border-line-strong rounded-card shadow-float p-3 z-50 text-[11px] text-zinc-300"
            >
              <div className="font-semibold text-zinc-100 pb-1.5 mb-2 border-b border-zinc-800 flex justify-between items-center">
                <span>Keyboard Shortcuts</span>
                <span className="text-[10px] text-zinc-500">DAW Controls</span>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Play / Pause</span>
                  <span className="font-num bg-surface-3 px-1.5 py-0.2 rounded text-zinc-200">Space</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Record Studio (Input EQ)</span>
                  <span className="font-num bg-surface-3 px-1.5 py-0.2 rounded text-ink">R</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Split Clip at Playhead</span>
                  <span className="font-num bg-surface-3 px-1.5 py-0.2 rounded text-zinc-200">S</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Delete Selected</span>
                  <span className="font-num bg-surface-3 px-1.5 py-0.2 rounded text-zinc-200">Del / Backspace</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Undo / Redo</span>
                  <span className="font-num bg-surface-3 px-1.5 py-0.2 rounded text-zinc-200">Ctrl+Z / Ctrl+Y</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Select All</span>
                  <span className="font-num bg-surface-3 px-1.5 py-0.2 rounded text-zinc-200">Ctrl+A</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Move Clip Track</span>
                  <span className="font-num bg-surface-3 px-1.5 py-0.2 rounded text-zinc-200">Arrow Up / Down</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Zoom In / Out</span>
                  <span className="font-num bg-surface-3 px-1.5 py-0.2 rounded text-zinc-200">Ctrl + Wheel</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Quick Actions</span>
                  <span className="font-num bg-surface-3 px-1.5 py-0.2 rounded text-zinc-200">Double Click Clip</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </footer>
  );
};
