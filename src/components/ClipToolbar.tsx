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
  Trash2,
} from 'lucide-react';
import { Clip } from '../types';
import { formatVolumeDb } from '../utils/formatters';
import { DspModalType } from './DspModals';
import { Capsule, CapsuleButton } from './ui';
import type { TimelineTool } from './rangeDelete';

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
  /** Pointer tool: Select edits clips, Range highlights a span of a track. */
  tool: TimelineTool;
  onToolChange: (tool: TimelineTool) => void;
  /** Length of the highlighted range in seconds, or null when there is none. */
  rangeSeconds: number | null;
  onDeleteRange: () => void;
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
  tool,
  onToolChange,
  rangeSeconds,
  onDeleteRange,
  isControllerCollapsed = false,
  onToggleController,
  isTimelineCollapsed = false,
  onToggleTimelineCollapsed,
}) => {
  const hasClip = !!clip;

  return (
    <div className="h-12 bg-surface-0 border-b border-line px-4 flex items-center justify-between text-xs text-ink-dim gap-3 shrink-0 select-none z-30">
      {/* Left: Target Clip Tag / Selection Status */}
      <div className="flex items-center gap-2 min-w-0 shrink-0">
        {hasClip ? (
          <div className="flex items-center gap-1.5 px-2.5 h-7 rounded-full bg-accent-soft border border-accent/30 text-accent max-w-[220px]">
            <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0 animate-pulse" />
            <span className="font-semibold truncate text-[11px] text-ink">
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

      <div className="h-4 w-px bg-line shrink-0" />

      {/* Center: Primary Editing + DSP Cluster (Side-by-Side as required) */}
      <div className="flex items-center gap-1 overflow-x-auto py-0.5 scrollbar-none flex-1">
        {/* Pointer tool: Select edits clips; Range highlights a span of one track so it can be deleted */}
        <Capsule label="Timeline tool">
          <CapsuleButton title="Select tool: move and edit clips" active={tool === 'select'} onClick={() => onToolChange('select')}>
            Select
          </CapsuleButton>
          <CapsuleButton title="Range tool: highlight part of a track (or hold Alt while dragging)" active={tool === 'range'} onClick={() => onToolChange('range')}>
            Range
          </CapsuleButton>
        </Capsule>
        {rangeSeconds !== null && (
          <button
            onClick={onDeleteRange}
            title="Delete the highlighted range from this track and close the gap (Delete)"
            className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-danger/40 bg-danger/10 px-3.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Delete {rangeSeconds.toFixed(2)}s</span>
          </button>
        )}

        {/* GROUP 1: Split, Cut, Copy, Paste */}
        <Capsule label="Clip edit">
          <CapsuleButton
            title={hasClip ? 'Split clip at playhead (S)' : 'Select a clip to split'}
            disabled={!hasClip}
            onClick={() => hasClip && onSplit(clip.id)}
            icon={<Scissors className="h-3.5 w-3.5" />}
          >
            Split
          </CapsuleButton>
          <CapsuleButton
            title={hasClip ? 'Cut clip (Ctrl+X)' : 'Select a clip to cut'}
            disabled={!hasClip}
            onClick={() => hasClip && onCut(clip.id)}
            icon={<ScissorsLineDashed className="h-3.5 w-3.5" />}
          >
            Cut
          </CapsuleButton>
          <CapsuleButton
            title={hasClip ? 'Copy clip (Ctrl+C)' : 'Select a clip to copy'}
            disabled={!hasClip}
            onClick={() => hasClip && onCopy(clip.id)}
            icon={<Copy className="h-3.5 w-3.5" />}
          >
            Copy
          </CapsuleButton>
          <CapsuleButton
            title={canPaste ? 'Paste clip at playhead onto active track (Ctrl+V)' : 'Clipboard is empty'}
            disabled={!canPaste}
            onClick={onPaste}
            icon={<ClipboardPaste className="h-3.5 w-3.5" />}
          >
            Paste
          </CapsuleButton>
        </Capsule>

        {/* GROUP 2: DSP processing, then the effects rack */}
        <Capsule label="Processing">
          <CapsuleButton
            title={hasClip ? 'Amplify gain in dB with clipping warning' : 'Select a clip to amplify'}
            disabled={!hasClip}
            onClick={() => hasClip && onOpenDsp('amplify')}
            icon={<Sliders className="h-3.5 w-3.5" />}
          >
            Amplify
          </CapsuleButton>
          <CapsuleButton
            title={hasClip ? 'Dynamics Compressor with threshold, ratio, attack, release' : 'Select a clip to compress'}
            disabled={!hasClip}
            onClick={() => hasClip && onOpenDsp('compress')}
            icon={<Wand2 className="h-3.5 w-3.5" />}
          >
            Compress
          </CapsuleButton>
          <CapsuleButton
            title={hasClip ? 'Noise reduction with 24dB/oct rumble cut & spectral gating' : 'Select a clip to denoise'}
            disabled={!hasClip}
            onClick={() => hasClip && onOpenDsp('denoise')}
            icon={<Sparkles className="h-3.5 w-3.5" />}
          >
            Denoise
          </CapsuleButton>
          <CapsuleButton
            title={hasClip ? 'Change pitch without changing duration (-12 to +12 semitones)' : 'Select a clip to change pitch'}
            disabled={!hasClip}
            onClick={() => hasClip && onOpenDsp('pitch')}
            icon={<Music className="h-3.5 w-3.5" />}
          >
            Pitch
          </CapsuleButton>
          <CapsuleButton
            title={hasClip ? 'Change tempo/speed without changing pitch (WSOLA time-stretch)' : 'Select a clip to change speed'}
            disabled={!hasClip}
            onClick={() => hasClip && onOpenDsp('speed')}
            icon={<Gauge className="h-3.5 w-3.5" />}
          >
            Speed
          </CapsuleButton>
        </Capsule>
        {onOpenEffect && (
          <Capsule label="Effects rack">
            <CapsuleButton
              title="Open Audio Effects Rack (Delay, EQ, Chorus, Flanger, Phaser, Reverb)"
              onClick={() => onOpenEffect('reverb')}
              icon={<Sparkles className="h-3.5 w-3.5" />}
            >
              Effects Rack
            </CapsuleButton>
          </Capsule>
        )}

        <div className="h-4 w-px bg-line mx-1 shrink-0" />

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
