import { describe, expect, it } from 'vitest';
import { LevelerStage, LimiterStage, LoudnessMeter, buildEnhanceChain, planNormalize, buildEvenOutChain } from './leveling';

const SR = 44100;
const sine = (hz: number, sec: number, amp: number) => Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const db = (x: number) => 20 * Math.log10(x);
const rms = (a: Float32Array, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / (to - from)); };
const cat = (p: Float32Array[]) => { const o = new Float32Array(p.reduce((n, x) => n + x.length, 0)); let k = 0; for (const x of p) { o.set(x, k); k += x.length; } return o; };
const stream = async (st: { push(c: Float32Array[]): any; finish(): any }, x: Float32Array, block: number) => {
  const parts: Float32Array[] = [];
  for (let i = 0; i < x.length; i += block) parts.push((await st.push([x.subarray(i, Math.min(x.length, i + block))]))[0] ?? new Float32Array(0));
  parts.push((await st.finish())[0] ?? new Float32Array(0));
  return cat(parts);
};
const measure = (x: Float32Array) => { const m = new LoudnessMeter(SR); m.push([x]); return m.result(); };

describe('loudness meter', () => {
  it('reads +6 dB when the signal is doubled, and ignores digital silence', () => {
    const a = measure(sine(1000, 5, 0.1));
    const b = measure(sine(1000, 5, 0.2));
    expect(b.loudnessDb - a.loudnessDb).toBeCloseTo(6.02, 1);
    const withSilence = new Float32Array(SR * 10); withSilence.set(sine(1000, 5, 0.1));
    expect(Math.abs(measure(withSilence).loudnessDb - a.loudnessDb)).toBeLessThan(0.3);
    expect(b.peak).toBeCloseTo(0.2, 3);
  });
  it('a full-scale 1 kHz sine measures about -3 LUFS (mono-summed K-weighting)', () => {
    expect(measure(sine(1000, 5, 1)).loudnessDb).toBeGreaterThan(-4.5);
    expect(measure(sine(1000, 5, 1)).loudnessDb).toBeLessThan(-2);
  });
});

describe('normalize plan', () => {
  it('peak mode lands the peak on the target', () => {
    const m = measure(sine(500, 3, 0.25));
    const p = planNormalize(m, { mode: 'peak', peakDb: -1 });
    expect(p.resultPeakDb).toBeCloseTo(-1, 3);
  });
  it('loudness mode is held back by the peak ceiling and says so', () => {
    const x = sine(500, 3, 0.05); x[100] = 0.9;
    const p = planNormalize(measure(x), { mode: 'loudness', loudnessDb: -14, ceilingDb: -1 });
    expect(p.limitedByPeaks).toBe(true);
    expect(p.resultPeakDb).toBeLessThanOrEqual(-0.99);
  });
  it('silence gets no gain', () => {
    expect(planNormalize(measure(new Float32Array(SR)), { mode: 'peak', peakDb: -1 }).silent).toBe(true);
  });
});

describe('leveler', () => {
  const quietLoud = () => { const x = new Float32Array(SR * 40); x.set(sine(300, 20, 0.02)); x.set(sine(300, 20, 0.4), SR * 20); return x; };
  it('brings quiet and loud stretches much closer, and leaves silence silent', async () => {
    const x = quietLoud();
    const y = await stream(new LevelerStage(SR, { targetDb: -20, amount: 1, maxCutDb: 15, maxBoostDb: 24 }), x, 10000);
    const gap = (a: Float32Array) => db(rms(a, SR * 30, SR * 38)) - db(rms(a, SR * 10, SR * 18));
    expect(gap(x)).toBeGreaterThan(25);
    expect(gap(y)).toBeLessThan(10);
    const z = await stream(new LevelerStage(SR, { targetDb: -20, amount: 1, maxCutDb: 15, maxBoostDb: 24 }), new Float32Array(SR * 3), 5000);
    expect(rms(z)).toBe(0);
  });
  it('gives the same samples whatever the block size', async () => {
    const x = quietLoud().subarray(0, SR * 8);
    const mk = () => new LevelerStage(SR, { targetDb: -20, amount: 0.8, maxCutDb: 15, maxBoostDb: 24 });
    const a = await stream(mk(), x, 4410); const b = await stream(mk(), x, 33333);
    let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    expect(d).toBeLessThan(1e-6);
  });
});

describe('limiter', () => {
  it('never exceeds the ceiling, keeps length, and leaves quiet audio alone', async () => {
    const x = sine(200, 3, 1.8);
    const y = await stream(new LimiterStage(SR, -1), x, 7777);
    expect(y.length).toBe(x.length);
    let mx = 0; for (const v of y) mx = Math.max(mx, Math.abs(v));
    expect(mx).toBeLessThanOrEqual(Math.pow(10, -1 / 20) + 1e-4);
    const q = sine(200, 2, 0.1);
    const r = await stream(new LimiterStage(SR, -1), q, 5000);
    expect(r.length).toBe(q.length);
    expect(Math.abs(r[SR] - q[SR])).toBeLessThan(1e-5);
  });
});

describe('enhance chain', () => {
  it('removes rumble, keeps the voice band, keeps the length and the ceiling', async () => {
    const n = SR * 6;
    const rumble = sine(35, 6, 0.3); const voice = sine(1000, 6, 0.05);
    const mix = Float32Array.from({ length: n }, (_, i) => rumble[i] + voice[i]);
    const y = await stream(buildEnhanceChain(SR, { strength: 0.6, targetDb: -20 }), mix, 10000);
    expect(y.length).toBe(n);
    const band = (x: Float32Array, hz: number) => { let c = 0, s = 0; for (let i = SR * 2; i < SR * 5; i++) { c += x[i] * Math.cos((2 * Math.PI * hz * i) / SR); s += x[i] * Math.sin((2 * Math.PI * hz * i) / SR); } return Math.hypot(c, s) / (SR * 3) * 2; };
    expect(db(band(y, 35)) - db(band(mix, 35))).toBeLessThan(-15);
    let mx = 0; for (const v of y) mx = Math.max(mx, Math.abs(v));
    expect(mx).toBeLessThanOrEqual(0.9);
  });
  it('even-out chain evens levels and stays under its ceiling', async () => {
    const x = new Float32Array(SR * 30); x.set(sine(300, 15, 0.03)); x.set(sine(300, 15, 0.7), SR * 15);
    const y = await stream(buildEvenOutChain(SR, { amount: 1, targetDb: -18, ceilingDb: -1 }), x, 9000);
    expect(y.length).toBe(x.length);
    let mx = 0; for (const v of y) mx = Math.max(mx, Math.abs(v));
    expect(mx).toBeLessThanOrEqual(0.8914);
  });
});
