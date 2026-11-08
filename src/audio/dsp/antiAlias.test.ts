import { describe, expect, it } from 'vitest';
import { PitchShiftStage } from './wsolaStream';
import { AntiAliasFilter, antiAliasCorner } from './antiAlias';
import { resampleChannel } from './wsola';

const SR = 48000;
const tone = (hz: number, seconds: number, amp = 0.5) => Float32Array.from({ length: Math.round(SR * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const rms = (x: Float32Array, from: number, to: number) => { let e = 0; for (let i = from; i < to; i++) e += x[i] * x[i]; return Math.sqrt(e / (to - from)); };

describe('pitching up filters first', () => {
  it('only pitching up is filtered', () => {
    expect(antiAliasCorner(1)).toBeNull();
    expect(antiAliasCorner(0.5)).toBeNull();
    expect(antiAliasCorner(2)).toBeCloseTo(0.45);
  });
  it('the filter passes the band below its corner and removes what is far above it', () => {
    const f = new AntiAliasFilter(0.45); // corner 10.8 kHz
    const low = f.process(tone(2000, 1)); // well below
    expect(rms(low, SR / 2, SR) / rms(tone(2000, 1), SR / 2, SR)).toBeGreaterThan(0.97);
    const high = new AntiAliasFilter(0.45).process(tone(19000, 1));
    expect(rms(high, SR / 2, SR) / 0.3536).toBeLessThan(0.01); // at least 40 dB down
  });
  it('an octave up no longer turns a 19 kHz component into a 5 kHz alias', () => {
    // x2 resample: 19 kHz would fold to 48 - 38 = 10 kHz; with the filter it is gone
    const y = resampleChannel(tone(19000, 1), 2);
    expect(rms(y, 4000, 20000)).toBeLessThan(0.01);
  });
  it('a 440 Hz tone still shifts up an octave with its level intact', () => {
    const s = new PitchShiftStage(SR * 3, 12, SR);
    const a = s.push(tone(440, 3));
    const b = s.finish();
    const y = new Float32Array(a.length + b.length); y.set(a); y.set(b, a.length);
    expect(rms(y, SR, SR * 2)).toBeGreaterThan(0.33); // 0.5 amplitude tone is 0.354 rms
    expect(rms(y, SR, SR * 2)).toBeLessThan(0.38);
  });
});
