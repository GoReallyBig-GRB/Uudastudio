/**
 * X-PRO AUDIO - Tracks Sidebar Panel
 * Left panel docked list mirroring every track in the project session.
 */

import React from 'react';
import { Layers, Plus, Trash2, Volume2, VolumeX, ChevronUp, ChevronDown } from 'lucide-react';
import { Track } from '../types';

interface TrackListPanelProps {
  tracks: Track[];
  selectedTrackId: string | null;
  onSelectTrack: (trackId: string) => void;
  onDeleteTrack: (trackId: string) => void;
  onMoveTrack: (trackId: string, direction: 'up' | 'down') => void;
  onAddTrack: () => void;
}

export const TrackListPanel: React.FC<TrackListPanelProps> = ({
  tracks,
  selectedTrackId,
  onSelectTrack,
  onDeleteTrack,
  onMoveTrack,
  onAddTrack,
}) => {
  return (
    <div className="w-64 shrink-0 bg-[#0E0E12] border-r border-zinc-800/80 flex flex-col h-full select-none">
      {/* Header */}
      <div className="h-10 px-3.5 border-b border-zinc-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
            Tracks
          </span>
          <span className="text-[10px] mono-nums px-1.5 py-0.2 text-zinc-400 bg-zinc-800/80 rounded">
            {tracks.length}
          </span>
        </div>
        <button
          onClick={onAddTrack}
          title="Add New Empty Track"
          className="text-xs text-zinc-400 hover:text-cyan-300 hover:bg-zinc-800/60 p-1 rounded transition-colors flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="text-[11px] font-medium">Add</span>
        </button>
      </div>

      {/* Track items list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {tracks.length === 0 ? (
          <div className="text-center py-12 px-3 text-zinc-600">
            <Layers className="w-8 h-8 mx-auto mb-2 opacity-30 text-zinc-500" />
            <p className="text-xs font-medium text-zinc-400">No tracks in session</p>
            <p className="text-[11px] text-zinc-600 mt-1">
              Import an audio file or click Add to create a track.
            </p>
          </div>
        ) : (
          tracks.map((track, idx) => {
            const isSelected = track.id === selectedTrackId;
            return (
              <div
                key={track.id}
                onClick={() => onSelectTrack(track.id)}
                className={`group flex items-center justify-between p-2 rounded border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-[#181824] border-cyan-500/50 text-zinc-100 shadow-[0_0_10px_rgba(0,240,255,0.1)]'
                    : 'bg-[#121216] border-zinc-800/60 text-zinc-300 hover:bg-[#16161c] hover:border-zinc-700/60'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-[10px] font-mono text-zinc-500 w-3.5 text-right shrink-0">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold truncate group-hover:text-cyan-200">
                      {track.name}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-zinc-500 mt-0.5">
                      <span>{track.clips.length} {track.clips.length === 1 ? 'clip' : 'clips'}</span>
                      {track.muted && <span className="text-rose-400 font-semibold">Muted</span>}
                      {track.solo && <span className="text-amber-400 font-semibold">Solo</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <div className="flex flex-col -space-y-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveTrack(track.id, 'up');
                      }}
                      title="Move track row up"
                      className="text-zinc-500 hover:text-cyan-300 disabled:opacity-20 disabled:pointer-events-none p-0.5"
                    >
                      <ChevronUp className="w-2.5 h-2.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx >= tracks.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveTrack(track.id, 'down');
                      }}
                      title="Move track row down"
                      className="text-zinc-500 hover:text-cyan-300 disabled:opacity-20 disabled:pointer-events-none p-0.5"
                    >
                      <ChevronDown className="w-2.5 h-2.5" />
                    </button>
                  </div>
                  <span className="text-zinc-500">
                    {track.muted ? <VolumeX className="w-3 h-3 text-rose-400" /> : <Volume2 className="w-3 h-3" />}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteTrack(track.id);
                    }}
                    title="Delete track from project"
                    className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
