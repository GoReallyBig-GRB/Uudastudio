/**
 * Noise print: learn what the background noise of a recording looks like from a stretch with no speech, then take out only
 * that from the whole recording.
 *
 * The print is the average power of the noise in each frequency band (1024-point analysis, 75% overlap). To clean audio, each
 * short frame is compared with the print, band by band: where the frame is no louder than the noise it is turned down, where
 * something clearly louder than the noise is present (speech, music) it passes. The gain is smoothed across neighbouring
 * bands and over time so no "musical" twittering is left behind.
 *
 * `NoisePrintStage` carries everything from block to block, so a long clip processed in pieces gives the same samples as the
 * whole clip at once (see noisePrint.test.ts). Short clips use the same code. One stage per channel.
 */
import type { Stage } from './wsolaStream';

export const PRINT_FFT = 1024;
const N = PRINT_FFT;
const HOP = N / 4;
const BINS = N / 2 + 1;

export interface NoisePrint {
  fftSize: number;
  sampleRate: number;
  /** Average noise power per frequency band (BINS values) */
  power: number[];
  /** How much audio it was learned from */
  seconds: number;
  /** Where it came from, for the label ("Track 1, 0:12 to 0:15") */
  label: string;
  /** Spread of loudness across the sample, in dB: large means speech or other loud events probably got in */
  loudnessSpreadDb: number;
}

// ---- FFT (radix-2, in place) ------------------------------------------------------------------------------------------
const rev = (() => {
  const r = new Uint16Array(N);
  const bits = Math.log2(N);
  for (let i = 0; i < N; i++) {
    let x = i, y = 0;
    for (let b = 0; b < bits; b++) { y = (y << 1) | (x & 1); x >>= 1; }
    r[i] = y;
  }
  return r;
})();
const cosT = new Float64Array(N / 2);
const sinT = new Float64Array(N / 2);
for (let i = 0; i < N / 2; i++) { cosT[i] = Math.cos((2 * Math.PI * i) / N); sinT[i] = -Math.sin((2 * Math.PI * i) / N); }

const fft = (re: Float64Array, im: Float64Array): void => {
  for (let i = 0; i < N; i++) {
    const j = rev[i];
    if (j > i) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1;
    const step = N / size;
    for (let start = 0; start < N; start += size) {
      for (let k = 0, t = 0; k < half; k++, t += step) {
        const a = start + k, b = a + half;
        const wr = cosT[t], wi = sinT[t];
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
};

/** sqrt of the periodic Hann window: used to analyse and again to rebuild, so the pair adds up to a Hann window */
const WIN = (() => {
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) w[i] = Math.sqrt(0.5 * (1 - Math.cos((2 * Math.PI * i) / N)));
  return w;
})();

// ---- Learning the print -----------------------------------------------------------------------------------------------
/** Shortest stretch a print can be learned from */
export const MIN_PRINT_SECONDS = 0.25;

/**
 * Learn the noise print from `channels` (a stretch with no speech). All channels are averaged into one print.
 * Throws if the stretch is too short.
 */
export const learnNoisePrint = (channels: Float32Array[], sampleRate: number, label = 'Noise sample'): NoisePrint => {
  const frames = channels[0]?.length ?? 0;
  if (frames < Math.max(N * 2, Math.round(MIN_PRINT_SECONDS * sampleRate))) {
    throw new Error(`The noise sample is too short. Pick at least ${MIN_PRINT_SECONDS} seconds with no speech.`);
  }
  const sum = new Float64Array(BINS);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const frameLevels: number[] = [];
  let count = 0;
  for (const ch of channels) {
    for (let start = 0; start + N <= ch.length; start += HOP) {
      let energy = 0;
      for (let i = 0; i < N; i++) { const v = ch[start + i] * WIN[i]; re[i] = v; im[i] = 0; energy += v * v; }
      fft(re, im);
      for (let k = 0; k < BINS; k++) sum[k] += re[k] * re[k] + im[k] * im[k];
      count++;
      frameLevels.push(10 * Math.log10(energy / N + 1e-12));
    }
  }
  const power = Array.from(sum, (s) => s / Math.max(1, count));
  frameLevels.sort((a, b) => a - b);
  const q = (p: number) => frameLevels[Math.min(frameLevels.length - 1, Math.floor(p * frameLevels.length))];
  return {
    fftSize: N,
    sampleRate,
    power,
    seconds: frames / sampleRate,
    label,
    loudnessSpreadDb: +(q(0.95) - q(0.5)).toFixed(1),
  };
};

/**
 * The quietest stretch of `seconds` in the audio (by short-window loudness): a good guess for where only background noise is.
 * Returns the start and end in frames, or null when the audio is shorter than that.
 */
export const quietestStretch = (channels: Float32Array[], sampleRate: number, seconds = 1): { start: number; end: number } | null => {
  const len = channels[0]?.length ?? 0;
  const span = Math.round(seconds * sampleRate);
  if (len < span) return null;
  const win = Math.max(256, Math.round(0.05 * sampleRate));
  const count = Math.floor(len / win);
  const level = new Float64Array(count);
  for (let w = 0; w < count; w++) {
    let e = 0;
    for (const ch of channels) for (let i = w * win; i < (w + 1) * win; i++) e += ch[i] * ch[i];
    level[w] = e;
  }
  const per = Math.max(1, Math.round(span / win));
  let best = Infinity, bestAt = 0, running = 0;
  for (let w = 0; w < count; w++) {
    running += level[w];
    if (w >= per) running -= level[w - per];
    if (w >= per - 1 && running < best) { best = running; bestAt = w - per + 1; }
  }
  return { start: bestAt * win, end: Math.min(len, bestAt * win + per * win) };
};

/** The print's power at each analysis band of a clip with another sample rate (bands are matched by frequency). */
const printFor = (print: NoisePrint, sampleRate: number): Float64Array => {
  const out = new Float64Array(BINS);
  const ratio = print.sampleRate / sampleRate;
  for (let k = 0; k < BINS; k++) {
    const pos = Math.min(BINS - 1, k * ratio);
    const lo = Math.floor(pos);
    const hi = Math.min(BINS - 1, lo + 1);
    const f = pos - lo;
    out[k] = print.power[lo] * (1 - f) + print.power[hi] * f;
  }
  return out;
};

// ---- Cleaning ---------------------------------------------------------------------------------------------------------
export interface NoisePrintSettings {
  /** How far noise is turned down, in dB (3 to 30) */
  reductionDb: number;
  /** How strictly the print is matched: 1 = exactly the measured noise, higher also removes louder noise like it (1 to 4) */
  sensitivity: number;
}

export class NoisePrintStage implements Stage {
  private readonly noise: Float64Array;
  private readonly floor: number;
  private readonly alpha: number;
  private readonly re = new Float64Array(N);
  private readonly im = new Float64Array(N);
  private readonly ar = new Float64Array(BINS);
  private readonly ai = new Float64Array(BINS);
  private readonly br = new Float64Array(BINS);
  private readonly bi = new Float64Array(BINS);
  private readonly pa = new Float64Array(BINS);
  private readonly pb = new Float64Array(BINS);
  private readonly ga = new Float64Array(BINS);
  private readonly gb = new Float64Array(BINS);
  private readonly fa = new Float64Array(N);
  private readonly fb = new Float64Array(N);
  private readonly prev = new Float64Array(BINS).fill(1);
  private readonly raw = new Float64Array(BINS);
  private readonly olap = new Float64Array(N);
  private buf = new Float64Array(0);
  private base = 0; // absolute index of buf[0]
  private received = 0;
  private frame = 0; // next frame to process
  private ended = false;

  constructor(private readonly totalIn: number, sampleRate: number, print: NoisePrint, settings: NoisePrintSettings) {
    this.noise = printFor(print, sampleRate);
    this.floor = Math.pow(10, -Math.max(0, settings.reductionDb) / 20);
    this.alpha = Math.max(1, Math.min(4, Number.isFinite(settings.sensitivity) ? settings.sensitivity : 1.5));
  }

  /** Smoothed gain for one frame's band powers (`power`), updating the carried gain state */
  private gainsFor(power: Float64Array, out: Float64Array): void {
    for (let k = 0; k < BINS; k++) {
      const g2 = 1 - (this.alpha * this.noise[k]) / (power[k] + 1e-18);
      this.raw[k] = g2 > this.floor * this.floor ? Math.sqrt(g2) : this.floor;
    }
    // Smooth across neighbouring bands, then over time (open quickly for speech, close gently on noise)
    for (let k = 0; k < BINS; k++) {
      const f = 0.25 * this.raw[Math.max(0, k - 1)] + 0.5 * this.raw[k] + 0.25 * this.raw[Math.min(BINS - 1, k + 1)];
      const p = this.prev[k];
      const g = f > p ? p + 0.7 * (f - p) : p + 0.35 * (f - p);
      this.prev[k] = g;
      out[k] = g;
    }
  }

  /** Add one cleaned frame (index j) to the overlap buffer and hand on the samples that are now final */
  private addFrame(frameOut: Float64Array, j: number, pieces: Float32Array[]): void {
    for (let i = 0; i < N; i++) this.olap[i] += frameOut[i] * WIN[i] * 0.5;
    const emit = new Float32Array(HOP);
    for (let i = 0; i < HOP; i++) emit[i] = this.olap[i];
    this.olap.copyWithin(0, HOP);
    this.olap.fill(0, N - HOP);
    const r0 = (j - 3) * HOP;
    const from = Math.max(0, -r0);
    const to = Math.min(HOP, this.totalIn - r0);
    if (to > from) pieces.push(emit.subarray(from, to));
  }

  /**
   * Two consecutive frames (j, j+1) share one transform: the first goes in the real part, the second in the imaginary part,
   * and the two spectra are told apart afterwards. Pairs are always (even, odd), so the result never depends on how the
   * audio arrived.
   */
  private processPair(j: number, pieces: Float32Array[]): void {
    const { re, im } = this;
    const firstA = (j - 3) * HOP;
    const firstB = (j - 2) * HOP;
    for (let i = 0; i < N; i++) {
      const ia = firstA + i, ib = firstB + i;
      re[i] = (ia >= 0 && ia < this.received ? this.buf[ia - this.base] : 0) * WIN[i];
      im[i] = (ib >= 0 && ib < this.received ? this.buf[ib - this.base] : 0) * WIN[i];
    }
    fft(re, im);
    const ar = this.ar, ai = this.ai, br = this.br, bi = this.bi;
    for (let k = 0; k < BINS; k++) {
      const m = (N - k) & (N - 1);
      ar[k] = 0.5 * (re[k] + re[m]);
      ai[k] = 0.5 * (im[k] - im[m]);
      br[k] = 0.5 * (im[k] + im[m]);
      bi[k] = -0.5 * (re[k] - re[m]);
      this.pa[k] = ar[k] * ar[k] + ai[k] * ai[k];
      this.pb[k] = br[k] * br[k] + bi[k] * bi[k];
    }
    this.gainsFor(this.pa, this.ga);
    this.gainsFor(this.pb, this.gb);
    // W = A*ga + i*B*gb over the full circle (each spectrum is mirrored: X[N-k] = conj X[k]); then conjugated for the inverse
    for (let k = 0; k < BINS; k++) {
      const xr = ar[k] * this.ga[k], xi = ai[k] * this.ga[k];
      const yr = br[k] * this.gb[k], yi = bi[k] * this.gb[k];
      re[k] = xr - yi;
      im[k] = -(xi + yr);
      if (k > 0 && k < N / 2) {
        const m = N - k;
        re[m] = xr + yi;
        im[m] = -(-xi + yr);
      }
    }
    fft(re, im);
    const fa = this.fa, fb = this.fb;
    for (let i = 0; i < N; i++) { fa[i] = re[i] / N; fb[i] = -im[i] / N; }
    this.addFrame(fa, j, pieces);
    if ((j - 2) * HOP < this.totalIn) this.addFrame(fb, j + 1, pieces);
    else this.olap.fill(0);
  }

  private drain(final: boolean): Float32Array {
    const pieces: Float32Array[] = [];
    // Pair (j, j+1) needs real input up to (j+2)*HOP - 1; at the end the missing part is silence
    while (true) {
      const j = this.frame;
      if ((j - 3) * HOP >= this.totalIn) break;
      if (!final && this.received < (j + 2) * HOP) break;
      this.processPair(j, pieces);
      this.frame = j + 2;
    }
    // Forget input that no later frame will read
    const keepFrom = Math.max(0, (this.frame - 3) * HOP);
    const cut = Math.min(keepFrom - this.base, this.buf.length);
    if (cut > 0) { this.buf = this.buf.slice(cut); this.base += cut; }
    const total = pieces.reduce((n, p) => n + p.length, 0);
    const result = new Float32Array(total);
    let o = 0;
    for (const p of pieces) { result.set(p, o); o += p.length; }
    return result;
  }

  push(chunk: Float32Array): Float32Array {
    if (chunk.length === 0) return new Float32Array(0);
    const joined = new Float64Array(this.buf.length + chunk.length);
    joined.set(this.buf, 0);
    joined.set(chunk, this.buf.length);
    this.buf = joined;
    this.received += chunk.length;
    return this.drain(false);
  }

  finish(): Float32Array {
    if (this.ended) return new Float32Array(0);
    this.ended = true;
    return this.drain(true);
  }
}
