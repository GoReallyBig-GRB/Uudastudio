/**
 * Uuda Studio - Groups list (under the track list)
 * One row per clip group. Compact by default: colour box, name, clip count and time span, solo, effects and mute. The header's
 * chevron opens every row to the full view, which adds the group's volume and pan. The colour box opens a colour picker; the
 * name can be edited (double-click it or use the pencil). Clicking a row selects the group's clips and auditions it alone.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Link2, Volume2, VolumeX, SlidersHorizontal, Pencil, ChevronUp, ChevronDown } from 'lucide-react';
import type { GroupSettings } from '../types';
import { formatGroupSpan, type GroupSummary } from '../audio/groupInfo';
import { DEFAULT_GROUP_SETTINGS } from '../audio/groupSettings';
import { formatVolumeDb, formatPan } from '../utils/formatters';
import { ColorBox } from './ColorBox';

interface GroupListPanelProps {
  groups: GroupSummary[];
  settings: Record<string, GroupSettings> | undefined;
  selectedClipIds?: Set<string>;
  onSelectGroup: (groupId: string) => void;
  onUpdateGroup: (groupId: string, patch: Partial<GroupSettings>) => void;
  onOpenGroupPlugins?: (groupId: string) => void;
  /** Group being auditioned alone (clicking a row toggles it) */
  soloGroupId?: string | null;
  onToggleSolo?: (groupId: string) => void;
}

const EXPANDED_KEY = 'uuda_groups_expanded';
const iconBtn = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-ink-dim hover:text-ink hover:bg-surface-1 cursor-pointer transition-colors';

export const GroupListPanel: React.FC<GroupListPanelProps> = ({
  groups, settings, selectedClipIds, onSelectGroup, onUpdateGroup, onOpenGroupPlugins, soloGroupId = null, onToggleSolo,
}) => {
  const [expanded, setExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem(EXPANDED_KEY) === '1'; } catch { return false; }
  });
  const toggleExpanded = () =>
    setExpanded((v) => {
      try { localStorage.setItem(EXPANDED_KEY, v ? '0' : '1'); } catch { /* storage unavailable */ }
      return !v;
    });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editingId) inputRef.current?.select();
  }, [editingId]);
  useEffect(() => {
    if (editingId && !groups.some((g) => g.id === editingId)) setEditingId(null);
  }, [groups, editingId]);

  if (groups.length === 0) return null;

  const commit = (g: GroupSummary) => {
    setEditingId(null);
    const typed = draft.trim().slice(0, 40);
    if (typed && typed !== g.name) onUpdateGroup(g.id, { name: typed });
  };

  return (
    <div className="shrink-0 border-t border-line bg-surface-1 max-h-[46%] overflow-y-auto overscroll-contain [scrollbar-width:thin]">
      <div className="h-9 pl-3 pr-2 flex items-center gap-2 sticky top-0 bg-surface-1 z-10">
        <Link2 className="w-3.5 h-3.5 text-ink-dim shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-dim">Groups</span>
        <span className="text-[10px] font-num px-2 text-ink-dim bg-surface-3 rounded-full">{groups.length}</span>
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          title={expanded ? 'Show the compact list' : 'Show volume and pan for every group'}
          aria-label={expanded ? 'Collapse groups' : 'Expand groups'}
          className={`${iconBtn} ml-auto`}
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      <div className="px-2 pb-2 space-y-1">
        {groups.map((g) => {
          const s = { ...DEFAULT_GROUP_SETTINGS, ...(settings?.[g.id] ?? {}) };
          const isSelected = g.clipIds.length > 0 && g.clipIds.every((id) => selectedClipIds?.has(id));
          const isSolo = soloGroupId === g.id;
          const isDimmed = !!soloGroupId && !isSolo;
          const isEditing = editingId === g.id;
          return (
            <div
              key={g.id}
              onClick={() => onSelectGroup(g.id)}
              style={isSelected || isSolo ? { borderColor: g.color.border } : undefined}
              className={`group rounded-control border px-2 py-1.5 cursor-pointer transition-colors ${
                isSelected || isSolo ? 'bg-surface-3' : 'border-line bg-surface-2 hover:bg-surface-3 hover:border-line-strong'
              } ${isDimmed ? 'opacity-55' : ''}`}
            >
              {/* Compact row: the same columns for every group */}
              <div className="flex items-center gap-2 min-w-0">
                <ColorBox
                  value={g.color.border}
                  ariaLabel={`${g.name} colour`}
                  title="Group colour (click to change)"
                  onChange={(hex) => onUpdateGroup(g.id, { color: hex })}
                />
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <input
                      ref={inputRef}
                      value={draft}
                      maxLength={40}
                      autoFocus
                      aria-label="Group name"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commit(g)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commit(g);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="w-full bg-surface-3 border border-accent/60 rounded-control px-2 py-0.5 text-xs text-ink font-semibold focus:outline-none"
                    />
                  ) : (
                    <div
                      onDoubleClick={(e) => { e.stopPropagation(); setEditingId(g.id); setDraft(g.name); }}
                      title="Double-click to rename"
                      className="text-xs font-semibold text-ink truncate"
                    >
                      {g.name}
                    </div>
                  )}
                  <div className="text-[10px] font-num text-ink-faint truncate">
                    {g.clipCount} {g.clipCount === 1 ? 'clip' : 'clips'} · {formatGroupSpan(g.durationSeconds)}
                    {isSolo ? ' · solo' : ''}
                  </div>
                </div>

                <div className="flex items-center shrink-0">
                  <button
                    type="button"
                    title="Rename group"
                    aria-label={`Rename ${g.name}`}
                    onClick={(e) => { e.stopPropagation(); setEditingId(g.id); setDraft(g.name); }}
                    className={`${iconBtn} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  {onToggleSolo && (
                    <button
                      type="button"
                      title={isSolo ? 'Stop auditioning this group' : 'Hear only this group'}
                      aria-label={`Solo ${g.name}`}
                      aria-pressed={isSolo}
                      onClick={(e) => { e.stopPropagation(); onToggleSolo(g.id); }}
                      className={`${iconBtn} text-[10px] font-bold ${isSolo ? '!bg-warn !text-black' : ''}`}
                    >
                      S
                    </button>
                  )}
                  {onOpenGroupPlugins && (
                    <button
                      type="button"
                      title="Group effects"
                      aria-label={`${g.name} effects`}
                      onClick={(e) => { e.stopPropagation(); onOpenGroupPlugins(g.id); }}
                      className={iconBtn}
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    title={s.muted ? 'Unmute group' : 'Mute group'}
                    aria-label={s.muted ? `Unmute ${g.name}` : `Mute ${g.name}`}
                    aria-pressed={s.muted}
                    onClick={(e) => { e.stopPropagation(); onUpdateGroup(g.id, { muted: !s.muted }); }}
                    className={`${iconBtn} ${s.muted ? '!text-danger !bg-danger/10' : ''}`}
                  >
                    {s.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Full view adds volume and pan, in aligned columns */}
              {expanded && (
                <div className="mt-1.5 space-y-1 pl-7" onClick={(e) => e.stopPropagation()}>
                  <div className="grid grid-cols-[2rem_minmax(0,1fr)_3.25rem] items-center gap-2">
                    <span className="text-[9px] font-num text-ink-faint">VOL</span>
                    <input
                      type="range" min="0" max="1.5" step="0.01" value={s.volume}
                      aria-label={`${g.name} volume`}
                      onDoubleClick={() => onUpdateGroup(g.id, { volume: 1 })}
                      onChange={(e) => onUpdateGroup(g.id, { volume: parseFloat(e.target.value) })}
                      className="w-full h-4 cursor-pointer accent-accent"
                    />
                    <span className="text-[10px] font-num text-ink text-right">{formatVolumeDb(s.volume)}</span>
                  </div>
                  <div className="grid grid-cols-[2rem_minmax(0,1fr)_3.25rem] items-center gap-2">
                    <span className="text-[9px] font-num text-ink-faint">PAN</span>
                    <input
                      type="range" min="-1" max="1" step="0.05" value={s.pan}
                      aria-label={`${g.name} pan`}
                      onDoubleClick={() => onUpdateGroup(g.id, { pan: 0 })}
                      onChange={(e) => onUpdateGroup(g.id, { pan: parseFloat(e.target.value) })}
                      className="w-full h-4 cursor-pointer accent-accent"
                    />
                    <span className="text-[10px] font-num text-ink text-right">{formatPan(s.pan)}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
