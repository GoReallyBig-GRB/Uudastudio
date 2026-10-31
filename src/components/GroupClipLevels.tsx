/**
 * Uuda Studio - temporary clip levels for the group being mastered
 * Each clip of the soloed group gets a level slider. The levels are heard while auditioning and are applied to the export, but
 * they are not part of the project: they vanish when the group is released, the console closes or the export ends.
 */

import React from 'react';
import { RotateCcw, Info } from 'lucide-react';
import { displayTitle } from './clipTitle';
import { TEMP_LEVEL_MAX_DB, TEMP_LEVEL_MIN_DB, hasTempLevels, type TempClipLevels } from '../audio/tempClipLevels';

export interface LevelClip {
  id: string;
  name: string;
  trackLabel: string;
}

interface GroupClipLevelsProps {
  groupName: string;
  color: string;
  clips: LevelClip[];
  levels: TempClipLevels;
  onChange: (clipId: string, db: number) => void;
  onReset: () => void;
}

const fmt = (db: number): string => `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;

export const GroupClipLevels: React.FC<GroupClipLevelsProps> = ({ groupName, color, clips, levels, onChange, onReset }) => (
  <section className="shrink-0 max-h-[40%] overflow-y-auto overscroll-contain [scrollbar-width:thin] border-b border-line bg-surface-1 p-3" aria-label={`${groupName} clip levels`}>
    <div className="flex items-center gap-2 mb-1.5">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
      <h3 className="text-xs font-semibold text-ink truncate">{groupName}: clip levels</h3>
      <span className="text-[10px] font-num text-ink-faint">{clips.length} clips</span>
      <button
        type="button"
        onClick={onReset}
        disabled={!hasTempLevels(levels)}
        title="Put every clip back to 0 dB"
        className="ml-auto flex items-center gap-1 rounded-control border border-line px-2 py-1 text-[10px] font-medium text-ink-dim hover:text-ink hover:bg-surface-3 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
      >
        <RotateCcw className="w-3 h-3" />
        Reset
      </button>
    </div>
    <p className="flex items-start gap-1.5 text-[10px] leading-snug text-ink-faint mb-2">
      <Info className="w-3 h-3 shrink-0 mt-px" />
      <span>Temporary. Heard while you audition and applied to the export, never saved. They reset when the group is released, this console closes or the export ends.</span>
    </p>
    <div className="space-y-1.5">
      {clips.map((c) => {
        const db = levels[c.id] ?? 0;
        return (
          <div key={c.id} className="grid grid-cols-[minmax(0,1fr)_8rem_3.5rem] items-center gap-2">
            <div className="min-w-0">
              <div className="text-xs text-ink truncate" title={c.name}>{displayTitle(c.name)}</div>
              <div className="text-[10px] text-ink-faint truncate">{c.trackLabel}</div>
            </div>
            <input
              type="range"
              min={TEMP_LEVEL_MIN_DB}
              max={TEMP_LEVEL_MAX_DB}
              step={0.5}
              value={db}
              aria-label={`${displayTitle(c.name)} level`}
              onDoubleClick={() => onChange(c.id, 0)}
              onChange={(e) => onChange(c.id, parseFloat(e.target.value))}
              className="w-full h-4 cursor-pointer accent-accent"
            />
            <span className={`text-[10px] font-num text-right ${db === 0 ? 'text-ink-faint' : 'text-accent'}`}>{fmt(db)}</span>
          </div>
        );
      })}
    </div>
  </section>
);
