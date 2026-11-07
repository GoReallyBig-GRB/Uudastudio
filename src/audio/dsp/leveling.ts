/**
 * Level tools that run on audio of any length: loudness measuring, Normalize, Even out levels, and the one-step Enhance chain.
 * Everything keeps its state from block to block, so streaming a clip in pieces gives the same samples as one pass over it.
 * No browser APIs here.
 *
 * Normalize works the way mastering engineers do it: MEASURE the whole piece first, then apply ONE constant gain so the
 * result lands on the target (peak, or integrated loudness), never turning peaks above the ceiling. Evening out the highs and
 * lows is a separate, slow gain rider ("leveler") that keeps a steady loudness without pumping.
 */
import type { MultiStage } from '../chunkedProcess';
import { CompressorStage } from './compressorStream';

// ---------- filters (RBJ cookbook) ----------

export class Biquad {
  private z1 = 0;
  private z2 = 0;
  constructor(private readonly b0: number, private readonly b1: number, private readonly b2: number, private readonly a1: number, private readonly a2: number) {}
  run(x: Float32Array, out: Float32Array = new Float32Array(x.length)): Float32Array {
    const { b0, b1, b2, a1, a2 } = this;
    let z1 = this.z1;
    let z2 = this.z2;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const y = b0 * v + z1;
      z1 = b1 * v - a1 * y + z2;
      z2 = b2 * v - a2 * y;
      out[i] = y;
    }
    // Flush tiny numbers so a long silence does not slow the filter down
    this.z1 = Math.abs(z1) < 1e-20 ? 0 : z1;
    this.z2 = Math.abs(z2) < 1e-20 ? 0 : z2;
    return out;
  }
}

const make = (b0: number, b1: number, b2: number, a0: number, a1: number, a2: number) => new Biquad(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);

export const highpass = (sr: number, f: number, q = Math.SQRT1_2): Biquad => {
  const w = (2 * Math.PI * f) / sr; const c = Math.cos(w); const al = Math.sin(w) / (2 * q);
  return make((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
};
export const peaking = (sr: number, f: number, gainDb: number, q = 1): Biquad => {
  const A = Math.pow(10, gainDb / 40); const w = (2 * Math.PI * f) / sr; const c = Math.cos(w); const al = Math.sin(w) / (2 * q);
  return make(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A);
};
export const lowShelf = (sr: number, f: number, gainDb: number): Biquad => {
  const A = Math.pow(10, gainDb / 40); const w = (2 * Math.PI * f) / sr; const c = Math.cos(w); const al = (Math.sin(w) / 2) * Math.SQRT2; const t = 2 * Math.sqrt(A) * al;
  return make(A * (A + 1 - (A - 1) * c + t), 2 * A * (A - 1 - (A + 1) * c), A * (A + 1 - (A - 1) * c - t), A + 1 + (A - 1) * c + t, -2 * (A - 1 + (A + 1) * c), A + 1 + (A - 1) * c - t);
};
export const highShelf = (sr: number, f: number, gainDb: number): Biquad => {
  const A = Math.pow(10, gainDb / 40); const w = (2 * Math.PI * f) / sr; const c = Math.cos(w); const al = (Math.sin(w) / 2) * Math.SQRT2; const t = 2 * Math.sqrt(A) * al;
  return make(A * (A + 1 + (A - 1) * c + t), -2 * A * (A - 1 + (A + 1) * c), A * (A + 1 + (A - 1) * c - t), A + 1 - (A - 1) * c + t, 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - t);
};

// ---------- measuring ----------

export interface Measurement {
  /** Highest absolute sample, linear */
  peak: number;
  /** Integrated loudness in dB (a simplified ITU-R BS.1770: K-weighting, 400 ms blocks, -70 absolute and -10 relative gates). -Infinity when silent */
  loudnessDb: number;
}

const BLOCK_SECONDS = 0.4;
const STEP_SECONDS = 0.1;

export class LoudnessMeter {
  private readonly filters: Biquad[][] = [];
  private readonly step: number;
  private stepEnergy = 0;
  private stepCount = 0;
  private readonly steps: number[] = [];
  private peak = 0;
  constructor(private readonly sampleRate: number) {
    this.step = Math.max(1, Math.round(STEP_SECONDS * sampleRate));
  }
  push(chunk: Float32Array[]): void {
    const n = chunk[0]?.length ?? 0;
    if (n === 0) return;
    while (this.filters.length < chunk.length) this.filters.push([highShelf(this.sampleRate, 1681, 4), highpass(this.sampleRate, 38, 0.5)]);
    const weighted = chunk.map((ch, c) => {
      let pk = this.peak;
      for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > pk) pk = a; }
      this.peak = pk;
      return this.filters[c][1].run(this.filters[c][0].run(ch));
    });
    for (let i = 0; i < n; i++) {
      let e = 0;
      for (const w of weighted) e += w[i] * w[i];
      this.stepEnergy += e;
      if (++this.stepCount === this.step) {
        this.steps.push(this.stepEnergy / this.step);
        this.stepEnergy = 0;
        this.stepCount = 0;
      }
    }
  }
  result(): Measurement {
    const per = Math.round(BLOCK_SECONDS / STEP_SECONDS);
    const blocks: number[] = [];
    if (this.steps.length >= per) {
      let sum = 0;
      for (let i = 0; i < this.steps.length; i++) {
        sum += this.steps[i];
        if (i >= per) sum -= this.steps[i - per];
        if (i >= per - 1) blocks.push(sum / per);
      }
    } else if (this.steps.length > 0) {
      blocks.push(this.steps.reduce((a, b) => a + b, 0) / this.steps.length);
    }
    const lufs = (e: number) => -0.691 + 10 * Math.log10(e);
    const above = blocks.filter((e) => e > 0 && lufs(e) > -70);
    if (above.length === 0) return { peak: this.peak, loudnessDb: -Infinity };
    const rel = lufs(above.reduce((a, b) => a + b, 0) / above.length) - 10;
    const gated = above.filter((e) => lufs(e) > rel);
    return { peak: this.peak, loudnessDb: lufs(gated.reduce((a, b) => a + b, 0) / gated.length) };
  }
}

export const MAX_NORMALIZE_GAIN_DB = 36;

export type NormalizeTarget = { mode: 'peak'; peakDb: number } | { mode: 'loudness'; loudnessDb: number; ceilingDb: number };

export interface NormalizePlan {
  gainDb: number;
  /** The loudness mode was held back so peaks stay under the ceiling */
  limitedByPeaks: boolean;
  /** What the result will measure: peak in dBFS and loudness in dB (LUFS-style) */
  resultPeakDb: number;
  resultLoudnessDb: number;
  silent: boolean;
}

/** The single gain that brings `m` onto the target. Never above the ceiling, never more than MAX_NORMALIZE_GAIN_DB. */
export const planNormalize = (m: Measurement, target: NormalizeTarget): NormalizePlan => {
  const peakDb = m.peak > 0 ? 20 * Math.log10(m.peak) : -Infinity;
  if (!Number.isFinite(peakDb) || m.peak < 1e-6) return { gainDb: 0, limitedByPeaks: false, resultPeakDb: -Infinity, resultLoudnessDb: -Infinity, silent: true };
  const ceiling = target.mode === 'peak' ? target.peakDb : target.ceilingDb;
  const toPeak = ceiling - peakDb;
  let gain = toPeak;
  let limited = false;
  if (target.mode === 'loudness' && Number.isFinite(m.loudnessDb)) {
    const toLoud = target.loudnessDb - m.loudnessDb;
    if (toLoud > toPeak) limited = true;
    gain = Math.min(toLoud, toPeak);
  }
  gain = Math.max(-60, Math.min(MAX_NORMALIZE_GAIN_DB, gain));
  return { gainDb: gain, limitedByPeaks: limited, resultPeakDb: peakDb + gain, resultLoudnessDb: m.loudnessDb + gain, silent: false };
};

// ---------- gain riding ----------

export interface LevelerSettings {
  /** The steady loudness to aim for, dBFS (RMS over about 0.4 s) */
  targetDb: number;
  /** 0 to 1: how much of the difference to the target is corrected */
  amount: number;
  /** Most it will turn things down / up, dB */
  maxCutDb: number;
  maxBoostDb: number;
}

const STEP_MS = 10;
const GATE_DB = -52;

/** Slow automatic gain: raises quiet stretches and lowers loud ones toward a steady level, holding still during silence. */
export class LevelerStage implements MultiStage {
  private readonly stepFrames: number;
  private readonly k: number;
  private readonly down: number;
  private readonly up: number;
  private ms = 0;
  private inStep = 0;
  private gDb = 0;
  private gFrom = 1;
  private gTo = 1;
  private started = false;
  constructor(sampleRate: number, private readonly s: LevelerSettings) {
    this.stepFrames = Math.max(1, Math.round((STEP_MS / 1000) * sampleRate));
    this.k = 1 - Math.exp(-1 / (0.4 * sampleRate));
    this.down = 1 - Math.exp(-STEP_MS / 1000 / 0.6);
    this.up = 1 - Math.exp(-STEP_MS / 1000 / 2.5);
  }
  push(chunk: Float32Array[]): Float32Array[] {
    const n = chunk[0]?.length ?? 0;
    const out = chunk.map(() => new Float32Array(n));
    const chs = chunk.length;
    const { stepFrames, k, s } = this;
    let ms = this.ms; let inStep = this.inStep; let gFrom = this.gFrom; let gTo = this.gTo; let gDb = this.gDb;
    for (let i = 0; i < n; i++) {
      let e = 0;
      for (let c = 0; c < chs; c++) e += chunk[c][i] * chunk[c][i];
      ms += (e / chs - ms) * k;
      const g = gFrom + ((gTo - gFrom) * inStep) / stepFrames;
      for (let c = 0; c < chs; c++) out[c][i] = chunk[c][i] * g;
      if (++inStep === stepFrames) {
        inStep = 0;
        const level = ms > 1e-12 ? 10 * Math.log10(ms) : -120;
        if (level > GATE_DB) {
          const want = Math.max(-s.maxCutDb, Math.min(s.maxBoostDb, (s.targetDb - level))) * s.amount;
          gDb += (want - gDb) * (want < gDb ? this.down : this.up);
        }
        gFrom = gTo;
        gTo = Math.pow(10, gDb / 20);
      }
    }
    this.ms = ms; this.inStep = inStep; this.gFrom = gFrom; this.gTo = gTo; this.gDb = gDb;
    this.started = true;
    return out;
  }
  finish(): Float32Array[] { return []; }
  get running() { return this.started; }
}

// ---------- peak limiter ----------

/** Look-ahead limiter: nothing leaves above the ceiling, and the gain eases down before a peak arrives. */
export class LimiterStage implements MultiStage {
  private readonly L: number;
  private readonly ceiling: number;
  private rings: Float32Array[] = [];
  private pos = 0;
  /** monotonic window-minimum of the required gain over the last L+1 input samples */
  private readonly dqIdx: Float64Array;
  private readonly dqVal: Float64Array;
  private head = 0;
  private tail = 0;
  private time = 0;
  private readonly mins: Float32Array;
  private minPos = 0;
  private sum = 0;
  private skip: number;
  constructor(sampleRate: number, ceilingDb: number) {
    this.L = Math.max(2, Math.round(0.002 * sampleRate));
    this.ceiling = Math.pow(10, ceilingDb / 20);
    this.skip = this.L;
    const cap = this.L + 2;
    this.dqIdx = new Float64Array(cap);
    this.dqVal = new Float64Array(cap);
    this.mins = new Float32Array(this.L + 1).fill(1);
    this.sum = this.L + 1;
  }
  private run(input: Float32Array[]): Float32Array[] {
    const n = input[0]?.length ?? 0;
    const chs = input.length;
    if (this.rings.length === 0) this.rings = input.map(() => new Float32Array(this.L));
    const out = input.map(() => new Float32Array(n));
    const { L, ceiling, dqIdx, dqVal, mins, rings } = this;
    const cap = dqIdx.length;
    let { pos, head, tail, time, minPos, sum } = this;
    for (let i = 0; i < n; i++) {
      let a = 0;
      for (let c = 0; c < chs; c++) { const v = Math.abs(input[c][i]); if (v > a) a = v; }
      const r = a > ceiling ? ceiling / a : 1;
      // slide the window minimum
      while (tail !== head && dqVal[(tail - 1 + cap) % cap] >= r) tail = (tail - 1 + cap) % cap;
      dqIdx[tail] = time; dqVal[tail] = r; tail = (tail + 1) % cap;
      while (dqIdx[head] <= time - (L + 1)) head = (head + 1) % cap;
      const m = dqVal[head];
      sum += m - mins[minPos];
      mins[minPos] = m;
      minPos = minPos + 1 === L + 1 ? 0 : minPos + 1;
      const g = sum / (L + 1);
      for (let c = 0; c < chs; c++) {
        const ring = rings[c];
        // the sample that entered L samples ago, delayed so the gain has already started to fall
        out[c][i] = ring[pos] * g;
        ring[pos] = input[c][i];
      }
      pos = pos + 1 === L ? 0 : pos + 1;
      time++;
    }
    this.pos = pos; this.head = head; this.tail = tail; this.time = time; this.minPos = minPos; this.sum = sum;
    return out;
  }
  private dropLead(out: Float32Array[]): Float32Array[] {
    if (this.skip <= 0) return out;
    const cut = Math.min(this.skip, out[0]?.length ?? 0);
    this.skip -= cut;
    return out.map((o) => o.subarray(cut));
  }
  push(chunk: Float32Array[]): Float32Array[] { return this.dropLead(this.run(chunk)); }
  finish(): Float32Array[] {
    if (this.rings.length === 0) return [];
    return this.dropLead(this.run(this.rings.map(() => new Float32Array(this.L))));
  }
}

// ---------- chains ----------

export class Chain {
  constructor(private readonly stages: { push(c: Float32Array[]): Float32Array[]; finish(): Float32Array[] }[]) {}
  push(chunk: Float32Array[]): Float32Array[] {
    let cur = chunk;
    for (const st of this.stages) cur = st.push(cur);
    return cur;
  }
  finish(): Float32Array[] {
    let carried: Float32Array[] = [];
    for (const st of this.stages) {
      const fed = carried[0]?.length ? st.push(carried) : [];
      const rest = st.finish();
      carried = fed[0]?.length ? (rest[0]?.length ? fed.map((f, c) => concat(f, rest[c])) : fed) : rest;
    }
    return carried;
  }
}
const concat = (a: Float32Array, b: Float32Array): Float32Array => { const o = new Float32Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };

/** Runs a filter on every channel of a block */
class FilterStage implements MultiStage {
  private readonly per: Biquad[][] = [];
  constructor(private readonly make: () => Biquad[]) {}
  push(chunk: Float32Array[]): Float32Array[] {
    while (this.per.length < chunk.length) this.per.push(this.make());
    return chunk.map((ch, c) => this.per[c].reduce((x, f) => f.run(x), ch));
  }
  finish(): Float32Array[] { return []; }
}

export interface EnhanceSettings {
  /** 0 to 1: how strongly to clean and level (0.6 is the default) */
  strength: number;
  /** Aim for this loudness, dBFS RMS, after levelling */
  targetDb: number;
}

export const DEFAULT_ENHANCE: EnhanceSettings = { strength: 0.6, targetDb: -20 };

/**
 * One step for any recording: take out rumble below the voice, ease the muddy low-mids, add a little presence and air, tame
 * the loud parts with a gentle compressor, even out the quiet and loud stretches, then stop peaks at -1 dBFS.
 * (Hiss is not touched here: Denoise with a noise sample does that far better.)
 */
export const buildEnhanceChain = (sampleRate: number, s: EnhanceSettings): Chain => {
  const k = Math.max(0, Math.min(1, s.strength));
  return new Chain([
    new FilterStage(() => [highpass(sampleRate, 80, Math.SQRT1_2), highpass(sampleRate, 80, Math.SQRT1_2), peaking(sampleRate, 250, -2.5 * k, 1), peaking(sampleRate, 3200, 2.5 * k, 0.9), highShelf(sampleRate, 9000, 2 * k)]),
    new CompressorStage(sampleRate, { thresholdDb: -26, kneeDb: 12, ratio: 1 + 2.5 * k, attackMs: 12, releaseMs: 160, makeupGainDb: 0 }),
    new LevelerStage(sampleRate, { targetDb: s.targetDb, amount: 0.4 + 0.6 * k, maxCutDb: 12, maxBoostDb: 18 }),
    new LimiterStage(sampleRate, -1),
  ]);
};

export interface EvenOutSettings {
  /** 0 to 1 */
  amount: number;
  targetDb: number;
  ceilingDb: number;
}

/** Normalize's "even out highs and lows": the slow leveler, then a limiter so a boost can never clip. */
export const buildEvenOutChain = (sampleRate: number, s: EvenOutSettings): Chain =>
  new Chain([
    new LevelerStage(sampleRate, { targetDb: s.targetDb, amount: Math.max(0, Math.min(1, s.amount)), maxCutDb: 15, maxBoostDb: 24 }),
    new LimiterStage(sampleRate, s.ceilingDb),
  ]);
