/**
 * Uuda Studio - Auto-duck controls for a track (voice over music).
 * Shown in the plugin rack for the targeted track. The track lowers itself whenever the chosen source tracks
 * (the voice) have signal. Sliders commit on release, so one drag is one undo step.
 */

import React, { useEffect, useState } from 'react';
import { ArrowDownToLine } from 'lucide-react';
import { Track } from '../../types';
import { DuckingSettings } from '../../types';
import { normalizeDucking } from '../../audio/ducking';
import { getTrackLabel } from '../../utils/tracks';
import { Switch, cn } from '../ui';

interface DuckingPanelProps {
  track: Track;
  /** Every track in the project, in order (labels come from position) */
  tracks: Track[];
  onChange: (updates: Partial<DuckingSettings>) => void;
}

interface SliderDef {
  key: 'thresholdDb' | 'amountDb' | 'attackMs' | 'holdMs' | 'releaseMs';
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}

const SLIDERS: SliderDef[] = [
  { key: 'thresholdDb', label: 'Voice level', min: -70, max: -6, step: 1, unit: 'dB' },
  { key: 'amountDb', label: 'Duck by', min: -40, max: 0, step: 1, unit: 'dB' },
  { key: 'attackMs', label: 'Attack', min: 1, max: 1000, step: 1, unit: 'ms' },
  { key: 'holdMs', label: 'Hold', min: 0, max: 3000, step: 10, unit: 'ms' },
  { key: 'releaseMs', label: 'Release', min: 10, max: 5000, step: 10, unit: 'ms' },
];

const DuckSlider: React.FC<{ def: SliderDef; value: number; onCommit: (v: number) => void }> = ({ def, value, onCommit }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <label className="block min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-ink-dim">{def.label}</span>
        <span className="font-num shrink-0 text-ink">
          {Math.round(draft)} {def.unit}
        </span>
      </div>
      <input
        type="range"
        aria-label={def.label}
        min={def.min}
        max={def.max}
        step={def.step}
        value={draft}
        onChange={(e) => setDraft(parseFloat(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="mt-1.5 w-full cursor-pointer"
      />
    </label>
  );
};

export const DuckingPanel: React.FC<DuckingPanelProps> = ({ track, tracks, onChange }) => {
  const s = normalizeDucking(track.ducking);
  const others = tracks.map((t, i) => ({ t, i })).filter(({ t }) => t.id !== track.id);
  const noSource = s.enabled && s.sourceTrackIds.length === 0;

  const toggleSource = (id: string) => {
    const next = s.sourceTrackIds.includes(id) ? s.sourceTrackIds.filter((x) => x !== id) : [...s.sourceTrackIds, id];
    onChange({ sourceTrackIds: next });
  };

  return (
    <section className="shrink-0 rounded-card border border-line bg-surface-2">
      <div className="flex items-center gap-3 px-3 py-2">
        <ArrowDownToLine className="h-4 w-4 shrink-0 text-ink-dim" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold text-ink">Auto duck</h3>
          <p className="truncate text-[11px] text-ink-faint">Lower this track when the voice speaks</p>
        </div>
        <Switch checked={s.enabled} onChange={(v) => onChange({ enabled: v })} label="Auto duck" hideLabel />
      </div>

      {s.enabled && (
        <div className="space-y-3 border-t border-line px-3 pb-3 pt-3">
          <div>
            <div className="mb-1.5 text-xs text-ink-dim">Duck when these tracks have sound</div>
            {others.length === 0 ? (
              <p className="text-xs text-ink-faint">Add the voice track first.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {others.map(({ t, i }) => {
                  const on = s.sourceTrackIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleSource(t.id)}
                      className={cn(
                        'h-7 max-w-full truncate rounded-full border px-3 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                        on ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line text-ink-dim hover:border-line-strong hover:text-ink',
                      )}
                    >
                      {getTrackLabel(t, i)}
                    </button>
                  );
                })}
              </div>
            )}
            {noSource && others.length > 0 && <p className="mt-1.5 text-xs text-warn">Pick at least one track, or nothing will duck.</p>}
          </div>

          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-x-4 gap-y-2.5">
            {SLIDERS.map((def) => (
              <DuckSlider key={def.key} def={def} value={s[def.key]} onCommit={(v) => onChange({ [def.key]: v })} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
