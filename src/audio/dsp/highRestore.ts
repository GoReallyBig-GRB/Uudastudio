/**
 * Restoring the highs a WSOLA stretch loses.
 *
 * Overlapping frames add up cleanly only where their waveforms line up (the lows, which the similarity search aligns). Noise-like
 * sound (breath, fricatives, cymbals, room hiss) does not line up, so four overlapping frames sum to about 60% of the level of
 * one: roughly -4 dB, the "muffled", "dipping" top end heard on sped-up speech. This module measures, per sample, how much the
 * high band lost against what the frames themselves carried, and gives it back (never more than a set amount, never to the lows).
 *
 * Everything runs in output order with plain recursions, so the whole-buffer and the streaming stretchers give identical results.
 */

/** Corner of the band that gets compensated (Hz). Below it the similarity search aligns the frames and nothing is lost. */
export const HIGH_CORNER_HZ = 800;
/** Never boost more than this (linear). Fully incoherent overlap needs about 1.63. */
export const MAX_RESTORE_GAIN = 1.8;
/** Smoothing of the energy estimates (seconds). Long enough to be steady, short enough to follow a consonant. */
export const RESTORE_SMOOTH_SECONDS = 0.012;

/** Second-order Butterworth high-pass that keeps its state between calls, so it can run on pieces as they arrive. */
export class HighpassStream {
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(sampleRate: number, corner = HIGH_CORNER_HZ) {
    const w0 = (2 * Math.PI * Math.min(corner, sampleRate * 0.45)) / sampleRate;
    const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
    const cw = Math.cos(w0);
    const a0 = 1 + alpha;
    this.b0 = (1 + cw) / 2 / a0;
    this.b1 = -(1 + cw) / a0;
    this.b2 = (1 + cw) / 2 / a0;
    this.a1 = (-2 * cw) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(input: Float32Array): Float32Array {
    const out = new Float32Array(input.length);
    let { x1, x2, y1, y2 } = this;
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      const y = this.b0 * x + this.b1 * x1 + this.b2 * x2 - this.a1 * y1 - this.a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      out[i] = Number.isFinite(y) ? y : 0;
    }
    this.x1 = x1; this.x2 = x2; this.y1 = y1; this.y2 = y2;
    return out;
  }
}

/**
 * Per-sample correction, called for output samples in order. `full` is the normal normalised overlap-add value, `hiOut` the same
 * for the high band alone, and `hiPow` the weighted mean of the frames' high-band energy at that sample (what the high band
 * "should" carry). Returns full + (gain - 1) * hiOut.
 */
export class HighRestorer {
  private readonly alpha: number;
  private smOut = 0;
  private smIn = 0;

  constructor(sampleRate: number) {
    this.alpha = Math.exp(-1 / Math.max(1, RESTORE_SMOOTH_SECONDS * sampleRate));
  }

  next(full: number, hiOut: number, hiPow: number): number {
    this.smOut = this.alpha * this.smOut + (1 - this.alpha) * hiOut * hiOut;
    this.smIn = this.alpha * this.smIn + (1 - this.alpha) * hiPow;
    let g = 1;
    if (this.smOut > 1e-14 && this.smIn > this.smOut) g = Math.min(MAX_RESTORE_GAIN, Math.sqrt(this.smIn / this.smOut));
    const v = full + (g - 1) * hiOut;
    return Number.isFinite(v) ? v : full;
  }
}
