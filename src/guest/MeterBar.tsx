import React, { useCallback, useState } from 'react';
import { FLOOR_DB, METER_START, RED_DB, YELLOW_DB, blockInfo, meterAdvice, meterPos, nextMeter, toDb, type BlockInfo, type MeterState } from './levelMeter';

/** State for the live meter. Feed it from the capture handlers (`onInfo`), and call `reset` when recording starts or stops. */
export const useMeter = () => {
  const [s, set] = useState<MeterState>(METER_START);
  const onInfo = useCallback((i: BlockInfo) => set((p) => nextMeter(p, i, performance.now())), []);
  const reset = useCallback(() => set(METER_START), []);
  return { state: s, onInfo, reset };
};
export { blockInfo };

const pct = (db: number) => `${((db - FLOOR_DB) / -FLOOR_DB) * 100}%`;

const PILL = { clip: 'bg-danger text-white', hot: 'bg-warn text-[#1a1300]', pop: 'bg-warn text-[#1a1300]' } as const;

/**
 * One slim row: a level bar in decibels with fixed zones (green, yellow from -18 dB, red from -6 dB) and a tick that holds the
 * recent peak, then a label that stays "Level" until something needs fixing: "Clipping: step back", "Peaking: step back"
 * or "Plosive: step back". Slim enough to sit above the script while recording.
 */
export const LevelMeter: React.FC<{ state: MeterState; className?: string }> = ({ state, className = '' }) => {
  const advice = meterAdvice(state, performance.now());
  const db = toDb(state.peak);
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div role="meter" aria-label="Input level" aria-valuemin={FLOOR_DB} aria-valuemax={0} aria-valuenow={Math.round(Math.max(FLOOR_DB, db))} aria-valuetext={`${Math.round(Math.max(FLOOR_DB, db))} decibels`} className="relative h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
        {/* zones sit behind the signal so the person can see how close to red they are */}
        <div className="absolute inset-y-0 left-0 bg-ok/25" style={{ width: pct(YELLOW_DB) }} />
        <div className="absolute inset-y-0 bg-warn/25" style={{ left: pct(YELLOW_DB), width: `calc(${pct(RED_DB)} - ${pct(YELLOW_DB)})` }} />
        <div className="absolute inset-y-0 right-0 bg-danger/25" style={{ left: pct(RED_DB) }} />
        <div className={`absolute inset-y-0 left-0 ${db >= RED_DB ? 'bg-danger' : db >= YELLOW_DB ? 'bg-warn' : 'bg-ok'}`} style={{ width: `${meterPos(state.peak) * 100}%`, transition: 'width 60ms linear' }} />
        {state.hold > 0 && <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${meterPos(state.hold) * 100}%` }} aria-hidden />}
      </div>
      <span role="status" aria-live="polite" className={`w-40 shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-center text-xs font-bold ${advice ? PILL[advice.kind] : 'bg-surface-3 text-ink-faint'}`}>{advice ? advice.text : 'Level'}</span>
    </div>
  );
};
