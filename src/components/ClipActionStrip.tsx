/**
 * X-PRO AUDIO - Clip Quick Action Strip
 * Floats near the clip on double-click / double-tap, or opens with the Q key on the selected clip.
 * Supplies instant actions: Split at Playhead, Copy, Cut, Paste, Delete, Mute, Move Up, Move Down,
 * Fades, Volume (slider & +/- 1dB), Amplify, Compress, Denoise, Change Pitch, Change Speed.
 */

import React, { useEffect } from 'react';
import {
  Scissors,
  Trash2,
  Copy,
  ScissorsLineDashed,
  ClipboardPaste,
  ArrowUp,
  ArrowDown,
  Volume2,
  VolumeX,
  Sliders,
  Wand2,
  Sparkles,
  Music,
  Gauge,
  Download,
  Plug,
  X,
} from 'lucide-react';
import { Clip } from '../types';
import { formatVolumeDb } from '../utils/formatters';
import { DspModalType } from './DspModals';

interface ClipActionStripProps {
  clip: Clip;
  position: { x: number; y: number };
  canPaste: boolean;
  onClose: () => void;
  onSplit: (clipId: string) => void;
  onCopy: (clipId: string) => void;
  onCut: (clipId: string) => void;
  onPaste: () => void;
  onDelete: (clipId: string) => void;
  onToggleMute: (clipId: string) => void;
  onMoveTrack: (clipId: string, direction: 'up' | 'down') => void;
  onUpdateClip: (clipId: string, updates: Partial<Clip>) => void;
  onOpenDsp: (type: DspModalType) => void;
  onOpenExport?: () => void;
  onOpenPlugins?: () => void;
}

export const ClipActionStrip: React.FC<ClipActionStripProps> = ({
  clip,
  position,
  canPaste,
  onClose,
  onSplit,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onToggleMute,
  onMoveTrack,
  onUpdateClip,
  onOpenDsp,
  onOpenExport,
  onOpenPlugins,
}) => {
  // Listen for global dismiss events, Escape key, or clicks outside
  useEffect(() => {
    const handleClose = () => onClose();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest('.clip-action-strip-container')) {
        onClose();
      }
    };

    window.addEventListener('xpro:close-popups', handleClose);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('xpro:close-popups', handleClose);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [onClose]);

  // Clamp position reliably within viewport avoiding truncation
  const STRIP_WIDTH = 320;
  const STRIP_EST_HEIGHT = 460;
  const left = Math.min(window.innerWidth - STRIP_WIDTH - 16, Math.max(16, position.x));
  const top = Math.min(
    Math.max(56, window.innerHeight - STRIP_EST_HEIGHT - 16),
    Math.max(56, position.y - 100)
  );

  return (
    <div
      style={{ left: `${left}px`, top: `${top}px` }}
      onClick={(e) => e.stopPropagation()}
      className="clip-action-strip-container fixed z-40 bg-[#121218]/95 border border-cyan-500/60 rounded-xl shadow-[0_12px_36px_rgba(0,0,0,0.85),0_0_16px_rgba(0,240,255,0.2)] p-3 backdrop-blur-md text-zinc-200 text-xs w-80 max-h-[min(480px,calc(100vh-70px))] overflow-y-auto scrollbar-thin animate-in fade-in zoom-in-95 duration-150 select-none space-y-2.5"
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-1.5 border-b border-zinc-800">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="font-bold text-zinc-100 truncate text-xs">{clip.name}</span>
          {clip.muted && (
            <span className="text-[9px] px-1 bg-rose-500/20 text-rose-300 rounded font-semibold">
              MUTED
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-200 p-0.5 rounded transition-colors"
          title="Close action strip"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Primary Clip Actions Row 1 */}
      <div className="grid grid-cols-4 gap-1">
        <button
          onClick={() => {
            onSplit(clip.id);
            onClose();
          }}
          title="Split clip at playhead (S)"
          className="flex flex-col items-center justify-center p-1.5 rounded bg-zinc-800/70 hover:bg-cyan-500/20 hover:text-cyan-300 transition-colors gap-1 border border-zinc-700/50"
        >
          <Scissors className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[10px] font-medium">Split</span>
        </button>

        <button
          onClick={() => {
            onCopy(clip.id);
            onClose();
          }}
          title="Copy clip (Ctrl+C)"
          className="flex flex-col items-center justify-center p-1.5 rounded bg-zinc-800/70 hover:bg-zinc-700 transition-colors gap-1 border border-zinc-700/50"
        >
          <Copy className="w-3.5 h-3.5 text-zinc-300" />
          <span className="text-[10px] font-medium">Copy</span>
        </button>

        <button
          onClick={() => {
            onCut(clip.id);
            onClose();
          }}
          title="Cut clip (Ctrl+X)"
          className="flex flex-col items-center justify-center p-1.5 rounded bg-zinc-800/70 hover:bg-zinc-700 transition-colors gap-1 border border-zinc-700/50"
        >
          <ScissorsLineDashed className="w-3.5 h-3.5 text-zinc-300" />
          <span className="text-[10px] font-medium">Cut</span>
        </button>

        <button
          disabled={!canPaste}
          onClick={() => {
            onPaste();
            onClose();
          }}
          title="Paste at playhead on new top track (Ctrl+V)"
          className="flex flex-col items-center justify-center p-1.5 rounded bg-zinc-800/70 hover:bg-zinc-700 disabled:opacity-30 transition-colors gap-1 border border-zinc-700/50"
        >
          <ClipboardPaste className="w-3.5 h-3.5 text-zinc-300" />
          <span className="text-[10px] font-medium">Paste</span>
        </button>
      </div>

      {/* Row 2: Move Track & Mute */}
      <div className="grid grid-cols-3 gap-1">
        <button
          onClick={() => onMoveTrack(clip.id, 'up')}
          title="Move clip to track above"
          className="flex items-center justify-center gap-1 p-1.5 rounded bg-zinc-800/70 hover:bg-zinc-700 transition-colors border border-zinc-700/50 text-[10px]"
        >
          <ArrowUp className="w-3 h-3 text-zinc-300" />
          <span>Move Up</span>
        </button>

        <button
          onClick={() => onMoveTrack(clip.id, 'down')}
          title="Move clip to track below"
          className="flex items-center justify-center gap-1 p-1.5 rounded bg-zinc-800/70 hover:bg-zinc-700 transition-colors border border-zinc-700/50 text-[10px]"
        >
          <ArrowDown className="w-3 h-3 text-zinc-300" />
          <span>Move Down</span>
        </button>

        <button
          onClick={() => onToggleMute(clip.id)}
          title="Mute / Unmute clip"
          className={`flex items-center justify-center gap-1 p-1.5 rounded border text-[10px] font-medium transition-colors ${
            clip.muted
              ? 'bg-rose-500/20 text-rose-300 border-rose-500/50'
              : 'bg-zinc-800/70 text-zinc-300 hover:bg-zinc-700 border-zinc-700/50'
          }`}
        >
          {clip.muted ? <VolumeX className="w-3 h-3 text-rose-400" /> : <Volume2 className="w-3 h-3" />}
          <span>{clip.muted ? 'Unmute' : 'Mute'}</span>
        </button>
      </div>

      {/* DSP Tools Strip */}
      <div className="bg-[#0B0B0E] p-2 rounded-lg border border-zinc-800/70 space-y-1.5">
        <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
          <Sliders className="w-3 h-3 text-cyan-400" />
          <span>Processing Tools</span>
        </div>

        <div className="grid grid-cols-5 gap-1">
          <button
            onClick={() => {
              onOpenDsp('amplify');
              onClose();
            }}
            title="Amplify gain in dB with clipping warning"
            className="flex flex-col items-center justify-center p-1 rounded bg-zinc-800 hover:bg-cyan-500/20 hover:text-cyan-300 border border-zinc-700/60 text-[9px] transition-colors gap-0.5"
          >
            <Sliders className="w-3 h-3 text-cyan-400" />
            <span>Amplify</span>
          </button>

          <button
            onClick={() => {
              onOpenDsp('compress');
              onClose();
            }}
            title="Dynamics Compressor with threshold & ratio"
            className="flex flex-col items-center justify-center p-1 rounded bg-zinc-800 hover:bg-cyan-500/20 hover:text-cyan-300 border border-zinc-700/60 text-[9px] transition-colors gap-0.5"
          >
            <Wand2 className="w-3 h-3 text-cyan-400" />
            <span>Compress</span>
          </button>

          <button
            onClick={() => {
              onOpenDsp('denoise');
              onClose();
            }}
            title="Basic noise reduction (high-pass & spectral gate)"
            className="flex flex-col items-center justify-center p-1 rounded bg-zinc-800 hover:bg-amber-500/20 hover:text-amber-300 border border-zinc-700/60 text-[9px] transition-colors gap-0.5"
          >
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>Denoise</span>
          </button>

          <button
            onClick={() => {
              onOpenDsp('pitch');
              onClose();
            }}
            title="Change pitch without changing duration"
            className="flex flex-col items-center justify-center p-1 rounded bg-zinc-800 hover:bg-cyan-500/20 hover:text-cyan-300 border border-zinc-700/60 text-[9px] transition-colors gap-0.5"
          >
            <Music className="w-3 h-3 text-cyan-400" />
            <span>Pitch</span>
          </button>

          <button
            onClick={() => {
              onOpenDsp('speed');
              onClose();
            }}
            title="Change speed without changing pitch"
            className="flex flex-col items-center justify-center p-1 rounded bg-zinc-800 hover:bg-cyan-500/20 hover:text-cyan-300 border border-zinc-700/60 text-[9px] transition-colors gap-0.5"
          >
            <Gauge className="w-3 h-3 text-cyan-400" />
            <span>Speed</span>
          </button>
        </div>
      </div>

      {/* On-Clip Volume & Fades Controls */}
      <div className="space-y-1.5 bg-[#0B0B0E] p-2 rounded-lg border border-zinc-800/70 text-[11px]">
        {/* On-clip Volume slider and +/- 1dB buttons */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1 text-zinc-400 shrink-0">
            <Volume2 className="w-3 h-3 text-cyan-400" />
            <span>Gain</span>
          </div>
          <span className="mono-nums text-zinc-200 font-semibold text-[10px] shrink-0">
            {formatVolumeDb(clip.gain)}
          </span>
          <input
            type="range"
            min="0"
            max="2.0"
            step="0.05"
            value={clip.gain}
            onChange={(e) => onUpdateClip(clip.id, { gain: parseFloat(e.target.value) })}
            className="w-20 h-1 bg-zinc-800 rounded appearance-none cursor-pointer"
          />
          <button
            onClick={() => onUpdateClip(clip.id, { gain: Math.max(0, clip.gain * 0.891) })}
            title="Volume -1 dB"
            className="px-1 text-[9px] bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300 font-mono"
          >
            -1dB
          </button>
          <button
            onClick={() => onUpdateClip(clip.id, { gain: Math.min(2.5, clip.gain * 1.122) })}
            title="Volume +1 dB"
            className="px-1 text-[9px] bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300 font-mono"
          >
            +1dB
          </button>
        </div>

        {/* Fades */}
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-zinc-800/60">
          <div>
            <div className="flex justify-between text-zinc-400 text-[10px] mb-0.5">
              <span>Fade In</span>
              <span className="mono-nums text-zinc-300">{clip.fadeInSeconds.toFixed(2)}s</span>
            </div>
            <input
              type="range"
              min="0"
              max={Math.min(5, clip.durationSeconds / 2)}
              step="0.05"
              value={clip.fadeInSeconds}
              onChange={(e) => onUpdateClip(clip.id, { fadeInSeconds: parseFloat(e.target.value) })}
              className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer"
            />
          </div>
          <div>
            <div className="flex justify-between text-zinc-400 text-[10px] mb-0.5">
              <span>Fade Out</span>
              <span className="mono-nums text-zinc-300">{clip.fadeOutSeconds.toFixed(2)}s</span>
            </div>
            <input
              type="range"
              min="0"
              max={Math.min(5, clip.durationSeconds / 2)}
              step="0.05"
              value={clip.fadeOutSeconds}
              onChange={(e) => onUpdateClip(clip.id, { fadeOutSeconds: parseFloat(e.target.value) })}
              className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer"
            />
          </div>
        </div>

        {/* Fade Shape */}
        <div className="flex items-center justify-between pt-1 border-t border-zinc-800/60 text-[10px]">
          <span className="text-zinc-400">Curve Shape</span>
          <button
            onClick={() =>
              onUpdateClip(clip.id, {
                fadeShape: clip.fadeShape === 'linear' ? 'exponential' : 'linear',
              })
            }
            className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-cyan-300 font-mono capitalize border border-zinc-700"
          >
            {clip.fadeShape}
          </button>
        </div>
      </div>

      {/* Export and Plugins */}
      {(onOpenExport || onOpenPlugins) && (
        <div className="grid grid-cols-2 gap-1">
          {onOpenExport && (
            <button
              onClick={() => {
                onOpenExport();
                onClose();
              }}
              title="Export the project"
              className="flex items-center justify-center gap-1.5 p-1.5 rounded bg-zinc-800/70 hover:bg-zinc-700 transition-colors border border-zinc-700/50 text-[10px] font-medium"
            >
              <Download className="w-3 h-3 text-zinc-300" />
              <span>Export</span>
            </button>
          )}
          {onOpenPlugins && (
            <button
              onClick={() => {
                onOpenPlugins();
                onClose();
              }}
              title="Open the plugins rack"
              className="flex items-center justify-center gap-1.5 p-1.5 rounded bg-zinc-800/70 hover:bg-zinc-700 transition-colors border border-zinc-700/50 text-[10px] font-medium"
            >
              <Plug className="w-3 h-3 text-zinc-300" />
              <span>Plugins</span>
            </button>
          )}
        </div>
      )}

      {/* Delete button footer */}
      <div className="pt-1 border-t border-zinc-800 flex justify-between items-center text-[10px]">
        <span className="text-zinc-500 font-mono">
          Duration: {clip.durationSeconds.toFixed(3)}s
        </span>
        <button
          onClick={() => {
            onDelete(clip.id);
            onClose();
          }}
          className="flex items-center gap-1 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 px-2 py-1 rounded transition-colors"
        >
          <Trash2 className="w-3 h-3" />
          <span>Delete</span>
        </button>
      </div>
    </div>
  );
};
