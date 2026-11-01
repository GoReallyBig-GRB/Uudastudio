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
  Fingerprint,
  ArrowUp,
  ArrowDown,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Maximize2,
  Headphones,
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
  /** Learn the noise print from the highlighted range */
  onCaptureNoise?: () => void;
  hasNoisePrint?: boolean;
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
  /** In single-track view: hear only this track (true) or the full mix (false) */
  focusSolo: boolean;
  onToggleFocusSolo: () => void;
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
        className="flex h-[22px] shrink-0 cursor-pointer items-center gap-1 rounded-full border border-line bg-surface-1 px-2.5 text-[10px] font-semibold text-ink-dim transition-colors hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
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
  onCaptureNoise,
  hasNoisePrint,
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
  focusSolo,
  onToggleFocusSolo,
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

  const none = !hasClip && !hasRange;
  const idle = 'border-line bg-surface-1 text-ink-dim hover:bg-surface-3 hover:text-ink';
  const PILL = "flex h-[22px] shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2.5 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="bg-surface-0 border-b border-line px-4 py-1 flex flex-col gap-1 text-[10px] text-ink-dim shrink-0 select-none z-30">
      {/* Row 1: project, pointer tool and view on the left; the edit actions on the right */}
      <div className="flex items-center justify-between gap-3 min-w-0">
        <div className="flex min-w-0 items-center gap-2">
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
              className="h-6 w-44 rounded-control border border-accent/60 bg-surface-3 px-2 text-[11px] font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            />
          ) : (
            <span
              onDoubleClick={() => setIsEditingName(true)}
              title={projectName.length > PROJECT_NAME_MAX_CHARS ? undefined : 'Double-click to rename project'}
              className="cursor-text text-[11px] font-medium text-ink-dim transition-colors hover:text-ink"
            >
              <HoverTitle text={projectName} maxChars={PROJECT_NAME_MAX_CHARS} />
            </span>
          )}
          <div className="h-3.5 w-px bg-line shrink-0" />
          <Capsule label="Timeline tool" size="sm">
            <CapsuleButton title="Select tool: move and edit clips (Z)" active={tool === 'select'} onClick={() => onToolChange('select')}>
              Select
            </CapsuleButton>
            <CapsuleButton title="Range tool: highlight part of a track (X, or hold Alt while dragging)" active={tool === 'range'} onClick={() => onToolChange('range')}>
              Range
            </CapsuleButton>
          </Capsule>
          <Capsule label="View" size="sm">
            <CapsuleButton
              title={focusActive ? 'Back to all tracks (F)' : 'Single-track view: work on this track alone, large (F)'}
              active={focusActive}
              onClick={onToggleFocus}
              icon={<Maximize2 className="h-3 w-3" />}
            >
              {focusActive ? 'All tracks' : 'Focus'}
            </CapsuleButton>
            <CapsuleButton
              title={!focusActive ? 'In Focus view you can hear only this track or the full mix' : focusSolo ? 'Hearing only this track. Click to hear the full mix.' : 'Hearing the full mix. Click to hear only this track.'}
              active={focusActive && focusSolo}
              disabled={!focusActive}
              onClick={onToggleFocusSolo}
              icon={<Headphones className="h-3 w-3" />}
            >
              {focusSolo ? 'Solo' : 'Full mix'}
            </CapsuleButton>
          </Capsule>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Capsule label="Clip edit" size="sm">
            <CapsuleButton
              title={hasRange ? 'Split the highlighted range out at both edges (so it can be silenced, raised, lowered or processed)' : hasClip ? 'Split clip at playhead (S)' : 'Select a clip to split'}
              disabled={none}
              onClick={() => (hasRange || hasClip) && onSplit(clip?.id ?? '')}
              icon={<Scissors className="h-3 w-3" />}
            >
              Split
            </CapsuleButton>
            <CapsuleButton
              title={hasRange ? 'Cut the highlighted range and close the gap (Ctrl+X)' : hasSelection ? 'Cut the selected clips (Ctrl+X)' : 'Select a clip or highlight a range to cut'}
              disabled={!hasSelection && !hasRange}
              onClick={() => (hasRange || hasSelection) && onCut(clip?.id ?? '')}
              icon={<ScissorsLineDashed className="h-3 w-3" />}
            >
              Cut
            </CapsuleButton>
            <CapsuleButton
              title={hasRange ? 'Copy the highlighted range (Ctrl+C)' : hasSelection ? 'Copy the selected clips (Ctrl+C)' : 'Select a clip or highlight a range to copy'}
              disabled={!hasSelection && !hasRange}
              onClick={() => (hasRange || hasSelection) && onCopy(clip?.id ?? '')}
              icon={<Copy className="h-3 w-3" />}
            >
              Copy
            </CapsuleButton>
            <CapsuleButton
              title={canPaste ? 'Paste at the playhead, onto the active track (Ctrl+V)' : 'Clipboard is empty'}
              disabled={!canPaste}
              onClick={onPaste}
              icon={<ClipboardPaste className="h-3 w-3" />}
            >
              Paste
            </CapsuleButton>
            <CapsuleButton
              title={hasRange ? 'Silence the highlighted range (mutes just that part)' : hasSelection ? 'Silence the selected clips' : 'Select a clip or highlight a range to silence'}
              disabled={!hasSelection && !hasRange}
              onClick={onSilence}
              icon={<VolumeX className="h-3 w-3" />}
            >
              Silence
            </CapsuleButton>
          </Capsule>
          <button
            onClick={onDeleteRange}
            disabled={!hasRange}
            title={hasRange ? 'Delete the highlighted range from this track and close the gap (Delete)' : 'Highlight a range (Range tool, X) to delete it'}
            className={`${PILL} ${hasRange ? 'border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 focus-visible:ring-danger/50' : idle}`}
          >
            <Trash2 className="h-3 w-3" />
            <span>{hasRange ? `Delete ${rangeSeconds!.toFixed(2)}s` : 'Delete range'}</span>
          </button>
        </div>
      </div>

      {/* Row 2: what is done to the audio on the left (noise removal, then level and timing); the clip's own settings on the right */}
      <div className="flex items-center justify-between gap-3 min-w-0">
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto py-px scrollbar-none">
          {/* Noise removal: learn the noise, then remove it. One cluster, in the order it is used. */}
          <Capsule label="Noise removal" size="sm">
            <CapsuleButton
              title={hasRange ? 'Use the highlighted range as the noise sample: Denoise then removes only that noise from the whole track' : 'Highlight a few seconds with no speech (Range tool, X) to use as the noise sample'}
              disabled={!hasRange || !onCaptureNoise}
              onClick={onCaptureNoise}
              icon={<Fingerprint className="h-3 w-3" />}
            >
              {hasNoisePrint ? 'Noise sample ✓' : 'Noise sample'}
            </CapsuleButton>
            <CapsuleButton
              title={hasClip || hasRange ? (hasNoisePrint ? 'Remove the sampled noise from the selected clip or range' : 'Remove background noise. For best results take a Noise sample first (highlight a stretch with no speech)') : 'Select a clip or highlight a range to denoise'}
              disabled={none}
              onClick={() => !none && onOpenDsp('denoise')}
              icon={<Sparkles className="h-3 w-3" />}
            >
              Denoise
            </CapsuleButton>
          </Capsule>
          <Capsule label="Level and timing" size="sm">
            <CapsuleButton
              title={hasClip || hasRange ? 'Amplify gain in dB with clipping warning' : 'Select a clip or highlight a range to amplify'}
              disabled={none}
              onClick={() => !none && onOpenDsp('amplify')}
              icon={<Sliders className="h-3 w-3" />}
            >
              Amplify
            </CapsuleButton>
            <CapsuleButton
              title={hasClip || hasRange ? 'Dynamics Compressor with threshold, ratio, attack, release' : 'Select a clip or highlight a range to compress'}
              disabled={none}
              onClick={() => !none && onOpenDsp('compress')}
              icon={<Wand2 className="h-3 w-3" />}
            >
              Compress
            </CapsuleButton>
            <CapsuleButton
              title={hasClip || hasRange ? 'Change pitch without changing duration (-12 to +12 semitones)' : 'Select a clip or highlight a range to change pitch'}
              disabled={none}
              onClick={() => !none && onOpenDsp('pitch')}
              icon={<Music className="h-3 w-3" />}
            >
              Pitch
            </CapsuleButton>
            <CapsuleButton
              title={hasClip || hasRange ? 'Change tempo/speed without changing pitch (WSOLA time-stretch)' : 'Select a clip or highlight a range to change speed'}
              disabled={none}
              onClick={() => !none && onOpenDsp('speed')}
              icon={<Gauge className="h-3 w-3" />}
            >
              Speed
            </CapsuleButton>
          </Capsule>
        </div>

        {/* The clip's own settings: always there, available when a clip is selected */}
        <div className="flex shrink-0 items-center gap-1.5">
          <Capsule label="Racks" size="sm">
            <CapsuleButton
              title="Open the Audio Effects Rack (Delay, EQ, Chorus, Flanger, Phaser, Reverb)"
              disabled={!onOpenEffect}
              onClick={() => onOpenEffect?.('reverb')}
              icon={<Sparkles className="h-3 w-3" />}
            >
              Effects Rack
            </CapsuleButton>
            <CapsuleButton
              title={isTimelineCollapsed ? 'Show the timeline again' : 'Collapse the timeline to show only the Master Console'}
              active={isTimelineCollapsed}
              disabled={!onToggleTimelineCollapsed}
              onClick={onToggleTimelineCollapsed}
              icon={<SlidersHorizontal className="h-3 w-3" />}
            >
              {isTimelineCollapsed ? 'Show Timeline' : 'Master Console'}
            </CapsuleButton>
          </Capsule>
          <button
            onClick={() => clip && onToggleMute(clip.id)}
            disabled={!clip}
            title={clip ? 'Mute / Unmute clip' : 'Select a clip to mute it'}
            className={`${PILL} ${clip?.muted ? 'border-danger/40 bg-danger/10 text-danger' : idle}`}
          >
            {clip?.muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
            <span>{clip?.muted ? 'Muted' : 'Mute'}</span>
          </button>
          <Capsule label="Move to track" size="sm">
            <CapsuleButton iconOnly title="Move clip to track above (Arrow Up)" disabled={!clip} onClick={() => clip && onMoveTrack(clip.id, 'up')} icon={<ArrowUp className="h-3 w-3" />} />
            <CapsuleButton iconOnly title="Move clip to track below (Arrow Down)" disabled={!clip} onClick={() => clip && onMoveTrack(clip.id, 'down')} icon={<ArrowDown className="h-3 w-3" />} />
          </Capsule>
          {clip ? (
            <FadeMenu clip={clip} onUpdateClip={onUpdateClip} />
          ) : (
            <button disabled title="Select a clip to set its fades" className={`${PILL} ${idle}`}>
              <span>Fade</span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
