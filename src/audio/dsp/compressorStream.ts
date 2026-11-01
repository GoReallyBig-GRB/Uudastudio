/**
 * Dynamics compressor that runs on audio of any length, block after block, with no seams: all of its state (level detector,
 * lookahead delay) is carried from one block to the next, so streaming a clip in pieces gives the same samples as processing
 * it whole (see compressorStream.test.ts). Short clips use the same code.
 *
 * Design: feed-forward, stereo-linked peak detector with separate attack and release, soft-knee gain computer in dB, a short
 * lookahead so the gain is already moving when a peak arrives, and makeup gain (your setting plus an automatic part
 * modelled on the browser compressor this replaces, so loudness feels familiar).
 */
import type { CompressorParams } from '../../types';
import type { MultiStage } from '../chunkedProcess';

export const LOOKAHEAD_SECONDS = 0.003;
/** Share of the gain reduction at full scale that is given back automatically (the browser compressor did about this) */
export const AUTO_MAKEUP_SHARE = 0.6;

export interface CompressorSettings {
  thresholdDb: number;
  kneeDb: number;
  ratio: number;
  attackSeconds: number;
  releaseSeconds: number;
  makeupDb: number;
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export const normalizeCompressor = (p: CompressorParams): CompressorSettings => ({
  thresholdDb: Math.max(-100, Math.min(0, num(p.thresholdDb, -24))),
  kneeDb: Math.max(0, Math.min(40, num(p.kneeDb, 12))),
  ratio: Math.max(1, Math.min(20, num(p.ratio, 4))),
  attackSeconds: Math.max(0.001, Math.min(1, (num(p.attackMs, 15) || 15) / 1000)),
  releaseSeconds: Math.max(0.01, Math.min(1, (num(p.releaseMs, 180) || 180) / 1000)),
  makeupDb: Math.max(-24, Math.min(24, num(p.makeupGainDb, 0))),
});

/** Gain change in dB (0 or negative) for an input level in dB: the compressor's transfer curve with a soft knee. */
export const gainReductionDb = (levelDb: number, thresholdDb: number, kneeDb: number, ratio: number): number => {
  const over = levelDb - thresholdDb;
  if (2 * over < -kneeDb) return 0;
  if (kneeDb > 0 && 2 * Math.abs(over) <= kneeDb) {
    const d = over + kneeDb / 2;
    return ((1 / ratio - 1) * d * d) / (2 * kneeDb);
  }
  return over * (1 / ratio - 1);
};

export class CompressorStage implements MultiStage {
  private readonly s: CompressorSettings;
  private readonly lookahead: number;
  private readonly attackCoeff: number;
  private readonly releaseCoeff: number;
  private readonly makeupLin: number;
  private readonly kneeBottomLin: number;
  private readonly rings: Float32Array[] = [];
  private ringPos = 0;
  private env = 0;
  private skip: number;
  private channels = 0;

  constructor(sampleRate: number, params: CompressorParams) {
    this.s = normalizeCompressor(params);
    this.lookahead = Math.max(1, Math.round(LOOKAHEAD_SECONDS * sampleRate));
    this.skip = this.lookahead;
    this.attackCoeff = Math.exp(-1 / (this.s.attackSeconds * sampleRate));
    this.releaseCoeff = Math.exp(-1 / (this.s.releaseSeconds * sampleRate));
    const auto = -AUTO_MAKEUP_SHARE * gainReductionDb(0, this.s.thresholdDb, this.s.kneeDb, this.s.ratio);
    this.makeupLin = Math.pow(10, (this.s.makeupDb + auto) / 20);
    // Below this level nothing is compressed, so the logarithm can be skipped
    this.kneeBottomLin = Math.pow(10, (this.s.thresholdDb - this.s.kneeDb / 2) / 20);
  }

  private run(input: Float32Array[]): Float32Array[] {
    const n = input[0]?.length ?? 0;
    if (this.channels === 0) {
      this.channels = input.length;
      for (let c = 0; c < this.channels; c++) this.rings.push(new Float32Array(this.lookahead));
    }
    const out = input.map(() => new Float32Array(n));
    const { thresholdDb, kneeDb, ratio } = this.s;
    const L = this.lookahead;
    let pos = this.ringPos;
    let env = this.env;
    for (let i = 0; i < n; i++) {
      let level = 0;
      for (let c = 0; c < this.channels; c++) {
        const a = Math.abs(input[c][i]);
        if (a > level) level = a;
      }
      env = level > env ? level + this.attackCoeff * (env - level) : level + this.releaseCoeff * (env - level);
      let gain = this.makeupLin;
      if (env > this.kneeBottomLin) {
        const gr = gainReductionDb(20 * Math.log10(env), thresholdDb, kneeDb, ratio);
        gain *= Math.pow(10, gr / 20);
      }
      for (let c = 0; c < this.channels; c++) {
        const ring = this.rings[c];
        out[c][i] = ring[pos] * gain;
        ring[pos] = input[c][i];
      }
      pos = pos + 1 === L ? 0 : pos + 1;
    }
    this.ringPos = pos;
    this.env = env;
    return out;
  }

  private dropLead(out: Float32Array[]): Float32Array[] {
    if (this.skip <= 0) return out;
    const cut = Math.min(this.skip, out[0]?.length ?? 0);
    this.skip -= cut;
    return out.map((o) => o.subarray(cut));
  }

  push(chunk: Float32Array[]): Float32Array[] {
    if (!chunk.length || chunk[0].length === 0) return chunk.map(() => new Float32Array(0));
    return this.dropLead(this.run(chunk));
  }

  finish(): Float32Array[] {
    if (this.channels === 0) return [];
    // The audio is delayed by the lookahead; push silence through to bring the last of it out
    return this.dropLead(this.run(Array.from({ length: this.channels }, () => new Float32Array(this.lookahead))));
  }
}

/** The whole clip at once (same code and result as streaming it). */
export const compressChannels = (channels: Float32Array[], sampleRate: number, params: CompressorParams): Float32Array[] => {
  const stage = new CompressorStage(sampleRate, params);
  const a = stage.push(channels);
  const b = stage.finish();
  return channels.map((_, c) => {
    const out = new Float32Array(a[c].length + b[c].length);
    out.set(a[c], 0);
    out.set(b[c], a[c].length);
    return out;
  });
};
