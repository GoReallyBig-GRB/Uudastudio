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
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-zinc-400 truncate">{def.label}</span>
        <span className="font-mono text-cyan-300 shrink-0">
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
        className="w-full h-1.5 bg-zinc-800 rounded-sm accent-cyan-400 cursor-pointer"
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
    <section className="border border-zinc-800 rounded-md bg-[#0D0D14] shrink-0">
      <div className="flex items-center gap-3 px-3 py-2">
        <ArrowDownToLine className="w-4 h-4 text-emerald-400 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-black uppercase tracking-wide text-zinc-200">Auto duck</h3>
          <p className="text-[11px] text-zinc-500 truncate">Lower this track when the voice speaks</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={s.enabled}
          aria-label="Auto duck"
          onClick={() => onChange({ enabled: !s.enabled })}
          className={`relative w-10 h-5 rounded-full border shrink-0 cursor-pointer ${
            s.enabled ? 'bg-emerald-500/30 border-emerald-500' : 'bg-zinc-800 border-zinc-600'
          }`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full ${s.enabled ? 'left-5 bg-emerald-300' : 'left-0.5 bg-zinc-400'}`}
          />
        </button>
      </div>

      {s.enabled && (
        <div className="px-3 pb-3 space-y-3 border-t border-zinc-800 pt-3">
          <div>
            <div className="text-[11px] text-zinc-400 mb-1.5">Duck when these tracks have sound</div>
            {others.length === 0 ? (
              <p className="text-[11px] text-zinc-500">Add the voice track first.</p>
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
                      className={`px-2 py-1 rounded-sm text-[11px] font-bold border cursor-pointer max-w-full truncate ${
                        on
                          ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/60'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:text-zinc-200'
                      }`}
                    >
                      {getTrackLabel(t, i)}
                    </button>
                  );
                })}
              </div>
            )}
            {noSource && others.length > 0 && <p className="text-[11px] text-amber-400 mt-1.5">Pick at least one track, or nothing will duck.</p>}
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
