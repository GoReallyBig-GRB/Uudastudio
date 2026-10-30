/**
 * X-PRO AUDIO - Central Editing & DSP Toolbar
 * Permanently docked directly above the timeline in direct relation to the editing panel.
 * Groups [Split, Cut, Copy, Paste] directly next to [Amplify, Compress, Denoise, Pitch, Speed],
 * followed by Mute, Move, Volume, and Fades.
 * Provides controls for collapsing the timeline track controller.
 */

import React, { useEffect, useState } from 'react';
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
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import { Clip } from '../types';
import { formatVolumeDb } from '../utils/formatters';
import { DspModalType } from './DspModals';
import { Capsule, CapsuleButton, HoverTitle } from './ui';
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
  /** Project title, shown at the left of this row; double-click it (or use File > Rename Project) to rename. */
  projectName: string;
  onRenameProject: (name: string) => void;
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

/** Longest project name shown at the left of the toolbar. */
const PROJECT_NAME_MAX_CHARS = 20;

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
  projectName,
  onRenameProject,
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
  const hasRange = rangeSeconds !== null;

  // Project title: double-click to rename. File > Rename Project in the header asks for the same via an event.
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState(projectName);
  useEffect(() => {
    if (!isEditingName) setDraftName(projectName);
  }, [projectName, isEditingName]);
  useEffect(() => {
    const startRename = () => setIsEditingName(true);
    window.addEventListener('uuda:rename-project', startRename);
    return () => window.removeEventListener('uuda:rename-project', startRename);
  }, []);
  const submitName = () => {
    setIsEditingName(false);
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== projectName) onRenameProject(trimmed);
    else setDraftName(projectName);
  };

  return (
    <div className="h-12 bg-surface-0 border-b border-line px-4 flex items-center justify-between text-xs text-ink-dim gap-3 shrink-0 select-none z-30">
      {/* Left: project title, then the selected clip (or a hint) */}
      <div className="flex items-center gap-3 min-w-0 shrink-0">
        {isEditingName ? (
          <input
            type="text"
            value={draftName}
            autoFocus
            aria-label="Project name"
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={submitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitName();
              if (e.key === 'Escape') {
                setDraftName(projectName);
                setIsEditingName(false);
              }
            }}
            className="h-8 w-44 rounded-control border border-accent/60 bg-surface-3 px-3 text-xs font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          />
        ) : (
          <span
            onDoubleClick={() => setIsEditingName(true)}
            title={projectName.length > PROJECT_NAME_MAX_CHARS ? undefined : 'Double-click to rename project'}
            className="cursor-text text-xs font-medium text-ink-dim transition-colors hover:text-ink"
          >
            <HoverTitle text={projectName} maxChars={PROJECT_NAME_MAX_CHARS} />
          </span>
        )}

      </div>

      <div className="h-4 w-px bg-line shrink-0" />

      {/* Center: Primary Editing + DSP Cluster (Side-by-Side as required) */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5 scrollbar-none">
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
            title={hasRange ? 'Cut the highlighted range and close the gap (Ctrl+X)' : hasClip ? 'Cut clip (Ctrl+X)' : 'Select a clip or highlight a range to cut'}
            disabled={!hasClip && !hasRange}
            onClick={() => (hasRange || hasClip) && onCut(clip?.id ?? '')}
            icon={<ScissorsLineDashed className="h-3.5 w-3.5" />}
          >
            Cut
          </CapsuleButton>
          <CapsuleButton
            title={hasRange ? 'Copy the highlighted range, across all its tracks (Ctrl+C)' : hasClip ? 'Copy clip (Ctrl+C)' : 'Select a clip or highlight a range to copy'}
            disabled={!hasClip && !hasRange}
            onClick={() => (hasRange || hasClip) && onCopy(clip?.id ?? '')}
            icon={<Copy className="h-3.5 w-3.5" />}
          >
            Copy
          </CapsuleButton>
          <CapsuleButton
            title={canPaste ? 'Paste at the playhead, onto the active track (Ctrl+V)' : 'Clipboard is empty'}
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

        <div className="h-4 w-px bg-line mx-1 shrink-0" />

        {/* GROUP 3: Clip Properties (Mute, Move Track, Volume, Fades) */}
        {hasClip ? (
          <>
            {/* Mute Clip */}
            <button
              onClick={() => onToggleMute(clip.id)}
              title="Mute / Unmute clip"
              className={`flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-colors ${
                clip.muted
                  ? 'border-danger/40 bg-danger/10 text-danger'
                  : 'border-line bg-surface-1 text-ink-dim hover:bg-surface-3 hover:text-ink'
              }`}
            >
              {clip.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              <span>{clip.muted ? 'Muted' : 'Mute'}</span>
            </button>

            {/* Move Up / Down */}
            <div className="flex items-center divide-x divide-line overflow-hidden rounded-full border border-line bg-surface-1">
              <button
                onClick={() => onMoveTrack(clip.id, 'up')}
                title="Move clip to track above (Arrow Up)"
                className="flex h-8 w-9 items-center justify-center text-ink-dim hover:bg-white/5 hover:text-ink transition-colors shrink-0 cursor-pointer"
              >
                <ArrowUp className="w-3 h-3" />
              </button>
              <button
                onClick={() => onMoveTrack(clip.id, 'down')}
                title="Move clip to track below (Arrow Down)"
                className="flex h-8 w-9 items-center justify-center text-ink-dim hover:bg-white/5 hover:text-ink transition-colors shrink-0 cursor-pointer"
              >
                <ArrowDown className="w-3 h-3" />
              </button>
            </div>

            {/* Inline Volume controls */}
            <div className="flex h-8 items-center gap-1.5 px-3 rounded-full bg-surface-1 border border-line text-[11px] shrink-0">
              <Volume2 className="w-3 h-3 text-zinc-400" />
              <span className="mono-nums font-semibold text-zinc-200 text-[10px]">
                {formatVolumeDb(clip.gain)}
              </span>
              <button
                onClick={() => onUpdateClip(clip.id, { gain: Math.max(0, clip.gain * 0.891) })}
                title="Volume -1 dB"
                className="px-1.5 py-0.5 text-[10px] bg-surface-3 hover:bg-white/10 rounded-full cursor-pointer"
              >
                -1dB
              </button>
              <button
                onClick={() => onUpdateClip(clip.id, { gain: Math.min(2.5, clip.gain * 1.122) })}
                title="Volume +1 dB"
                className="px-1.5 py-0.5 text-[10px] bg-surface-3 hover:bg-white/10 rounded-full cursor-pointer"
              >
                +1dB
              </button>
            </div>

            {/* Fades */}
            <div className="flex h-8 items-center gap-1.5 text-[10px] text-ink-dim px-3 bg-surface-1 rounded-full border border-line shrink-0">
              <span>Fade In:</span>
              <input
                type="number"
                min="0"
                max={clip.durationSeconds / 2}
                step="0.1"
                value={clip.fadeInSeconds.toFixed(1)}
                onChange={(e) => onUpdateClip(clip.id, { fadeInSeconds: Math.max(0, parseFloat(e.target.value) || 0) })}
                className="w-10 bg-surface-3 border border-line rounded-control px-1 py-0.5 text-center text-ink"
              />
              <span>Out:</span>
              <input
                type="number"
                min="0"
                max={clip.durationSeconds / 2}
                step="0.1"
                value={clip.fadeOutSeconds.toFixed(1)}
                onChange={(e) => onUpdateClip(clip.id, { fadeOutSeconds: Math.max(0, parseFloat(e.target.value) || 0) })}
                className="w-10 bg-surface-3 border border-line rounded-control px-1 py-0.5 text-center text-ink"
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

      {/* Right: pinned controls. They never scroll or shrink, so a long name can't push them out of view. */}
      <div className="flex shrink-0 items-center gap-2 border-l border-line pl-3">
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

        {onToggleTimelineCollapsed && (
          <button
            onClick={onToggleTimelineCollapsed}
            title={
              isTimelineCollapsed
                ? 'Show Timeline (Waveform view)'
                : 'Collapse Timeline to show only the Master Console'
            }
            className={`flex h-8 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
              isTimelineCollapsed
                ? 'border-accent/40 bg-accent-soft text-accent'
                : 'border-line bg-surface-1 text-ink-dim hover:bg-surface-3 hover:text-ink'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>{isTimelineCollapsed ? 'Show Timeline' : 'Master Console'}</span>
          </button>
        )}
      </div>
    </div>
  );
};
