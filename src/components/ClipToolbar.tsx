/**
 * X-PRO AUDIO - Central Editing & DSP Toolbar
 * Permanently docked directly above the timeline in direct relation to the editing panel.
 * Groups [Split, Cut, Copy, Paste] directly next to [Amplify, Compress, Denoise, Pitch, Speed],
 * followed by Mute, Move, Volume, and Fades.
 * Provides controls for collapsing the timeline track controller.
 */

import React from 'react';
import {
  Scissors,
  ScissorsLineDashed,
  Copy,
  ClipboardPaste,
  Sliders,
  Wand2,
  Sparkles,
  Music,
  Gauge,
  Volume2,
  VolumeX,
  ArrowUp,
  ArrowDown,
  X,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Clip } from '../types';
import { formatVolumeDb } from '../utils/formatters';
import { DspModalType } from './DspModals';

interface ClipToolbarProps {
  clip: Clip | null;
  canPaste: boolean;
  onSplit: (clipId: string) => void;
  onCopy: (clipId: string) => void;
  onCut: (clipId: string) => void;
  onPaste: () => void;
  onDelete: (clipId: string) => void;
  onToggleMute: (clipId: string) => void;
  onMoveTrack: (clipId: string, dir: 'up' | 'down') => void;
  onUpdateClip: (clipId: string, updates: Partial<Clip>) => void;
  onOpenDsp: (type: DspModalType) => void;
  onOpenEffect?: (type: import('../types').EffectType) => void;
  onDeselect: () => void;
  isControllerCollapsed?: boolean;
  onToggleController?: () => void;
  isTimelineCollapsed?: boolean;
  onToggleTimelineCollapsed?: () => void;
}

export const ClipToolbar: React.FC<ClipToolbarProps> = ({
  clip,
  canPaste,
  onSplit,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onToggleMute,
  onMoveTrack,
  onUpdateClip,
  onOpenDsp,
  onOpenEffect,
  onDeselect,
  isControllerCollapsed = false,
  onToggleController,
  isTimelineCollapsed = false,
  onToggleTimelineCollapsed,
}) => {
  const hasClip = !!clip;

  return (
    <div className="h-10 bg-[#0e0e14] border-b border-zinc-800 px-3 flex items-center justify-between text-xs text-zinc-300 gap-2 shrink-0 select-none z-30 shadow-xs">
      {/* Left: Target Clip Tag / Selection Status */}
      <div className="flex items-center gap-2 min-w-0 shrink-0">
        {hasClip ? (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-cyan-950/40 border border-cyan-800/60 text-cyan-300 max-w-[200px]">
            <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0 animate-pulse" />
            <span className="font-semibold truncate text-[11px] text-zinc-100">
              {clip.name}
            </span>
            <span className="text-[10px] mono-nums text-zinc-400 shrink-0">
              {clip.durationSeconds.toFixed(2)}s
            </span>
            <button
              onClick={onDeselect}
              title="Deselect clip"
              className="text-zinc-400 hover:text-white ml-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-zinc-500 text-[11px] font-medium">
            <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-600" />
            <span className="hidden sm:inline">Editing Panel:</span>
            <span className="text-zinc-500 italic text-[10px]">Select a clip to edit</span>
          </div>
        )}
      </div>

      <div className="h-4 w-px bg-zinc-800 shrink-0" />

      {/* Center: Primary Editing + DSP Cluster (Side-by-Side as required) */}
      <div className="flex items-center gap-1 overflow-x-auto py-0.5 scrollbar-none flex-1">
        {/* GROUP 1: Split, Cut, Copy, Paste */}
        <div className="flex items-center gap-0.5 bg-[#14141c] p-0.5 rounded-md border border-zinc-800">
          {/* Split at Playhead */}
          <button
            disabled={!hasClip}
            onClick={() => hasClip && onSplit(clip.id)}
            title={hasClip ? "Split clip at playhead (S)" : "Select a clip to split"}
            className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-800/80 hover:bg-cyan-500/20 hover:text-cyan-300 disabled:opacity-35 disabled:pointer-events-none text-[11px] font-semibold text-zinc-200 transition-colors shrink-0 cursor-pointer"
          >
            <Scissors className="w-3 h-3 text-cyan-400" />
            <span>Split</span>
          </button>

          {/* Cut */}
          <button
            disabled={!hasClip}
            onClick={() => hasClip && onCut(clip.id)}
            title={hasClip ? "Cut clip (Ctrl+X)" : "Select a clip to cut"}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-zinc-700/70 disabled:opacity-35 disabled:pointer-events-none text-[11px] text-zinc-300 hover:text-white transition-colors shrink-0 cursor-pointer"
          >
            <ScissorsLineDashed className="w-3 h-3 text-zinc-400" />
            <span>Cut</span>
          </button>

          {/* Copy */}
          <button
            disabled={!hasClip}
            onClick={() => hasClip && onCopy(clip.id)}
            title={hasClip ? "Copy clip (Ctrl+C)" : "Select a clip to copy"}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-zinc-700/70 disabled:opacity-35 disabled:pointer-events-none text-[11px] text-zinc-300 hover:text-white transition-colors shrink-0 cursor-pointer"
          >
            <Copy className="w-3 h-3 text-zinc-400" />
            <span>Copy</span>
          </button>

          {/* Paste */}
          <button
            disabled={!canPaste}
            onClick={onPaste}
            title={canPaste ? "Paste clip at playhead onto active track (Ctrl+V)" : "Clipboard is empty"}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-cyan-500/20 hover:text-cyan-300 disabled:opacity-30 disabled:pointer-events-none text-[11px] font-semibold text-cyan-400 transition-colors shrink-0 cursor-pointer"
          >
            <ClipboardPaste className="w-3 h-3 text-cyan-400" />
            <span>Paste</span>
          </button>
        </div>

        {/* GROUP 2: DSP Processing Actions (Directly next to Split, Cut, Copy, Paste) */}
        <div className="flex items-center gap-0.5 bg-[#14141c] p-0.5 rounded-md border border-zinc-800">
          {/* Amplify */}
          <button
            disabled={!hasClip}
            onClick={() => hasClip && onOpenDsp('amplify')}
            title={hasClip ? "Amplify gain in dB with clipping warning" : "Select a clip to amplify"}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-cyan-500/20 hover:text-cyan-300 disabled:opacity-35 disabled:pointer-events-none text-[11px] text-zinc-300 transition-colors shrink-0 cursor-pointer"
          >
            <Sliders className="w-3 h-3 text-cyan-400" />
            <span>Amplify</span>
          </button>

          {/* Compress */}
          <button
            disabled={!hasClip}
            onClick={() => hasClip && onOpenDsp('compress')}
            title={hasClip ? "Dynamics Compressor with threshold, ratio, attack, release" : "Select a clip to compress"}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-cyan-500/20 hover:text-cyan-300 disabled:opacity-35 disabled:pointer-events-none text-[11px] text-zinc-300 transition-colors shrink-0 cursor-pointer"
          >
            <Wand2 className="w-3 h-3 text-cyan-400" />
            <span>Compress</span>
          </button>

          {/* Denoise */}
          <button
            disabled={!hasClip}
            onClick={() => hasClip && onOpenDsp('denoise')}
            title={hasClip ? "Noise reduction with 24dB/oct rumble cut & spectral gating" : "Select a clip to denoise"}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-amber-500/20 hover:text-amber-300 disabled:opacity-35 disabled:pointer-events-none text-[11px] text-zinc-300 transition-colors shrink-0 cursor-pointer"
          >
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>Denoise</span>
          </button>

          {/* Pitch */}
          <button
            disabled={!hasClip}
            onClick={() => hasClip && onOpenDsp('pitch')}
            title={hasClip ? "Change pitch without changing duration (-12 to +12 semitones)" : "Select a clip to change pitch"}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-cyan-500/20 hover:text-cyan-300 disabled:opacity-35 disabled:pointer-events-none text-[11px] text-zinc-300 transition-colors shrink-0 cursor-pointer"
          >
            <Music className="w-3 h-3 text-indigo-400" />
            <span>Pitch</span>
          </button>

          {/* Speed */}
          <button
            disabled={!hasClip}
            onClick={() => hasClip && onOpenDsp('speed')}
            title={hasClip ? "Change tempo/speed without changing pitch (WSOLA time-stretch)" : "Select a clip to change speed"}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-cyan-500/20 hover:text-cyan-300 disabled:opacity-35 disabled:pointer-events-none text-[11px] text-zinc-300 transition-colors shrink-0 cursor-pointer"
          >
            <Gauge className="w-3 h-3 text-emerald-400" />
            <span>Speed</span>
          </button>

          {/* Audio Effects Rack */}
          {onOpenEffect && (
            <button
              onClick={() => onOpenEffect('reverb')}
              title="Open Audio Effects Rack (Delay, EQ, Chorus, Flanger, Phaser, Reverb)"
              className="flex items-center gap-1 px-2 py-1 rounded bg-cyan-950/40 hover:bg-cyan-900/50 text-cyan-300 border border-cyan-800/60 hover:border-cyan-500/60 text-[11px] font-semibold transition-all shrink-0 cursor-pointer shadow-xs"
            >
              <Sparkles className="w-3 h-3 text-cyan-400" />
              <span>Effects Rack</span>
            </button>
          )}
        </div>

        <div className="h-3.5 w-px bg-zinc-800 mx-1 shrink-0" />

        {/* GROUP 3: Clip Properties (Mute, Move Track, Volume, Fades) */}
        {hasClip ? (
          <>
            {/* Mute Clip */}
            <button
              onClick={() => onToggleMute(clip.id)}
              title="Mute / Unmute clip"
              className={`flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium transition-colors shrink-0 cursor-pointer ${
                clip.muted
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/50'
                  : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700 border-zinc-700/60'
              }`}
            >
              {clip.muted ? <VolumeX className="w-3 h-3 text-rose-400" /> : <Volume2 className="w-3 h-3" />}
              <span>{clip.muted ? 'Muted' : 'Mute'}</span>
            </button>

            {/* Move Up / Down */}
            <div className="flex items-center gap-0.5 bg-zinc-900 border border-zinc-800 rounded p-0.5">
              <button
                onClick={() => onMoveTrack(clip.id, 'up')}
                title="Move clip to track above (Arrow Up)"
                className="p-1 rounded hover:bg-zinc-700 text-zinc-300 transition-colors shrink-0 cursor-pointer"
              >
                <ArrowUp className="w-3 h-3" />
              </button>
              <button
                onClick={() => onMoveTrack(clip.id, 'down')}
                title="Move clip to track below (Arrow Down)"
                className="p-1 rounded hover:bg-zinc-700 text-zinc-300 transition-colors shrink-0 cursor-pointer"
              >
                <ArrowDown className="w-3 h-3" />
              </button>
            </div>

            {/* Inline Volume controls */}
            <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[11px] shrink-0">
              <Volume2 className="w-3 h-3 text-zinc-400" />
              <span className="mono-nums font-semibold text-zinc-200 text-[10px]">
                {formatVolumeDb(clip.gain)}
              </span>
              <button
                onClick={() => onUpdateClip(clip.id, { gain: Math.max(0, clip.gain * 0.891) })}
                title="Volume -1 dB"
                className="px-1 text-[10px] bg-zinc-800 hover:bg-zinc-700 rounded cursor-pointer"
              >
                -1dB
              </button>
              <button
                onClick={() => onUpdateClip(clip.id, { gain: Math.min(2.5, clip.gain * 1.122) })}
                title="Volume +1 dB"
                className="px-1 text-[10px] bg-zinc-800 hover:bg-zinc-700 rounded cursor-pointer"
              >
                +1dB
              </button>
            </div>

            {/* Fades */}
            <div className="flex items-center gap-1 text-[10px] text-zinc-400 px-1.5 bg-zinc-900/60 rounded border border-zinc-800/80 shrink-0 py-0.5">
              <span>Fade In:</span>
              <input
                type="number"
                min="0"
                max={clip.durationSeconds / 2}
                step="0.1"
                value={clip.fadeInSeconds.toFixed(1)}
                onChange={(e) => onUpdateClip(clip.id, { fadeInSeconds: Math.max(0, parseFloat(e.target.value) || 0) })}
                className="w-10 bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-center text-zinc-200"
              />
              <span>Out:</span>
              <input
                type="number"
                min="0"
                max={clip.durationSeconds / 2}
                step="0.1"
                value={clip.fadeOutSeconds.toFixed(1)}
                onChange={(e) => onUpdateClip(clip.id, { fadeOutSeconds: Math.max(0, parseFloat(e.target.value) || 0) })}
                className="w-10 bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-center text-zinc-200"
              />
              <button
                onClick={() => onUpdateClip(clip.id, { fadeShape: clip.fadeShape === 'linear' ? 'exponential' : 'linear' })}
                title="Toggle Fade Curve Shape"
                className="px-1.5 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded font-mono text-[9px] uppercase text-cyan-300 cursor-pointer"
              >
                {clip.fadeShape}
              </button>
            </div>
          </>
        ) : null}
      </div>

      {/* Right: Timeline View Mode Toggle */}
      <div className="flex items-center gap-1.5 shrink-0 pl-1 border-l border-zinc-800">
        {onToggleTimelineCollapsed && (
          <button
            onClick={onToggleTimelineCollapsed}
            title={
              isTimelineCollapsed
                ? "Show Timeline (Waveform view)"
                : "Collapse Timeline to show only Editing & Mixing Panel"
            }
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold border transition-all cursor-pointer ${
              isTimelineCollapsed
                ? 'bg-emerald-500/25 text-emerald-300 border-emerald-500/60 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                : 'bg-zinc-800 text-zinc-300 hover:text-white border-zinc-700 hover:bg-zinc-700'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />
            <span>{isTimelineCollapsed ? 'Show Timeline' : 'Editing & Mixing Panel Only'}</span>
          </button>
        )}
      </div>
    </div>
  );
};
