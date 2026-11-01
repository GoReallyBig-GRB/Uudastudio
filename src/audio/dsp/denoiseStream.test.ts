import { describe, expect, it } from 'vitest';
import type { DenoiseParams } from '../../types';
import { DenoiseStage, denoiseChannels } from './denoiseStream';

const SR = 44100;
const params: DenoiseParams = { highPassFreq: 80, noiseFloorThresholdDb: -40, reductionDb: 18, attackMs: 8, releaseMs: 90 };

/** Speech-like test signal: loud bursts with quiet noise between them */
const signal = (n: number): Float32Array => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff - 0.5; };
  return Float32Array.from({ length: n }, (_, i) => {
    const loud = Math.floor(i / 6000) % 2 === 0;
    return (loud ? 0.4 : 0.004) * Math.sin((2 * Math.PI * 300 * i) / SR) + 0.003 * rnd();
  });
};

/** The original whole-buffer algorithm, written out independently of the streaming class */
const reference = (data: Float32Array, p: DenoiseParams): Float32Array => {
  const f = Math.max(20, Math.min(500, p.highPassFreq));
  const w0 = (2 * Math.PI * f) / SR;
  const alpha = Math.sin(w0) / (2 * Math.pow(10, 0.707 / 20));
  const a0 = 1 + alpha;
  const c = { b0: (1 + Math.cos(w0)) / 2 / a0, b1: -(1 + Math.cos(w0)) / a0, a1: (-2 * Math.cos(w0)) / a0, a2: (1 - alpha) / a0 };
  let hp = Float64Array.from(data);
  for (let pass = 0; pass < 2; pass++) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const out = new Float64Array(hp.length);
    for (let i = 0; i < hp.length; i++) {
      const x = hp[i];
      const y = c.b0 * x + c.b1 * x1 + c.b0 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      out[i] = y;
    }
    hp = out;
  }
  const length = hp.length;
  const B = 512, H = 128;
  if (length <= B) return Float32Array.from(hp);
  const numBlocks = Math.max(1, Math.floor((length - B) / H));
  const thr = Math.pow(10, p.noiseFloorThresholdDb / 20);
  const maxAtt = Math.pow(10, -p.reductionDb / 20);
  const ac = Math.exp(-1 / (((p.attackMs ?? 8) / 1000) * (SR / H)));
  const rc = Math.exp(-1 / (((p.releaseMs ?? 90) / 1000) * (SR / H)));
  const win = Array.from({ length: B }, (_, i) => 0.5 * (1 - Math.cos((2 * Math.PI * i) / (B - 1))));
  const targets: number[] = [];
  for (let b = 0; b < numBlocks; b++) {
    let sumSq = 0, ws = 0;
    for (let i = 0; i < B; i++) { const s = hp[b * H + i]; sumSq += s * s * win[i]; ws += win[i]; }
    const rms = Math.sqrt(sumSq / (ws || 1));
    targets.push(rms < thr ? Math.max(maxAtt, Math.pow(Math.max(0.0001, rms / thr), 1.8)) : 1);
  }
  let sm = 1;
  const gains = targets.map((t) => { sm = t + (t > sm ? ac : rc) * (sm - t); return sm; });
  const out = Float32Array.from(hp);
  for (let b = 0; b < numBlocks; b++) {
    const g0 = gains[b];
    const g1 = b + 1 < numBlocks ? gains[b + 1] : g0;
    for (let i = 0; i < H; i++) out[b * H + i] = hp[b * H + i] * (g0 + (g1 - g0) * (i / H));
  }
  return out;
};

const stream = (input: Float32Array, chunk: number): Float32Array => {
  const st = new DenoiseStage(input.length, SR, params);
  const parts: Float32Array[] = [];
  for (let i = 0; i < input.length; i += chunk) {
    const size = chunk + (i % 4) * 53;
    parts.push(st.push(input.subarray(i, Math.min(input.length, i + size))));
    i += (i % 4) * 53;
  }
  parts.push(st.finish());
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

const worstDiff = (a: Float32Array, b: Float32Array) => {
  expect(a.length).toBe(b.length);
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
};

describe('denoise stage', () => {
  for (const n of [100, 512, 513, 700, 5000, 40001]) {
    it(`streamed output equals the whole-buffer algorithm for ${n} samples`, () => {
      const input = signal(n);
      expect(worstDiff(stream(input, 1000), reference(input, params))).toBeLessThan(1e-5);
      expect(worstDiff(stream(input, 97), reference(input, params))).toBeLessThan(1e-5);
    });
  }

  it('does not depend on how the audio is cut into pieces', () => {
    const input = signal(30000);
    expect(worstDiff(stream(input, 300), stream(input, 12000))).toBeLessThan(1e-6);
    expect(worstDiff(denoiseChannels([input], SR, params)[0], stream(input, 5000))).toBeLessThan(1e-6);
  });

  it('brings quiet passages down by about the set reduction and leaves loud ones', () => {
    const input = signal(24000);
    const out = stream(input, 4000);
    const level = (a: Float32Array, from: number, to: number) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / (to - from)); };
    const loudRatio = level(out, 2000, 5000) / level(input, 2000, 5000);
    const quietRatio = level(out, 10000, 11500) / level(input, 10000, 11500);
    expect(loudRatio > 0.9).toBe(true);
    expect(quietRatio < 0.5).toBe(true);
  });
});
