import { describe, expect, it } from 'vitest';
import type { CompressorParams } from '../../types';
import { AUTO_MAKEUP_SHARE, CompressorStage, LOOKAHEAD_SECONDS, compressChannels, gainReductionDb } from './compressorStream';

const SR = 44100;
const base: CompressorParams = { thresholdDb: -24, kneeDb: 0, ratio: 4, attackMs: 15, releaseMs: 180, makeupGainDb: 0 };
const sine = (n: number, amp: number, hz = 440) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const rms = (a: Float32Array, from: number, to: number) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / (to - from));
};
const db = (x: number) => 20 * Math.log10(x);
const autoDb = (p: CompressorParams) => -AUTO_MAKEUP_SHARE * gainReductionDb(0, p.thresholdDb, p.kneeDb, p.ratio);

const stream = (input: Float32Array[], params: CompressorParams, chunk: number): Float32Array[] => {
  const st = new CompressorStage(SR, params);
  const parts: Float32Array[][] = input.map(() => []);
  for (let i = 0; i < input[0].length; i += chunk) {
    const out = st.push(input.map((c) => c.subarray(i, Math.min(c.length, i + chunk + (i % 5) * 11))));
    out.forEach((o, c) => parts[c].push(o));
    i += (i % 5) * 11;
  }
  st.finish().forEach((o, c) => parts[c].push(o));
  return parts.map((p) => {
    const out = new Float32Array(p.reduce((n, x) => n + x.length, 0));
    let o = 0;
    for (const x of p) { out.set(x, o); o += x.length; }
    return out;
  });
};

describe('transfer curve', () => {
  it('does nothing below the threshold, follows the ratio above it', () => {
    expect(gainReductionDb(-40, -24, 0, 4)).toBe(0);
    expect(Math.abs(gainReductionDb(-12, -24, 0, 4) - (-9))).toBeLessThan(1e-9);
  });
  it('a soft knee eases in: no reduction at its lower edge, smooth through the threshold', () => {
    expect(gainReductionDb(-30, -24, 12, 4)).toBe(0);
    const atThreshold = gainReductionDb(-24, -24, 12, 4);
    expect(atThreshold).toBeLessThan(0);
    expect(Math.abs(atThreshold - (-1.125))).toBeLessThan(1e-9); // gentle at the threshold itself
    expect(Math.abs(gainReductionDb(-18, -24, 12, 4) - (-4.5))).toBeLessThan(1e-9); // knee top meets the straight line
  });
});

describe('compressor stage', () => {
  it('streamed in uneven pieces gives the same samples as the whole clip, stereo too', () => {
    const n = 30000;
    const l = sine(n, 0.7, 220).map((v, i) => v * (0.3 + 0.7 * Math.abs(Math.sin(i / 4000))));
    const r = sine(n, 0.2, 330);
    const whole = compressChannels([l, r], SR, base);
    for (const chunk of [100, 777, 9000]) {
      const piecewise = stream([l, r], base, chunk);
      expect(piecewise[0].length).toBe(n);
      let worst = 0;
      for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(piecewise[c][i] - whole[c][i]));
      expect(worst).toBeLessThan(1e-6);
    }
  });

  it('keeps the length, even for audio shorter than the lookahead', () => {
    for (const n of [1, 50, Math.round(LOOKAHEAD_SECONDS * SR), 5000]) {
      expect(compressChannels([sine(n, 0.5)], SR, base)[0].length).toBe(n);
    }
  });

  it('settles on the level the transfer curve asks for', () => {
    const input = sine(SR * 2, 0.5);
    const out = compressChannels([input], SR, base)[0];
    const measured = db(rms(out, SR, SR * 2)) - db(rms(input, SR, SR * 2));
    const expected = gainReductionDb(db(0.5), base.thresholdDb, base.kneeDb, base.ratio) + autoDb(base);
    expect(Math.abs(measured - expected)).toBeLessThan(1.2);
  });

  it('leaves quiet audio alone apart from the makeup gain', () => {
    const input = sine(SR, 0.01);
    const out = compressChannels([input], SR, base)[0];
    const measured = db(rms(out, 2000, SR - 2000)) - db(rms(input, 2000, SR - 2000));
    expect(Math.abs(measured - autoDb(base))).toBeLessThan(0.05);
  });

  it('lets the first moments of a loud burst through, then brings it down (attack)', () => {
    const n = SR;
    const input = new Float32Array(n);
    const burst = sine(SR / 2, 0.8);
    input.set(burst, SR / 4);
    const out = compressChannels([input], SR, { ...base, attackMs: 20 })[0];
    const start = SR / 4;
    const early = rms(out, start + 20, start + 220) / rms(input, start + 20, start + 220);
    const late = rms(out, start + SR / 2 - 3000, start + SR / 2 - 1000) / rms(input, start + SR / 2 - 3000, start + SR / 2 - 1000);
    expect(early).toBeGreaterThan(late * 1.3);
  });

  it('releases after the loud part so the quiet part after it comes back up', () => {
    const n = SR * 2;
    const input = new Float32Array(n);
    input.set(sine(SR / 2, 0.8), 0);
    input.set(sine(SR, 0.05), SR / 2);
    const out = compressChannels([input], SR, { ...base, thresholdDb: -30, releaseMs: 100, makeupGainDb: 0 })[0];
    const justAfter = rms(out, SR / 2 + 200, SR / 2 + 1200) / rms(input, SR / 2 + 200, SR / 2 + 1200);
    const later = rms(out, SR, SR + 4000) / rms(input, SR, SR + 4000);
    expect(later).toBeGreaterThan(justAfter);
  });

  it('links the channels: a loud left channel pulls the right one down too', () => {
    const l = sine(SR, 0.8, 200);
    const r = sine(SR, 0.05, 300);
    const out = compressChannels([l, r], SR, { ...base, makeupGainDb: 0 });
    const gainOnRight = db(rms(out[1], SR / 2, SR)) - db(rms(r, SR / 2, SR));
    expect(gainOnRight < autoDb(base) - 3).toBe(true);
  });

  it('with ratio 1 only the makeup gain is applied', () => {
    const input = sine(SR / 2, 0.6);
    const p = { ...base, ratio: 1, makeupGainDb: 6 };
    const out = compressChannels([input], SR, p)[0];
    const measured = db(rms(out, 1000, SR / 2 - 1000)) - db(rms(input, 1000, SR / 2 - 1000));
    expect(Math.abs(measured - 6)).toBeLessThan(0.05);
  });
});
