/** What the live level meter shows: a decibel scale with zones, and a guess at plosives ("pops" on P and B). Pure and unit-tested. */

export const FLOOR_DB = -60;
/** Green up to here, then yellow */
export const YELLOW_DB = -18;
/** Yellow up to here, then red ("peaking") */
export const RED_DB = -6;

export const toDb = (peak: number): number => 20 * Math.log10(Math.max(peak, 1e-6));
/** Position on the bar, 0..1, for a peak of 0..1 */
export const meterPos = (peak: number): number => Math.max(0, Math.min(1, (toDb(peak) - FLOOR_DB) / -FLOOR_DB));
export const zoneOf = (peak: number): 'ok' | 'warn' | 'danger' => { const d = toDb(peak); return d >= RED_DB ? 'danger' : d >= YELLOW_DB ? 'warn' : 'ok'; };

export interface BlockInfo { peak: number; plosive: boolean }

/**
 * A plosive is a burst of air on the microphone: loud, and almost all of it below about 100 Hz, where a voice has little.
 * Measured by splitting the block with a one-pole low-pass at 100 Hz and comparing energy.
 */
export const blockInfo = (x: Float32Array, sampleRate: number): BlockInfo => {
  let peak = 0, low = 0, all = 0, y = 0;
  const a = Math.exp((-2 * Math.PI * 100) / sampleRate);
  for (let i = 0; i < x.length; i++) {
    const v = x[i], av = Math.abs(v);
    if (av > peak) peak = av;
    y = a * y + (1 - a) * v;
    low += y * y; all += v * v;
  }
  return { peak, plosive: peak >= 0.25 && all > 0 && low / all > 0.75 };
};

export interface MeterState { peak: number; hold: number; holdAt: number; clipAt: number; hotAt: number; popAt: number }
export const METER_START: MeterState = { peak: 0, hold: 0, holdAt: 0, clipAt: -1e9, hotAt: -1e9, popAt: -1e9 };
const HOLD_MS = 1500;

/** Next state for a new block (`now` in ms). Keeps a peak-hold tick, and when clipping, near-clipping and a pop last happened. */
export const nextMeter = (s: MeterState, info: BlockInfo, now: number): MeterState => {
  const keep = now - s.holdAt < HOLD_MS && s.hold > info.peak;
  return {
    peak: info.peak,
    hold: keep ? s.hold : info.peak,
    holdAt: keep ? s.holdAt : now,
    clipAt: info.peak >= 0.99 ? now : s.clipAt,
    hotAt: toDb(info.peak) >= RED_DB ? now : s.hotAt,
    popAt: info.plosive ? now : s.popAt,
  };
};

export type MeterAdvice = { kind: 'clip' | 'hot' | 'pop'; text: string } | null;
const ADVICE_MS = 2500;
/** The one thing worth telling the person right now, most serious first */
export const meterAdvice = (s: MeterState, now: number): MeterAdvice => {
  if (now - s.clipAt < ADVICE_MS) return { kind: 'clip', text: 'Clipping. The sound is too loud and distorts. Step back from the microphone or lower its input level.' };
  if (now - s.popAt < ADVICE_MS) return { kind: 'pop', text: 'A pop on a P or B. Move back a hand-width, or speak slightly across the microphone.' };
  if (now - s.hotAt < ADVICE_MS) return { kind: 'hot', text: 'Peaking. Step back from the microphone a little.' };
  return null;
};
