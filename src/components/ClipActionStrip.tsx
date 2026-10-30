/**
 * Uuda Studio - Quick Actions
 * One floating panel for whatever is selected: a clip, several clips or a whole group. Everything lives here in
 * collapsible sections (Edit, Arrange, Group, Level and fades, Processing, Project), so there is never a second, smaller
 * menu to get the wrong tool from. Actions that do not apply to the selection stay visible but dimmed, with a tooltip
 * saying why. Opens on double-click, or with the Q key; drag the header to move it; the panel scrolls.
 */

import React, { useEffect, useRef, useState } from 'react';
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
  Group,
  Ungroup,
  GripHorizontal,
  ChevronDown,
  X,
} from 'lucide-react';
import { Clip, GroupSettings } from '../types';
import { formatVolumeDb, formatPan } from '../utils/formatters';
import { DEFAULT_GROUP_SETTINGS } from '../audio/groupSettings';
import { DspModalType } from './DspModals';

export interface QuickActionGroup {
  id: string;
  name: string;
  color: string;
  settings: GroupSettings | undefined;
}

interface ClipActionStripProps {
  /** First selected clip (the one whose own values the single-clip sections show) */
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
  /** Apply the same change to several clips as one undo step */
  onUpdateClips?: (clipIds: string[], updates: Partial<Clip>) => void;
  onOpenDsp: (type: DspModalType) => void;
  onOpenExport?: () => void;
  onOpenPlugins?: () => void;
  /** Ids of every selected clip */
  selectedIds?: string[];
  /** How many clips are selected */
  selectedCount?: number;
  isGrouped?: boolean;
  /** Set when the selection is exactly one group: its own level, pan and mute are then shown here */
  group?: QuickActionGroup | null;
  onUpdateGroup?: (groupId: string, patch: Partial<GroupSettings>) => void;
  onGroup?: () => void;
  onUngroup?: () => void;
}

const SECTIONS_KEY = 'uuda_quick_actions_collapsed';

const readCollapsed = (): Record<string, boolean> => {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const Section: React.FC<{
  id: string;
  title: string;
  collapsed: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}> = ({ id, title, collapsed, onToggle, children }) => (
  <div className="border-t border-line pt-1.5">
    <button
      type="button"
      onClick={() => onToggle(id)}
      aria-expanded={!collapsed}
      className="w-full flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-ink-dim hover:text-ink cursor-pointer py-0.5"
    >
      <span>{title}</span>
      <ChevronDown className={`w-3 h-3 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
    </button>
    {!collapsed && <div className="pt-1.5 space-y-1.5">{children}</div>}
  </div>
);

const BTN =
  'flex items-center justify-center gap-1 p-1.5 rounded-control border border-line bg-surface-3/60 text-[10px] font-medium text-ink-dim transition-colors hover:bg-surface-3 hover:text-ink disabled:opacity-30 disabled:pointer-events-none cursor-pointer';
const BTN_COL = BTN.replace('flex items-center justify-center gap-1', 'flex flex-col items-center justify-center gap-1');

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
  onUpdateClips,
  onOpenDsp,
  onOpenExport,
  onOpenPlugins,
  selectedIds,
  selectedCount = 1,
  isGrouped = false,
  group = null,
  onUpdateGroup,
  onGroup,
  onUngroup,
}) => {
  const multi = selectedCount > 1;
  const single = !multi;
  const ids = selectedIds && selectedIds.length > 0 ? selectedIds : [clip.id];

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });

  // Sticky: stays open while you work (it follows the selection). Closed by the X, Escape or Q.
  useEffect(() => {
    const handleClose = () => onClose();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('xpro:close-popups', handleClose);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('xpro:close-popups', handleClose);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Position: starts near the clip, then belongs to the user. Drag the header to move it anywhere in the window.
  const STRIP_WIDTH = 320;
  const [pos, setPos] = useState(() => ({
    left: Math.min(window.innerWidth - STRIP_WIDTH - 16, Math.max(16, position.x)),
    top: Math.min(Math.max(56, window.innerHeight - 460 - 16), Math.max(56, position.y - 100)),
  }));
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragRef.current = { dx: e.clientX - pos.left, dy: e.clientY - pos.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setPos({
      left: Math.min(window.innerWidth - STRIP_WIDTH - 8, Math.max(8, e.clientX - d.dx)),
      top: Math.min(window.innerHeight - 56, Math.max(8, e.clientY - d.dy)),
    });
  };
  const onHeaderPointerUp = () => {
    dragRef.current = null;
  };

  const only = 'Select a single clip to use this';
  const gs = { ...DEFAULT_GROUP_SETTINGS, ...(group?.settings ?? {}) };
  const title = group ? `${group.name} · ${selectedCount} clips` : multi ? `${selectedCount} clips selected` : clip.name;

  const setMuted = (muted: boolean) => {
    if (onUpdateClips) onUpdateClips(ids, { muted });
    else ids.forEach((id) => onUpdateClip(id, { muted }));
  };

  return (
    <div
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
      onClick={(e) => e.stopPropagation()}
      className="clip-action-strip-container fixed z-40 bg-surface-2 border border-line-strong rounded-card shadow-float p-3 text-ink-dim text-xs w-80 max-h-[min(520px,calc(100vh-70px))] overflow-y-auto overscroll-contain [scrollbar-width:thin] uuda-pop-in select-none space-y-2"
    >
      {/* Header */}
      <div
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        title="Drag to move"
        className="flex cursor-grab touch-none items-center justify-between pb-1.5 active:cursor-grabbing"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <GripHorizontal className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
          {group && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: group.color }} />}
          <span className="font-semibold text-ink truncate text-xs">{title}</span>
          {single && clip.muted && (
            <span className="text-[9px] px-1 bg-danger/20 text-danger rounded font-semibold">MUTED</span>
          )}
        </div>
        <button onClick={onClose} className="text-ink-faint hover:text-ink p-0.5 rounded transition-colors cursor-pointer" title="Close Quick Actions">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Edit: the same buttons whether one clip, several or a group is selected */}
      <Section id="edit" title="Edit" collapsed={!!collapsed.edit} onToggle={toggle}>
        <div className="grid grid-cols-5 gap-1">
          <button disabled={!single} onClick={() => { onSplit(clip.id); onClose(); }} title={single ? 'Split clip at playhead (S)' : only} className={BTN_COL}>
            <Scissors className="w-3.5 h-3.5 text-accent" />
            <span>Split</span>
          </button>
          <button onClick={() => onCopy(clip.id)} title={multi ? `Copy the ${selectedCount} selected clips (Ctrl+C)` : 'Copy clip (Ctrl+C)'} className={BTN_COL}>
            <Copy className="w-3.5 h-3.5" />
            <span>Copy</span>
          </button>
          <button onClick={() => onCut(clip.id)} title={multi ? `Cut the ${selectedCount} selected clips (Ctrl+X)` : 'Cut clip (Ctrl+X)'} className={BTN_COL}>
            <ScissorsLineDashed className="w-3.5 h-3.5" />
            <span>Cut</span>
          </button>
          <button disabled={!canPaste} onClick={() => onPaste()} title={canPaste ? 'Paste at the playhead (Ctrl+V)' : 'Clipboard is empty'} className={BTN_COL}>
            <ClipboardPaste className="w-3.5 h-3.5" />
            <span>Paste</span>
          </button>
          <button
            onClick={() => { onDelete(clip.id); onClose(); }}
            title={multi ? `Delete the ${selectedCount} selected clips (Delete)` : 'Delete clip (Delete)'}
            className={`${BTN_COL} hover:!bg-danger/15 hover:!text-danger`}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>
        </div>
      </Section>

      {/* Arrange: move and mute */}
      <Section id="arrange" title="Arrange" collapsed={!!collapsed.arrange} onToggle={toggle}>
        <div className="grid grid-cols-3 gap-1">
          <button disabled={!single} onClick={() => onMoveTrack(clip.id, 'up')} title={single ? 'Move clip to the track above' : only} className={BTN}>
            <ArrowUp className="w-3 h-3" />
            <span>Move Up</span>
          </button>
          <button disabled={!single} onClick={() => onMoveTrack(clip.id, 'down')} title={single ? 'Move clip to the track below' : only} className={BTN}>
            <ArrowDown className="w-3 h-3" />
            <span>Move Down</span>
          </button>
          {multi ? (
            <button onClick={() => setMuted(true)} title="Mute every selected clip" className={BTN}>
              <VolumeX className="w-3 h-3" />
              <span>Mute all</span>
            </button>
          ) : (
            <button
              onClick={() => onToggleMute(clip.id)}
              title="Mute / unmute clip"
              className={`${BTN} ${clip.muted ? '!bg-danger/15 !text-danger !border-danger/40' : ''}`}
            >
              {clip.muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
              <span>{clip.muted ? 'Unmute' : 'Mute'}</span>
            </button>
          )}
        </div>
        {multi && (
          <button onClick={() => setMuted(false)} title="Unmute every selected clip" className={`${BTN} w-full`}>
            <Volume2 className="w-3 h-3" />
            <span>Unmute all</span>
          </button>
        )}
      </Section>

      {/* Group: tie clips together, and (for a group) its own channel */}
      {(onGroup || onUngroup) && (
        <Section id="group" title="Group" collapsed={!!collapsed.group} onToggle={toggle}>
          <div className="grid grid-cols-2 gap-1">
            <button disabled={!multi || isGrouped} onClick={() => onGroup?.()} title={multi ? (isGrouped ? 'Already a group' : 'Group the selected clips') : 'Select two or more clips (Shift+click) to group them'} className={BTN}>
              <Group className="w-3 h-3" />
              <span>Group</span>
            </button>
            <button disabled={!isGrouped} onClick={() => onUngroup?.()} title={isGrouped ? 'Release the group and its effects' : 'The selection is not grouped'} className={BTN}>
              <Ungroup className="w-3 h-3" />
              <span>Ungroup</span>
            </button>
          </div>
          {group && onUpdateGroup && (
            <div className="space-y-1.5 rounded-control bg-surface-1 border border-line p-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-ink-faint w-8">VOL</span>
                <input
                  type="range" min="0" max="1.5" step="0.01" value={gs.volume}
                  aria-label="Group volume"
                  onDoubleClick={() => onUpdateGroup(group.id, { volume: 1 })}
                  onChange={(e) => onUpdateGroup(group.id, { volume: parseFloat(e.target.value) })}
                  className="flex-1 h-1 accent-accent cursor-pointer"
                />
                <span className="font-num text-[10px] text-ink w-12 text-right">{formatVolumeDb(gs.volume)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-ink-faint w-8">PAN</span>
                <input
                  type="range" min="-1" max="1" step="0.05" value={gs.pan}
                  aria-label="Group pan"
                  onDoubleClick={() => onUpdateGroup(group.id, { pan: 0 })}
                  onChange={(e) => onUpdateGroup(group.id, { pan: parseFloat(e.target.value) })}
                  className="flex-1 h-1 accent-accent cursor-pointer"
                />
                <span className="font-num text-[10px] text-ink w-12 text-right">{formatPan(gs.pan)}</span>
              </div>
              <button
                onClick={() => onUpdateGroup(group.id, { muted: !gs.muted })}
                aria-pressed={gs.muted}
                className={`${BTN} w-full ${gs.muted ? '!bg-danger/15 !text-danger !border-danger/40' : ''}`}
              >
                {gs.muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                <span>{gs.muted ? 'Group muted' : 'Mute group'}</span>
              </button>
            </div>
          )}
        </Section>
      )}

      {/* The clip's own gain and fades */}
      <Section id="level" title="Clip level and fades" collapsed={!!collapsed.level} onToggle={toggle}>
        {single ? (
          <div className="space-y-1.5 bg-surface-1 p-2 rounded-control border border-line text-[11px]">
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1 text-ink-dim shrink-0">
                <Volume2 className="w-3 h-3 text-accent" />
                <span>Gain</span>
              </div>
              <span className="font-num text-ink font-semibold text-[10px] shrink-0">{formatVolumeDb(clip.gain)}</span>
              <input
                type="range" min="0" max="2.0" step="0.05" value={clip.gain}
                onChange={(e) => onUpdateClip(clip.id, { gain: parseFloat(e.target.value) })}
                className="w-20 h-1 accent-accent cursor-pointer"
              />
              <button onClick={() => onUpdateClip(clip.id, { gain: Math.max(0, clip.gain * 0.891) })} title="Volume -1 dB" className="px-1 text-[9px] bg-surface-3 hover:bg-surface-3/70 rounded text-ink-dim font-num cursor-pointer">-1dB</button>
              <button onClick={() => onUpdateClip(clip.id, { gain: Math.min(2.5, clip.gain * 1.122) })} title="Volume +1 dB" className="px-1 text-[9px] bg-surface-3 hover:bg-surface-3/70 rounded text-ink-dim font-num cursor-pointer">+1dB</button>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-line">
              {(['fadeInSeconds', 'fadeOutSeconds'] as const).map((key) => (
                <div key={key}>
                  <div className="flex justify-between text-ink-dim text-[10px] mb-0.5">
                    <span>{key === 'fadeInSeconds' ? 'Fade In' : 'Fade Out'}</span>
                    <span className="font-num text-ink">{clip[key].toFixed(2)}s</span>
                  </div>
                  <input
                    type="range" min="0" max={Math.min(5, clip.durationSeconds / 2)} step="0.05" value={clip[key]}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      onUpdateClip(clip.id, key === 'fadeInSeconds' ? { fadeInSeconds: v } : { fadeOutSeconds: v });
                    }}
                    className="w-full h-1 accent-accent cursor-pointer"
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-line text-[10px]">
              <span className="text-ink-dim">Curve Shape</span>
              <button
                onClick={() => onUpdateClip(clip.id, { fadeShape: clip.fadeShape === 'linear' ? 'exponential' : 'linear' })}
                className="px-2 py-0.5 rounded bg-surface-3 hover:bg-surface-3/70 text-accent font-num capitalize border border-line cursor-pointer"
              >
                {clip.fadeShape}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-[10px] text-ink-faint leading-snug">
            {group
              ? 'A group is balanced as one unit: change its level with the group volume above. Each clip keeps its own level inside the group.'
              : 'Select a single clip to change its own gain and fades.'}
          </div>
        )}
      </Section>

      {/* Processing tools work on one clip's audio */}
      <Section id="dsp" title="Processing" collapsed={!!collapsed.dsp} onToggle={toggle}>
        <div className="grid grid-cols-5 gap-1">
          {([
            ['amplify', 'Amplify', Sliders, 'Amplify gain in dB with clipping warning'],
            ['compress', 'Compress', Wand2, 'Dynamics compressor with threshold and ratio'],
            ['denoise', 'Denoise', Sparkles, 'Basic noise reduction (high-pass and spectral gate)'],
            ['pitch', 'Pitch', Music, 'Change pitch without changing duration'],
            ['speed', 'Speed', Gauge, 'Change speed without changing pitch'],
          ] as const).map(([type, label, Icon, tip]) => (
            <button
              key={type}
              disabled={!single}
              onClick={() => { onOpenDsp(type as DspModalType); onClose(); }}
              title={single ? tip : only}
              className={`${BTN_COL} !text-[9px] !p-1`}
            >
              <Icon className="w-3 h-3 text-accent" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </Section>

      {/* Project-level shortcuts */}
      {(onOpenExport || onOpenPlugins) && (
        <Section id="project" title={group ? 'Export and effects' : 'Export and plugins'} collapsed={!!collapsed.project} onToggle={toggle}>
          <div className="grid grid-cols-2 gap-1">
            {onOpenExport && (
              <button onClick={() => { onOpenExport(); onClose(); }} title="Export the project (or the selection)" className={BTN}>
                <Download className="w-3 h-3" />
                <span>Export</span>
              </button>
            )}
            {onOpenPlugins && (
              <button onClick={() => { onOpenPlugins(); onClose(); }} title={group ? 'Open the group effects rack' : 'Open the plugins rack'} className={BTN}>
                <Plug className="w-3 h-3" />
                <span>{group ? 'Group effects' : 'Plugins'}</span>
              </button>
            )}
          </div>
        </Section>
      )}

      <div className="pt-1 border-t border-line text-[10px] font-num text-ink-faint">
        {multi ? `${selectedCount} clips` : `Duration: ${clip.durationSeconds.toFixed(3)}s`}
      </div>
    </div>
  );
};
