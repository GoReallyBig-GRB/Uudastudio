import { describe, expect, it } from 'vitest';
import { speedStretchParams, wsolaTimeStretch } from './wsola';
import { WsolaStretcher } from './wsolaStream';

const SR = 48000;
let seed = 11;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5;

/** RMS of the signal through a band-pass at f (skipping a second at each end) */
function bandRms(x: Float32Array, f: number, q = 1.2): number {
  const w0 = (2 * Math.PI * f) / SR, alpha = Math.sin(w0) / (2 * q), cw = Math.cos(w0);
  const b0 = alpha, b2 = -alpha, a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, e = 0, n = 0;
  for (let i = SR; i < x.length - SR; i++) {
    const y = (b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y; e += y * y; n++;
  }
  return Math.sqrt(e / n);
}
const db = (a: number, b: number) => 20 * Math.log10(a / b);

describe('stretching keeps the highs', () => {
  const noise = Float32Array.from({ length: SR * 6 }, () => rnd());
  for (const speed of [1.25, 1.5, 2]) {
    it(`noise at speed ${speed}: 4 kHz and 9 kHz stay within 1 dB of the original (they used to drop about 4 dB)`, () => {
      const y = wsolaTimeStretch(noise, speed, speedStretchParams(SR));
      expect(Math.abs(db(bandRms(y, 4000), bandRms(noise, 4000)))).toBeLessThan(1);
      expect(Math.abs(db(bandRms(y, 9000), bandRms(noise, 9000)))).toBeLessThan(1);
    });
  }
  it('a pure tone is not boosted (the highs are restored only where the frames did not line up)', () => {
    const tone = Float32Array.from({ length: SR * 6 }, (_, i) => 0.4 * Math.sin((2 * Math.PI * 3000 * i) / SR));
    const y = wsolaTimeStretch(tone, 1.5, speedStretchParams(SR));
    expect(Math.abs(db(bandRms(y, 3000), bandRms(tone, 3000)))).toBeLessThan(0.5);
  });
  it('the streamed result still equals the whole-buffer result', () => {
    const x = noise.subarray(0, SR * 3);
    const whole = wsolaTimeStretch(x, 1.5, speedStretchParams(SR));
    const s = new WsolaStretcher(x.length, 1.5, speedStretchParams(SR));
    const parts: Float32Array[] = [];
    for (let i = 0; i < x.length; i += 7000) parts.push(s.push(x.subarray(i, i + 7000)));
    parts.push(s.finish());
    const total = parts.reduce((n, p) => n + p.length, 0);
    expect(total).toBe(whole.length);
    let o = 0, maxDiff = 0;
    for (const p of parts) for (let i = 0; i < p.length; i++) maxDiff = Math.max(maxDiff, Math.abs(p[i] - whole[o++]));
    expect(maxDiff).toBeLessThan(1e-4);
  });
});

describe('the restore never causes clipping', () => {
  it('loud noise-like audio near full scale stays within full scale after a stretch', () => {
    const loud = Float32Array.from({ length: SR * 4 }, () => 1.9 * rnd()); // peaks about 0.95
    const y = wsolaTimeStretch(loud, 1.5, speedStretchParams(SR));
    let peak = 0;
    for (const v of y) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(1);
  });
});
