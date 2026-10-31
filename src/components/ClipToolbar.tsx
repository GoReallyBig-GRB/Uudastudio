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
  ChevronDown,
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
  Maximize2,
} from 'lucide-react';
import { Clip } from '../types';
import { formatVolumeDb } from '../utils/formatters';
import { DspModalType } from './DspModals';
import { Capsule, CapsuleButton, HoverTitle } from './ui';
import type { TimelineTool } from './rangeDelete';

interface ClipToolbarProps {
  clip: Clip | null;
  /** How many clips are selected; Cut and Copy work on several at once, the other clip actions need exactly one. */
  selectedCount?: number;
  canPaste: boolean;
  onSplit: (clipId: string) => void;
  /** Silence the selected clips, or the highlighted range */
  onSilence: () => void;
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
  /** Single-track view: only the chosen track is shown, large */
  focusActive: boolean;
  onToggleFocus: () => void;
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


/** One "Fade" button for a clip: a menu with fade in, fade out (seconds) and the curve shape (exponential is the default). */
const FadeMenu: React.FC<{ clip: Clip; onUpdateClip: (clipId: string, updates: Partial<Clip>) => void }> = ({ clip, onUpdateClip }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const maxFade = Math.max(0, Math.min(10, clip.durationSeconds / 2));

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('[data-fade-menu]') || btnRef.current?.contains(t))) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.min(window.innerWidth - 264, Math.max(8, r.left)), top: r.bottom + 6 });
    setOpen((v) => !v);
  };
  const shape = clip.fadeShape === 'linear' ? 'linear' : 'exponential';
  const row = (label: string, key: 'fadeInSeconds' | 'fadeOutSeconds') => (
    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_3rem] items-center gap-2">
      <span className="text-[10px] text-ink-dim">{label}</span>
      <input
        type="range" min="0" max={maxFade} step="0.05" value={Math.min(clip[key], maxFade)}
        aria-label={label}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          onUpdateClip(clip.id, key === 'fadeInSeconds' ? { fadeInSeconds: v } : { fadeOutSeconds: v });
        }}
        className="w-full h-4 accent-accent cursor-pointer"
      />
      <span className="text-[10px] font-num text-ink text-right">{clip[key].toFixed(2)}s</span>
    </div>
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        title="Fade in, fade out and curve shape"
        className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface-1 px-3.5 text-xs font-medium text-ink-dim transition-colors hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span>Fade</span>
        <span className="font-num text-[10px] uppercase text-accent">{shape === 'linear' ? 'Lin' : 'Exp'}</span>
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>
      {open && (
        <div
          data-fade-menu
          style={{ left: pos.left, top: pos.top }}
          className="fixed z-50 w-64 space-y-2.5 rounded-card border border-line-strong bg-surface-2 p-3 shadow-float uuda-pop-in"
        >
          {row('Fade in', 'fadeInSeconds')}
          {row('Fade out', 'fadeOutSeconds')}
          <div className="border-t border-line pt-2">
            <div className="mb-1 text-[10px] text-ink-dim">Curve</div>
            <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="Fade curve">
              {([['exponential', 'Exponential'], ['linear', 'Linear']] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={shape === value}
                  onClick={() => onUpdateClip(clip.id, { fadeShape: value })}
                  className={`rounded-control border px-2 py-1.5 text-[11px] font-medium cursor-pointer transition-colors ${
                    shape === value ? 'border-accent/60 bg-accent-soft text-accent' : 'border-line bg-surface-3/60 text-ink-dim hover:text-ink hover:bg-surface-3'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const ClipToolbar: React.FC<ClipToolbarProps> = ({
  clip,
  selectedCount = clip ? 1 : 0,
  canPaste,
  onSplit,
  onSilence,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onToggleMute,
  onMoveTrack,
  onUpdateClip,
  onOpenDsp,
  onOpenEffect,
  tool,
  onToolChange,
  focusActive,
  onToggleFocus,
  rangeSeconds,
  onDeleteRange,
  projectName,
  onRenameProject,
  isControllerCollapsed = false,
  onToggleController,
  isTimelineCollapsed = false,
  onToggleTimelineCollapsed,
}) => {
  const hasClip = !!clip;
  const hasSelection = selectedCount > 0;
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
          <CapsuleButton title="Select tool: move and edit clips (Z)" active={tool === 'select'} onClick={() => onToolChange('select')}>
            Select
          </CapsuleButton>
          <CapsuleButton title="Range tool: highlight part of a track (X, or hold Alt while dragging)" active={tool === 'range'} onClick={() => onToolChange('range')}>
            Range
          </CapsuleButton>
        </Capsule>
        <button
          onClick={onToggleFocus}
          aria-pressed={focusActive}
          title={focusActive ? 'Back to all tracks (F)' : 'Single-track view: work on this track alone, large (F)'}
          className={`flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
            focusActive ? 'border-accent/50 bg-accent-soft text-accent' : 'border-line bg-surface-1 text-ink-dim hover:bg-surface-3 hover:text-ink'
          }`}
        >
          <Maximize2 className="h-3.5 w-3.5" />
          <span>{focusActive ? 'All tracks' : 'Focus'}</span>
        </button>
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
            title={hasRange ? 'Split the highlighted range out at both edges (so it can be silenced, raised, lowered or processed)' : hasClip ? 'Split clip at playhead (S)' : 'Select a clip to split'}
            disabled={!hasClip && !hasRange}
            onClick={() => (hasRange || hasClip) && onSplit(clip?.id ?? '')}
            icon={<Scissors className="h-3.5 w-3.5" />}
          >
            Split
          </CapsuleButton>
          <CapsuleButton
            title={hasRange ? 'Cut the highlighted range and close the gap (Ctrl+X)' : hasSelection ? 'Cut the selected clips (Ctrl+X)' : 'Select a clip or highlight a range to cut'}
            disabled={!hasSelection && !hasRange}
            onClick={() => (hasRange || hasSelection) && onCut(clip?.id ?? '')}
            icon={<ScissorsLineDashed className="h-3.5 w-3.5" />}
          >
            Cut
          </CapsuleButton>
          <CapsuleButton
            title={hasRange ? 'Copy the highlighted range, across all its tracks (Ctrl+C)' : hasSelection ? 'Copy the selected clips (Ctrl+C)' : 'Select a clip or highlight a range to copy'}
            disabled={!hasSelection && !hasRange}
            onClick={() => (hasRange || hasSelection) && onCopy(clip?.id ?? '')}
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
          <CapsuleButton
            title={hasRange ? 'Silence the highlighted range (mutes just that part)' : hasSelection ? 'Silence the selected clips' : 'Select a clip or highlight a range to silence'}
            disabled={!hasSelection && !hasRange}
            onClick={onSilence}
            icon={<VolumeX className="h-3.5 w-3.5" />}
          >
            Silence
          </CapsuleButton>
        </Capsule>

        {/* GROUP 2: DSP processing, then the effects rack */}
        <Capsule label="Processing">
          <CapsuleButton
            title={hasClip || hasRange ? 'Amplify gain in dB with clipping warning' : 'Select a clip or highlight a range to amplify'}
            disabled={!hasClip && !hasRange}
            onClick={() => (hasClip || hasRange) && onOpenDsp('amplify')}
            icon={<Sliders className="h-3.5 w-3.5" />}
          >
            Amplify
          </CapsuleButton>
          <CapsuleButton
            title={hasClip || hasRange ? 'Dynamics Compressor with threshold, ratio, attack, release' : 'Select a clip or highlight a range to compress'}
            disabled={!hasClip && !hasRange}
            onClick={() => (hasClip || hasRange) && onOpenDsp('compress')}
            icon={<Wand2 className="h-3.5 w-3.5" />}
          >
            Compress
          </CapsuleButton>
          <CapsuleButton
            title={hasClip || hasRange ? 'Noise reduction with 24dB/oct rumble cut & spectral gating' : 'Select a clip or highlight a range to denoise'}
            disabled={!hasClip && !hasRange}
            onClick={() => (hasClip || hasRange) && onOpenDsp('denoise')}
            icon={<Sparkles className="h-3.5 w-3.5" />}
          >
            Denoise
          </CapsuleButton>
          <CapsuleButton
            title={hasClip || hasRange ? 'Change pitch without changing duration (-12 to +12 semitones)' : 'Select a clip or highlight a range to change pitch'}
            disabled={!hasClip && !hasRange}
            onClick={() => (hasClip || hasRange) && onOpenDsp('pitch')}
            icon={<Music className="h-3.5 w-3.5" />}
          >
            Pitch
          </CapsuleButton>
          <CapsuleButton
            title={hasClip || hasRange ? 'Change tempo/speed without changing pitch (WSOLA time-stretch)' : 'Select a clip or highlight a range to change speed'}
            disabled={!hasClip && !hasRange}
            onClick={() => (hasClip || hasRange) && onOpenDsp('speed')}
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

            {/* Fade: one button; its menu holds fade in, fade out and the curve */}
            <FadeMenu clip={clip} onUpdateClip={onUpdateClip} />
          </>
        ) : null}
      </div>

    </div>
  );
};
