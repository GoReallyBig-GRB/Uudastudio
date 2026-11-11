import React, { useCallback, useRef, useState } from 'react';
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
const ADVICE_CLS = { clip: 'text-danger', hot: 'text-warn', pop: 'text-warn' } as const;

/**
 * Level bar in decibels with fixed zones (green, yellow from -18 dB, red from -6 dB), a tick that holds the recent peak,
 * a CLIP lamp, and one line of advice when the sound is peaking or a plosive was heard.
 */
export const LevelMeter: React.FC<{ state: MeterState; className?: string }> = ({ state, className = '' }) => {
  const now = performance.now();
  const advice = meterAdvice(state, now);
  const clipping = now - state.clipAt < 2500;
  const lastAdvice = useRef<string>('');
  if (advice) lastAdvice.current = advice.text;
  const db = toDb(state.peak);
  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <div role="meter" aria-label="Input level" aria-valuemin={FLOOR_DB} aria-valuemax={0} aria-valuenow={Math.round(Math.max(FLOOR_DB, db))} aria-valuetext={`${Math.round(Math.max(FLOOR_DB, db))} decibels`} className="relative h-3 flex-1 overflow-hidden rounded-full bg-surface-3">
          {/* zones sit behind the signal so the person can see how close to red they are */}
          <div className="absolute inset-y-0 left-0 bg-ok/25" style={{ width: pct(YELLOW_DB) }} />
          <div className="absolute inset-y-0 bg-warn/25" style={{ left: pct(YELLOW_DB), width: `calc(${pct(RED_DB)} - ${pct(YELLOW_DB)})` }} />
          <div className="absolute inset-y-0 right-0 bg-danger/25" style={{ left: pct(RED_DB) }} />
          <div className={`absolute inset-y-0 left-0 ${db >= RED_DB ? 'bg-danger' : db >= YELLOW_DB ? 'bg-warn' : 'bg-ok'}`} style={{ width: `${meterPos(state.peak) * 100}%`, transition: 'width 60ms linear' }} />
          {state.hold > 0 && <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${meterPos(state.hold) * 100}%` }} aria-hidden />}
        </div>
        <span className={`w-10 shrink-0 rounded-full px-1.5 text-center text-[10px] font-bold tracking-wide ${clipping ? 'bg-danger text-white' : 'bg-surface-3 text-ink-faint'}`} aria-hidden={!clipping}>CLIP</span>
      </div>
      <div role="status" aria-live="polite" className={`mt-1.5 min-h-8 text-xs leading-4 ${advice ? ADVICE_CLS[advice.kind] : 'text-ink-faint'}`}>
        {advice ? advice.text : 'Speak at a level that stays in the green and yellow.'}
      </div>
    </div>
  );
};
