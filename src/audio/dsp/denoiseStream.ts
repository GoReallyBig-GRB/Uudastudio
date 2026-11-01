/**
 * The Basic Denoise processor as a streaming stage: a 24 dB/oct rumble cut followed by a gate that follows the loudness of
 * 512-sample windows (hop 128), with separate attack and release smoothing. All of its memory (filter state, smoothing, the
 * few hundred samples it looks ahead) is carried from block to block, so a clip processed in pieces comes out the same as a
 * clip processed whole (see denoiseStream.test.ts). Short clips use the same code. One stage per channel.
 */
import type { DenoiseParams } from '../../types';
import type { Stage } from './wsolaStream';
import { NoisePrintStage } from './noisePrint';

const BLOCK = 512;
const HOP = 128;

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Hann window for the loudness measurement */
const WINDOW = (() => {
  const w = new Float64Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (BLOCK - 1)));
  return w;
})();

interface Biquad {
  b0: number; b1: number; b2: number; a1: number; a2: number;
  x1: number; x2: number; y1: number; y2: number;
}

/** Second-order high-pass (Q 0.707 in dB, as the browser's filter reads it) */
const highpass = (freq: number, sampleRate: number): Biquad => {
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.pow(10, 0.707 / 20));
  const a0 = 1 + alpha;
  return { b0: (1 + cos) / 2 / a0, b1: -(1 + cos) / a0, b2: (1 + cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
};

const runBiquad = (f: Biquad, data: Float64Array): void => {
  let { x1, x2, y1, y2 } = f;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = f.b0 * x + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    data[i] = y;
  }
  f.x1 = x1; f.x2 = x2; f.y1 = y1; f.y2 = y2;
};

export class DenoiseStage implements Stage {
  private readonly hp1: Biquad;
  private readonly hp2: Biquad;
  private readonly numBlocks: number;
  private readonly thresholdLinear: number;
  private readonly maxAttenuation: number;
  private readonly attackCoeff: number;
  private readonly releaseCoeff: number;
  private weightSum = 0;

  private buf = new Float64Array(0); // filtered samples not yet emitted
  private base = 0; // absolute index of buf[0]
  private received = 0;
  private nextBlock = 0; // next window to measure
  private nextHop = 0; // next hop to emit
  private smoothed = 1;
  private gains: number[] = []; // smoothed gains of windows nextHop.. that are measured
  private emittedUpTo = 0;

  constructor(totalIn: number, sampleRate: number, params: DenoiseParams) {
    const hpFreq = Math.max(20, Math.min(500, num(params.highPassFreq, 80)));
    this.hp1 = highpass(hpFreq, sampleRate);
    this.hp2 = highpass(hpFreq, sampleRate);
    this.numBlocks = totalIn <= BLOCK ? 0 : Math.max(1, Math.floor((totalIn - BLOCK) / HOP));
    this.thresholdLinear = Math.pow(10, num(params.noiseFloorThresholdDb, -40) / 20);
    this.maxAttenuation = Math.pow(10, -num(params.reductionDb, 12) / 20);
    const attackMs = num(params.attackMs, 8);
    const releaseMs = num(params.releaseMs, 90);
    this.attackCoeff = Math.exp(-1 / ((attackMs / 1000) * (sampleRate / HOP)));
    this.releaseCoeff = Math.exp(-1 / ((releaseMs / 1000) * (sampleRate / HOP)));
    for (let i = 0; i < BLOCK; i++) this.weightSum += WINDOW[i];
  }

  private measure(b: number): number {
    const offset = b * HOP - this.base;
    let sumSq = 0;
    for (let i = 0; i < BLOCK; i++) {
      const s = this.buf[offset + i];
      sumSq += s * s * WINDOW[i];
    }
    const rms = Math.sqrt(sumSq / (this.weightSum || 1));
    let target = 1;
    if (rms < this.thresholdLinear) {
      const ratio = Math.max(0.0001, rms / this.thresholdLinear);
      target = Math.max(this.maxAttenuation, Math.pow(ratio, 1.8));
    }
    const coeff = target > this.smoothed ? this.attackCoeff : this.releaseCoeff;
    this.smoothed = target + coeff * (this.smoothed - target);
    return this.smoothed;
  }

  /** Everything that can be finalised with the samples received so far */
  private drain(): Float32Array {
    const pieces: Float32Array[] = [];
    // Measure every window whose samples have arrived
    while (this.nextBlock < this.numBlocks && this.nextBlock * HOP + BLOCK <= this.received) {
      this.gains.push(this.measure(this.nextBlock));
      this.nextBlock++;
    }
    // Emit every hop whose two gains are known
    while (this.nextHop < this.numBlocks) {
      const b = this.nextHop;
      const haveNext = b + 1 < this.numBlocks;
      if (this.gains.length < (haveNext ? 2 : 1)) break;
      const start = this.gains[0];
      const next = haveNext ? this.gains[1] : start;
      const piece = new Float32Array(HOP);
      const offset = b * HOP - this.base;
      for (let i = 0; i < HOP; i++) piece[i] = this.buf[offset + i] * (start + (next - start) * (i / HOP));
      pieces.push(piece);
      this.gains.shift();
      this.nextHop++;
      this.emittedUpTo = this.nextHop * HOP;
    }
    // Past the last window the audio passes through filtered only; with no gate at all, all of it does
    if (this.nextHop >= this.numBlocks && this.emittedUpTo < this.received) {
      const from = this.emittedUpTo - this.base;
      const rest = new Float32Array(this.received - this.emittedUpTo);
      for (let i = 0; i < rest.length; i++) rest[i] = this.buf[from + i];
      pieces.push(rest);
      this.emittedUpTo = this.received;
    }
    // Forget what is no longer needed
    const keepFrom = Math.min(this.emittedUpTo, this.nextBlock * HOP);
    const cut = keepFrom - this.base;
    if (cut > 0) {
      this.buf = this.buf.slice(cut);
      this.base = keepFrom;
    }
    const total = pieces.reduce((n, p) => n + p.length, 0);
    const result = new Float32Array(total);
    let o = 0;
    for (const p of pieces) { result.set(p, o); o += p.length; }
    return result;
  }

  push(chunk: Float32Array): Float32Array {
    if (chunk.length === 0) return new Float32Array(0);
    const filtered = new Float64Array(chunk);
    runBiquad(this.hp1, filtered);
    runBiquad(this.hp2, filtered);
    const joined = new Float64Array(this.buf.length + filtered.length);
    joined.set(this.buf, 0);
    joined.set(filtered, this.buf.length);
    this.buf = joined;
    this.received += filtered.length;
    return this.drain();
  }

  finish(): Float32Array {
    return this.drain();
  }
}

/** The stage for these settings: the noise print when one was learned, else the basic gate. */
export const makeDenoiseStage = (totalIn: number, sampleRate: number, params: DenoiseParams): Stage =>
  params.print
    ? new NoisePrintStage(totalIn, sampleRate, params.print, { reductionDb: num(params.reductionDb, 14), sensitivity: num(params.sensitivity, 1.5) })
    : new DenoiseStage(totalIn, sampleRate, params);

/** The whole clip at once (same code and result as streaming it). */
export const denoiseChannels = (channels: Float32Array[], sampleRate: number, params: DenoiseParams): Float32Array[] =>
  channels.map((ch) => {
    const stage = makeDenoiseStage(ch.length, sampleRate, params);
    const a = stage.push(ch);
    const b = stage.finish();
    const out = new Float32Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  });
