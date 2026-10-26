import { describe, it, expect } from 'vitest';
import { LoudnessMeter } from './loudnessMeter';

function synth(sr: number, secs: number) {
  const n = Math.floor(sr * secs); const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const env = 0.15 + 0.5 * Math.abs(Math.sin(i / sr * 0.7)) * (Math.floor(i / sr / 3) % 3 === 0 ? 0.1 : 1);
    L[i] = Math.sin(i * 0.05) * env; R[i] = Math.sin(i * 0.031 + 1) * env * 0.8;
  }
  return [L, R];
}
function measure(L: Float32Array, R: Float32Array, sr: number, nextStep: (k: number) => number) {
  const m = new LoudnessMeter(2, sr, L.length);
  let i = 0, k = 0;
  while (i < L.length) { const n = Math.min(nextStep(k++), L.length - i); m.push([L.subarray(i, i + n), R.subarray(i, i + n)], n); i += n; }
  return m.finish();
}

describe('LoudnessMeter', () => {
  it('gives the same result however the audio is cut into blocks', () => {
    const [L, R] = synth(48000, 25);
    const whole = measure(L, R, 48000, () => L.length);
    for (const step of [(k: number) => 1000, (k: number) => 48000 * 10, (k: number) => ((k * 7919) % 30011) + 1]) {
      expect(measure(L, R, 48000, step)).toEqual(whole);
    }
  });

  it('finds a known level: a stereo 0.5-amplitude 1 kHz tone reads about -6 LUFS', () => {
    const n = 48000 * 10; const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / 48000);
    const s = measure(x, x, 48000, () => n);
    expect(s.integratedLUFS).toBeGreaterThan(-7.5);
    expect(s.integratedLUFS).toBeLessThan(-5.0);
    expect(s.truePeakDbTP).toBeCloseTo(-6.0, 0);
  });

  it('silence and empty input are -70', () => {
    const z = new Float32Array(48000);
    expect(measure(z, z, 48000, () => 48000).integratedLUFS).toBe(-70);
    expect(new LoudnessMeter(2, 48000, 0).finish().integratedLUFS).toBe(-70);
  });
});
