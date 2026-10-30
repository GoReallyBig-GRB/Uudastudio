/**
 * Uuda Studio - Tracks sidebar panel
 * Every track in the session, in timeline order.
 *
 * Names: double-click a name (or use the pencil) to rename; Enter saves, Escape cancels, blank goes back to the
 * automatic "Track N" label, which follows the track's position when lanes are reordered.
 * Empty lanes are tagged, and "Remove empty" clears them in one go (undoable).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Layers, Plus, Trash2, ChevronUp, ChevronDown, Pencil, Eraser } from 'lucide-react';
import { Track } from '../types';
import { pluginManager } from '../plugins/pluginManager';
import { formatTrackLength, trackEndSeconds } from '../utils/formatters';
import { HoverTitle } from './ui';
import { ColorBox } from './ColorBox';
import { displayTitle } from './clipTitle';
import { getTrackLabel, renameUpdate, isTrackEmpty } from '../utils/tracks';

interface TrackListPanelProps {
  tracks: Track[];
  selectedTrackId: string | null;
  onSelectTrack: (trackId: string) => void;
  onDeleteTrack: (trackId: string) => void;
  onMoveTrack: (trackId: string, direction: 'up' | 'down') => void;
  onAddTrack: () => void;
  onUpdateTrack: (trackId: string, updates: Partial<Track>) => void;
  onRemoveEmptyTracks: () => void;
  /** Ids of the clips currently selected on the timeline; the selected clip's name shows on its track's row. */
  selectedClipIds?: Set<string>;
  /** Shown under the track list (the groups list) */
  footer?: React.ReactNode;
}

export const TrackListPanel: React.FC<TrackListPanelProps> = ({
  tracks,
  selectedTrackId,
  onSelectTrack,
  onDeleteTrack,
  onMoveTrack,
  onAddTrack,
  onUpdateTrack,
  onRemoveEmptyTracks,
  selectedClipIds,
  footer,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Empty lanes that "Remove empty" can clear (lanes that still carry plugins are kept)
  const [, setTick] = useState(0);
  useEffect(() => pluginManager.subscribe(() => setTick((t) => t + 1)), []);
  const emptyCount = tracks.filter((t) => isTrackEmpty(t) && pluginManager.getPluginsForTrack(t.id).length === 0).length;

  useEffect(() => {
    if (editingId) inputRef.current?.select();
  }, [editingId]);

  // Drop the editor if its track disappears (deleted, undo)
  useEffect(() => {
    if (editingId && !tracks.some((t) => t.id === editingId)) setEditingId(null);
  }, [tracks, editingId]);

  const startEdit = (track: Track, label: string) => {
    setEditingId(track.id);
    setDraft(label);
  };

  const commitEdit = (track: Track, label: string) => {
    setEditingId(null);
    const typed = draft.trim();
    if (typed === label) return; // unchanged: keep the automatic label automatic
    onUpdateTrack(track.id, renameUpdate(typed));
  };

  return (
    <div className="w-full shrink-0 bg-surface-1 flex flex-col h-full select-none min-w-0">
      {/* Header */}
      <div className="h-12 px-3 border-b border-line flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Layers className="w-3.5 h-3.5 text-ink-dim shrink-0" />
          <span className="text-xs font-semibold text-ink uppercase tracking-wider">Tracks</span>
          <span className="text-[10px] font-num px-2 text-ink-dim bg-surface-3 rounded-full">{tracks.length}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {emptyCount > 0 && (
            <button
              type="button"
              onClick={onRemoveEmptyTracks}
              title={`Remove ${emptyCount} empty ${emptyCount === 1 ? 'track' : 'tracks'}`}
              aria-label={`Remove ${emptyCount} empty tracks`}
              className="flex items-center gap-1 text-[11px] text-warn hover:bg-warn/10 px-2 py-1 rounded-full cursor-pointer"
            >
              <Eraser className="w-3.5 h-3.5" />
              <span>{emptyCount}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onAddTrack}
            title="Add empty track"
            className="flex items-center gap-1 text-[11px] font-semibold text-ink-dim hover:text-ink bg-surface-1 hover:bg-surface-3 border border-line px-2.5 py-1 rounded-full cursor-pointer transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>
      </div>

      {/* Track list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {tracks.length === 0 ? (
          <div className="text-center py-12 px-3 text-zinc-600">
            <Layers className="w-8 h-8 mx-auto mb-2 opacity-30 text-zinc-500" />
            <p className="text-xs font-medium text-zinc-400">No tracks yet</p>
            <p className="text-[11px] text-zinc-600 mt-1">Import audio or tap Add.</p>
          </div>
        ) : (
          tracks.map((track, idx) => {
            const isSelected = track.id === selectedTrackId;
            const label = getTrackLabel(track, idx);
            const isEditing = editingId === track.id;
            const empty = isTrackEmpty(track);
            return (
              <div
                key={track.id}
                onClick={() => onSelectTrack(track.id)}
                className={`group flex items-center gap-2 px-2 py-1.5 rounded-control border cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-surface-3 border-accent/50 text-ink'
                    : 'bg-surface-2 border-line text-ink-dim hover:bg-surface-3 hover:border-line-strong'
                }`}
              >
                {/* Colour box: the track number until the user gives the track a colour (optional) */}
                <ColorBox
                  value={track.color ?? null}
                  label={String(idx + 1)}
                  ariaLabel={`${label} colour`}
                  title={track.color ? 'Track colour (click to change, double-click to clear)' : 'Give this track a colour (optional)'}
                  onChange={(hex) => onUpdateTrack(track.id, { color: hex })}
                  onClear={() => onUpdateTrack(track.id, { color: undefined })}
                />
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <input
                      ref={inputRef}
                      value={draft}
                      maxLength={60}
                      autoFocus
                      aria-label="Track name"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitEdit(track, label)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit(track, label);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="w-full bg-surface-3 border border-accent/60 rounded-control px-2 py-0.5 text-xs text-ink font-semibold focus:outline-none"
                    />
                  ) : (
                    <div
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startEdit(track, label);
                      }}
                      title="Double-click to rename"
                      className="text-xs font-semibold truncate group-hover:text-ink"
                    >
                      {label}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-[10px] font-num text-ink-faint truncate">
                    {empty ? (
                      <span className="text-warn font-semibold">Empty</span>
                    ) : (
                      <span>
                        {track.clips.length} {track.clips.length === 1 ? 'clip' : 'clips'} · {formatTrackLength(trackEndSeconds(track.clips))}
                      </span>
                    )}
                    {track.muted && <span className="text-danger font-semibold">Muted</span>}
                    {track.solo && <span className="text-warn font-semibold">Solo</span>}
                  </div>
                  {(() => {
                    const picked = selectedClipIds ? track.clips.filter((c) => selectedClipIds.has(c.id)) : [];
                    if (picked.length === 0) return null;
                    return (
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-accent">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                        {picked.length === 1 ? (
                          <HoverTitle text={displayTitle(picked[0].name)} maxChars={24} className="font-semibold" />
                        ) : (
                          <span className="font-semibold">{picked.length} clips selected</span>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Row actions: always visible on touch, shown on hover or focus with a mouse */}
                <div className="flex items-center shrink-0 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={(e) => { e.stopPropagation(); onMoveTrack(track.id, 'up'); }}
                    title="Move up"
                    aria-label="Move track up"
                    className="flex h-6 w-6 items-center justify-center rounded-control text-ink-dim hover:text-accent hover:bg-surface-1 disabled:opacity-20 disabled:pointer-events-none cursor-pointer"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx >= tracks.length - 1}
                    onClick={(e) => { e.stopPropagation(); onMoveTrack(track.id, 'down'); }}
                    title="Move down"
                    aria-label="Move track down"
                    className="flex h-6 w-6 items-center justify-center rounded-control text-ink-dim hover:text-accent hover:bg-surface-1 disabled:opacity-20 disabled:pointer-events-none cursor-pointer"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); startEdit(track, label); }}
                    title="Rename"
                    aria-label="Rename track"
                    className="flex h-6 w-6 items-center justify-center rounded-control text-ink-dim hover:text-accent hover:bg-surface-1 cursor-pointer"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDeleteTrack(track.id); }}
                    title="Delete track"
                    aria-label="Delete track"
                    className="flex h-6 w-6 items-center justify-center rounded-control text-ink-dim hover:text-danger hover:bg-danger/10 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
      {footer}
    </div>
  );
};
