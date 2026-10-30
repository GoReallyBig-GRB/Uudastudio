/**
 * Uuda Studio - Groups list (under the track list)
 * One row per clip group: its colour, name, how many clips it holds and its time span, plus the group's own
 * mute, volume and pan. Clicking a row selects the group's clips on the timeline.
 */

import React from 'react';
import { Link2, Volume2, VolumeX, SlidersHorizontal } from 'lucide-react';
import type { GroupSettings } from '../types';
import { formatGroupSpan, type GroupSummary } from '../audio/groupInfo';
import { DEFAULT_GROUP_SETTINGS } from '../audio/groupSettings';
import { formatVolumeDb, formatPan } from '../utils/formatters';

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

export const GroupListPanel: React.FC<GroupListPanelProps> = ({ groups, settings, selectedClipIds, onSelectGroup, onUpdateGroup, onOpenGroupPlugins, soloGroupId = null, onToggleSolo }) => {
  if (groups.length === 0) return null;
  return (
    <div className="shrink-0 border-t border-line bg-surface-1 max-h-[46%] overflow-y-auto overscroll-contain [scrollbar-width:thin]">
      <div className="h-9 px-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-dim sticky top-0 bg-surface-1 z-10">
        <Link2 className="w-3.5 h-3.5" />
        <span>Groups</span>
        <span className="font-num text-ink-faint">{groups.length}</span>
      </div>
      <div className="px-2 pb-2 space-y-1.5">
        {groups.map((g) => {
          const s = { ...DEFAULT_GROUP_SETTINGS, ...(settings?.[g.id] ?? {}) };
          const isSelected = g.clipIds.length > 0 && g.clipIds.every((id) => selectedClipIds?.has(id));
          const isSolo = soloGroupId === g.id;
          const isDimmed = !!soloGroupId && !isSolo;
          return (
            <div
              key={g.id}
              onClick={() => onSelectGroup(g.id)}
              style={isSelected || isSolo ? { borderColor: g.color.border } : undefined}
              className={`rounded-control border p-2 cursor-pointer transition-colors ${
                isSelected || isSolo ? 'bg-surface-3' : 'border-line bg-surface-2 hover:bg-surface-3'
              } ${isDimmed ? 'opacity-55' : ''}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.color.border }} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-ink truncate">{g.name}</div>
                  <div className="text-[10px] text-ink-faint font-num">
                    {g.clipCount} {g.clipCount === 1 ? 'clip' : 'clips'} · {formatGroupSpan(g.durationSeconds)}{isSolo ? ' · solo' : ''}
                  </div>
                </div>
                {onToggleSolo && (
                  <button
                    type="button"
                    title={isSolo ? 'Stop auditioning this group' : 'Hear only this group'}
                    aria-label={`Solo ${g.name}`}
                    aria-pressed={isSolo}
                    onClick={(e) => { e.stopPropagation(); onToggleSolo(g.id); }}
                    className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold cursor-pointer ${isSolo ? 'bg-warn text-black' : 'text-ink-dim hover:text-ink hover:bg-surface-1'}`}
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
                    className="p-1 rounded-sm text-ink-dim hover:text-accent hover:bg-surface-1 cursor-pointer"
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
                  className={`p-1 rounded-sm cursor-pointer ${s.muted ? 'text-danger bg-danger/10' : 'text-ink-dim hover:text-ink hover:bg-surface-1'}`}
                >
                  {s.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="mt-1.5 grid grid-cols-[1fr_4.5rem] gap-2 items-center" onClick={(e) => e.stopPropagation()}>
                <div>
                  <div className="flex justify-between text-[9px] font-num text-ink-faint mb-0.5">
                    <span>VOL</span>
                    <span>{formatVolumeDb(s.volume)}</span>
                  </div>
                  <input
                    type="range" min="0" max="1.5" step="0.01" value={s.volume}
                    aria-label={`${g.name} volume`}
                    onDoubleClick={() => onUpdateGroup(g.id, { volume: 1 })}
                    onChange={(e) => onUpdateGroup(g.id, { volume: parseFloat(e.target.value) })}
                    className="w-full h-1 accent-accent cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[9px] font-num text-ink-faint mb-0.5">
                    <span>PAN</span>
                    <span>{formatPan(s.pan)}</span>
                  </div>
                  <input
                    type="range" min="-1" max="1" step="0.05" value={s.pan}
                    aria-label={`${g.name} pan`}
                    onDoubleClick={() => onUpdateGroup(g.id, { pan: 0 })}
                    onChange={(e) => onUpdateGroup(g.id, { pan: parseFloat(e.target.value) })}
                    className="w-full h-1 accent-accent cursor-pointer"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
