/**
 * X-PRO AUDIO - Central Editing & DSP Toolbar
 * Permanently docked directly above the timeline in direct relation to the editing panel.
 * Groups [Split, Cut, Copy, Paste] directly next to [Amplify, Compress, Denoise, Pitch, Speed],
 * followed by Mute, Move, Volume, and Fades.
 * Provides controls for collapsing the timeline track controller.
 */

import React, { useEffect, useState } from 'react';
import {
  MapPin,
  Lock,
  Unlock,
  Scissors,
  ScissorsLineDashed,
  Copy,
  ClipboardPaste,
  Sliders,
  Wand2,
  Sparkles,
  AudioWaveform,
  Group,
  Ungroup,
  ChevronDown,
  Music,
  Gauge,
  Activity,
  Zap,
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
  Layers,
  Undo2,
  Redo2,
  Upload,
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
  /** True when the selected clip or its group is locked (GR-4) */
  locked?: boolean;
  onToggleLock?: () => void;
  /** One Group / Ungroup button: Ungroup while the selection holds grouped clips */
  isGrouped?: boolean;
  canGroup?: boolean;
  onToggleGroup?: () => void;
  /** Undo / Redo (icon-only pill at the right of the first row) */
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
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
  /** Delete: the highlighted range, or the selected clips when there is no range */
  onDeleteRange: () => void;
  canDelete?: boolean;
  /** Add a marker at the playhead (or remove the one already there). Key M. */
  onToggleMarker?: () => void;
  markerCount?: number;
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
        <span className="font-num text-[10px] uppercase text-accent max-[1100px]:hidden">{shape === 'linear' ? 'Lin' : 'Exp'}</span>
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
  locked,
  onToggleLock,
  isGrouped = false,
  canGroup = false,
  onToggleGroup,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  tool,
  onToolChange,
  focusActive,
  onToggleFocus,
  focusSolo,
  onToggleFocusSolo,
  rangeSeconds,
  onDeleteRange,
  onToggleMarker,
  markerCount = 0,
  canDelete = false,
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
  // Effects Rack and Master Console: larger and cyan-tinted so they read as panels, not edit buttons
  const RACK = "flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft px-3.5 text-[11px] font-semibold text-accent transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-40";
  const PILL = "flex h-[22px] shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2.5 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="bg-surface-0 border-b border-line px-4 py-1 flex flex-col gap-1 text-[10px] text-ink-dim shrink-0 select-none z-30">
      {/* Lane rules (owner, 2026-11-05): buttons sit by what they do and how often they are used. Recurrent edits (undo/redo, split, cut,
          copy, paste, silence, delete) are on the lane nearest the timeline, right after the processing tools. This lane holds the
          session and view controls on the left and the panel launchers on the right.
          OWNER UPDATE (2026-11-07): Lock and Group sit on the UPPER lane, Delete is the last button of the LOWER lane.
          THE RULE (owner, 2026-11-06): any button whose function directly changes a track or clip (edits, processing, mute, lock,
          group, move, fade) goes on the LOWER lane. Any button that selects an action or a range of actions (tool, view, panels)
          goes on the UPPER lane. */}
      {/* Row 1: project, import, pointer tool and view on the left; the two panels on the right */}
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
          {/* Import: the same action as File > Import Audio Files (Header listens for this event) */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('uuda:import-audio'))}
            title="Import audio files (WAV, MP3, M4A)"
            className={`${PILL} ${idle}`}
          >
            <Upload className="h-3 w-3" />
            <span className="max-[1150px]:hidden">Import</span>
          </button>
          <Capsule label="Timeline tool" size="sm">
            <CapsuleButton title="Select tool: move and edit clips (Z)" active={tool === 'select'} onClick={() => onToolChange('select')}>
              Select
            </CapsuleButton>
            <CapsuleButton title="Range tool: highlight part of a track (X, or hold Alt while dragging)" active={tool === 'range'} onClick={() => onToolChange('range')}>
              Range
            </CapsuleButton>
          </Capsule>
          <button
            type="button"
            onClick={onToggleMarker}
            disabled={!onToggleMarker}
            title={`Marker: add one at the playhead, or remove the one there (M).${markerCount ? ` ${markerCount} in this project.` : ''}`}
            className={`${PILL} ${idle}`}
          >
            <MapPin className="h-3 w-3" />
            <span className="max-[1150px]:hidden">Marker</span>
          </button>
          <button
            onClick={() => onToggleLock?.()}
            disabled={!clip || !onToggleLock}
            title={clip ? (locked ? 'Unlock: allow moving and editing again (L)' : 'Lock: protect this clip or group from moving and editing (L)') : 'Select a clip or group to lock it'}
            aria-pressed={!!locked}
            className={`${PILL} ${locked ? 'border-gold/50 bg-gold/10 text-gold' : idle}`}
          >
            {locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
            <span className="max-[1440px]:hidden">{locked ? 'Locked' : 'Lock'}</span>
          </button>
          <button
            onClick={() => onToggleGroup?.()}
            disabled={!canGroup || !onToggleGroup}
            title={isGrouped ? 'Ungroup: release the grouped clips (a locked group must be unlocked first)' : canGroup ? 'Group the selected clips so they move together' : 'Select two or more clips (Shift+click) to group them'}
            className={`${PILL} ${idle}`}
          >
            {isGrouped ? <Ungroup className="h-3 w-3" /> : <Group className="h-3 w-3" />}
            <span className="max-[1440px]:hidden">{isGrouped ? 'Ungroup' : 'Group'}</span>
          </button>
          {/* Focus switches the single-track view on; Solo and Mix then choose what you hear */}
          <Capsule label="Focus view" size="sm">
            <CapsuleButton
              title={focusActive ? 'Back to all tracks (F)' : 'Single-track view: work on this track alone, large (F). Turns on Solo and Mix.'}
              active={focusActive}
              onClick={onToggleFocus}
              icon={<Maximize2 className="h-3 w-3" />}
            >
              Focus
            </CapsuleButton>
            <CapsuleButton
              title={focusActive ? 'Hear only this track' : 'Turn on Focus to choose what you hear'}
              active={focusActive && focusSolo}
              tone="gold"
              disabled={!focusActive}
              onClick={() => !focusSolo && onToggleFocusSolo()}
              icon={<Headphones className="h-3 w-3" />}
            >
              Solo
            </CapsuleButton>
            <CapsuleButton
              title={focusActive ? 'Hear the full mix while this track is in focus' : 'Turn on Focus to choose what you hear'}
              active={focusActive && !focusSolo}
              disabled={!focusActive}
              onClick={() => focusSolo && onToggleFocusSolo()}
              icon={<Layers className="h-3 w-3" />}
            >
              Mix
            </CapsuleButton>
          </Capsule>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* Panels that are opened from here: they choose what to work with, they do not change a clip */}
          <button
            type="button"
            title="Open the Audio Effects Rack (Delay, EQ, Chorus, Flanger, Phaser, Reverb)"
            disabled={!onOpenEffect}
            onClick={() => onOpenEffect?.('reverb')}
            className={RACK}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Effects<span className="max-[1100px]:hidden"> Rack</span></span>
          </button>
          <button
            type="button"
            title={isTimelineCollapsed ? 'Show the timeline again' : 'Collapse the timeline to show only the Master Console'}
            aria-pressed={isTimelineCollapsed}
            disabled={!onToggleTimelineCollapsed}
            onClick={onToggleTimelineCollapsed}
            className={`${RACK} ${isTimelineCollapsed ? '!bg-accent !text-accent-ink' : ''}`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>{isTimelineCollapsed ? 'Show Timeline' : <>Master<span className="max-[1100px]:hidden"> Console</span></>}</span>
          </button>
        </div>
      </div>

      {/* Row 2, nearest the tracks: what is done to the audio, the everyday edits, then the clip's own state, position and fades */}
      <div className="flex items-center justify-between gap-3 min-w-0">
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto py-px scrollbar-none max-[1100px]:gap-1">
          {/* Noise removal: learn the noise, then remove it. One cluster, in the order it is used. */}
          <Capsule label="Clean up" size="sm">
            <CapsuleButton
              title={hasRange ? 'Use the highlighted range as the noise sample: Denoise then removes only that noise from the whole track' : 'Highlight a few seconds with no speech (Range tool, X) to use as the noise sample'}
              disabled={!hasRange || !onCaptureNoise}
              onClick={onCaptureNoise}
              className="max-[1150px]:px-1.5"
              icon={<Fingerprint className="h-3 w-3" />}
            >
              <span className="max-[1100px]:hidden">{hasNoisePrint ? 'Noise sample ✓' : 'Noise sample'}</span><span className="hidden max-[1100px]:inline">{hasNoisePrint ? 'Sample ✓' : 'Sample'}</span>
            </CapsuleButton>
            <CapsuleButton
              title={hasClip || hasRange ? (hasNoisePrint ? 'Remove the sampled noise from the selected clip or range' : 'Remove background noise. For best results take a Noise sample first (highlight a stretch with no speech)') : 'Select a clip or highlight a range to denoise'}
              disabled={none}
              onClick={() => !none && onOpenDsp('denoise')}
              className="max-[1150px]:px-1.5"
              icon={<AudioWaveform className="h-3 w-3" />}
            >
              Denoise
            </CapsuleButton>
            <CapsuleButton
              title={hasClip || hasRange ? 'One-step cleanup for any recording: removes rumble, adds clarity, evens out the level' : 'Select a clip or highlight a range to enhance'}
              disabled={none}
              onClick={() => !none && onOpenDsp('enhance')}
              className="max-[1150px]:px-1.5"
              icon={<Zap className="h-3 w-3" />}
            >
              <span className="max-[1279px]:hidden">Enhance</span>
            </CapsuleButton>
          </Capsule>
          <Capsule label="Level and timing" size="sm">
            <CapsuleButton
              title={hasClip || hasRange ? 'Amplify gain in dB with clipping warning' : 'Select a clip or highlight a range to amplify'}
              disabled={none}
              onClick={() => !none && onOpenDsp('amplify')}
              className="max-[1150px]:px-1.5"
              icon={<Sliders className="h-3 w-3" />}
            >
              Amplify
            </CapsuleButton>
            <CapsuleButton
              title={hasClip || hasRange ? 'Normalize to a loudness or peak target, optionally evening out highs and lows' : 'Select a clip or highlight a range to normalize'}
              disabled={none}
              onClick={() => !none && onOpenDsp('normalize')}
              className="max-[1150px]:px-1.5"
              icon={<Activity className="h-3 w-3" />}
            >
              <span className="max-[1279px]:hidden">Normalize</span>
            </CapsuleButton>
            <CapsuleButton
              title={hasClip || hasRange ? 'Dynamics Compressor with threshold, ratio, attack, release' : 'Select a clip or highlight a range to compress'}
              disabled={none}
              onClick={() => !none && onOpenDsp('compress')}
              className="max-[1150px]:px-1.5"
              icon={<Wand2 className="h-3 w-3" />}
            >
              Compress
            </CapsuleButton>
            <CapsuleButton
              title={hasClip || hasRange ? 'Change pitch without changing duration (-12 to +12 semitones)' : 'Select a clip or highlight a range to change pitch'}
              disabled={none}
              onClick={() => !none && onOpenDsp('pitch')}
              className="max-[1150px]:px-1.5"
              icon={<Music className="h-3 w-3" />}
            >
              Pitch
            </CapsuleButton>
            <CapsuleButton
              title={hasClip || hasRange ? 'Change tempo/speed without changing pitch (WSOLA time-stretch)' : 'Select a clip or highlight a range to change speed'}
              disabled={none}
              onClick={() => !none && onOpenDsp('speed')}
              className="max-[1150px]:px-1.5"
              icon={<Gauge className="h-3 w-3" />}
            >
              Speed
            </CapsuleButton>
          </Capsule>
          <div className="mx-0.5 h-4 w-px shrink-0 bg-line-strong" />
          <Capsule label="History" size="sm">
            <CapsuleButton iconOnly title="Undo (Ctrl+Z)" disabled={!canUndo || !onUndo} onClick={onUndo} icon={<Undo2 className="h-3 w-3" />} />
            <CapsuleButton iconOnly title="Redo (Ctrl+Y)" disabled={!canRedo || !onRedo} onClick={onRedo} icon={<Redo2 className="h-3 w-3" />} />
          </Capsule>
          <Capsule label="Clip edit" size="sm">
            <CapsuleButton
              title={hasRange ? 'Split the highlighted range out at both edges (so it can be silenced, raised, lowered or processed)' : hasClip ? 'Split clip at playhead (S)' : 'Select a clip to split'}
              disabled={none}
              onClick={() => (hasRange || hasClip) && onSplit(clip?.id ?? '')}
              icon={<Scissors className="h-3 w-3" />}
            >
              <span className="max-[1650px]:hidden">Split</span>
            </CapsuleButton>
            <CapsuleButton
              title={hasRange ? 'Cut the highlighted range and close the gap (Ctrl+X)' : hasSelection ? 'Cut the selected clips (Ctrl+X)' : 'Select a clip or highlight a range to cut'}
              disabled={!hasSelection && !hasRange}
              onClick={() => (hasRange || hasSelection) && onCut(clip?.id ?? '')}
              icon={<ScissorsLineDashed className="h-3 w-3" />}
            >
              <span className="max-[1650px]:hidden">Cut</span>
            </CapsuleButton>
            <CapsuleButton
              title={hasRange ? 'Copy the highlighted range (Ctrl+C)' : hasSelection ? 'Copy the selected clips (Ctrl+C)' : 'Select a clip or highlight a range to copy'}
              disabled={!hasSelection && !hasRange}
              onClick={() => (hasRange || hasSelection) && onCopy(clip?.id ?? '')}
              icon={<Copy className="h-3 w-3" />}
            >
              <span className="max-[1650px]:hidden">Copy</span>
            </CapsuleButton>
            <CapsuleButton
              title={canPaste ? 'Paste at the playhead, onto the active track (Ctrl+V)' : 'Clipboard is empty'}
              disabled={!canPaste}
              onClick={onPaste}
              icon={<ClipboardPaste className="h-3 w-3" />}
            >
              <span className="max-[1650px]:hidden">Paste</span>
            </CapsuleButton>
            <CapsuleButton
              title={hasRange ? 'Silence the highlighted range (mutes just that part)' : hasSelection ? 'Silence the selected clips' : 'Select a clip or highlight a range to silence'}
              disabled={!hasSelection && !hasRange}
              onClick={onSilence}
              icon={<VolumeX className="h-3 w-3" />}
            >
              <span className="max-[1650px]:hidden">Silence</span>
            </CapsuleButton>
          </Capsule>
        </div>

        {/* What changes the selected clip or track itself: its state, position and fades */}
        <div className="flex shrink-0 items-center gap-1.5 max-[1100px]:gap-1">
          <button
            onClick={() => clip && onToggleMute(clip.id)}
            disabled={!clip}
            title={clip ? 'Mute / Unmute clip (Ctrl+M)' : 'Select a clip to mute it'}
            className={`${PILL} ${clip?.muted ? 'border-danger/40 bg-danger/10 text-danger' : idle}`}
          >
            {clip?.muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
            <span className="max-[1440px]:hidden">{clip?.muted ? 'Muted' : 'Mute'}</span>
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
          <button
            onClick={onDeleteRange}
            disabled={!canDelete}
            title={hasRange ? `Delete the highlighted ${rangeSeconds!.toFixed(2)}s from this track and close the gap (Delete)` : canDelete ? 'Delete the selected clips (Delete)' : 'Select a clip or highlight a range (Range tool, X) to delete it'}
            className={`${PILL} ${canDelete ? 'border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 focus-visible:ring-danger/50' : idle}`}
          >
            <Trash2 className="h-3 w-3" />
            <span className="max-[1650px]:hidden">Delete</span>
          </button>
        </div>
      </div>
    </div>
  );
};
