/**
 * Peak (min/max) helpers shared by the streamed-import worker and the waveform provider. Pure, unit-tested.
 */
export const PEAK_BASE_SAMPLES_PER_PIXEL = 256;

/** Accumulates min/max per fixed-size bucket of mono-averaged samples while audio is streamed through. */
export class PeakAccumulator {
  private mins: number[] = [];
  private maxs: number[] = [];
  private count = 0;
  private min = Infinity;
  private max = -Infinity;

  constructor(readonly bucketSize: number = PEAK_BASE_SAMPLES_PER_PIXEL) {}

  /** Adds `frames` frames from planar channels (mono value = average of channels). */
  push(channels: Float32Array[], frames: number): void {
    const n = channels.length;
    for (let i = 0; i < frames; i++) {
      let v = 0;
      for (let c = 0; c < n; c++) v += channels[c][i];
      v /= n;
      if (v < this.min) this.min = v;
      if (v > this.max) this.max = v;
      if (++this.count === this.bucketSize) this.flush();
    }
  }

  private flush(): void {
    this.mins.push(this.min);
    this.maxs.push(this.max);
    this.count = 0;
    this.min = Infinity;
    this.max = -Infinity;
  }

  /** Finishes the partial last bucket and returns interleaved [min0, max0, min1, max1, ...]. */
  finish(): Float32Array {
    if (this.count > 0) this.flush();
    const out = new Float32Array(this.mins.length * 2);
    for (let i = 0; i < this.mins.length; i++) { out[i * 2] = this.mins[i]; out[i * 2 + 1] = this.maxs[i]; }
    return out;
  }
}

export function splitInterleavedPeaks(data: Float32Array): { mins: Float32Array; maxs: Float32Array } {
  const n = Math.floor(data.length / 2);
  const mins = new Float32Array(n);
  const maxs = new Float32Array(n);
  for (let i = 0; i < n; i++) { mins[i] = data[i * 2]; maxs[i] = data[i * 2 + 1]; }
  return { mins, maxs };
}

/** Builds a coarser level by merging `ratio` consecutive buckets. */
export function aggregatePeaks(mins: Float32Array, maxs: Float32Array, ratio: number): { mins: Float32Array; maxs: Float32Array } {
  const n = Math.ceil(mins.length / ratio);
  const outMins = new Float32Array(n);
  const outMaxs = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    const start = b * ratio;
    const end = Math.min(start + ratio, mins.length);
    let lo = Infinity, hi = -Infinity;
    for (let i = start; i < end; i++) { if (mins[i] < lo) lo = mins[i]; if (maxs[i] > hi) hi = maxs[i]; }
    outMins[b] = Number.isFinite(lo) ? lo : 0;
    outMaxs[b] = Number.isFinite(hi) ? hi : 0;
  }
  return { mins: outMins, maxs: outMaxs };
}

/**
 * Fills min/max for buckets [bucketStart, bucketEnd) of `step` frames each, reading raw planar channels
 * (mono value = average of channels). Output index 0 corresponds to `bucketStart`.
 * Hot path: tight loops with mono and stereo specialisations.
 */
export function fillBucketPeaks(
  channels: Float32Array[],
  totalFrames: number,
  bucketStart: number,
  bucketEnd: number,
  step: number,
  mins: Float32Array,
  maxs: Float32Array
): void {
  const n = channels.length;
  const c0 = channels[0];
  const c1 = n > 1 ? channels[1] : null;
  for (let b = bucketStart; b < bucketEnd; b++) {
    const s = b * step;
    const e = Math.min(s + step, totalFrames);
    let lo = Infinity, hi = -Infinity;
    if (n === 1) {
      for (let i = s; i < e; i++) { const v = c0[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    } else if (n === 2 && c1) {
      for (let i = s; i < e; i++) { const v = (c0[i] + c1[i]) / 2; if (v < lo) lo = v; if (v > hi) hi = v; }
    } else {
      for (let i = s; i < e; i++) { let v = 0; for (let c = 0; c < n; c++) v += channels[c][i]; v /= n; if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    mins[b - bucketStart] = Number.isFinite(lo) ? lo : 0;
    maxs[b - bucketStart] = Number.isFinite(hi) ? hi : 0;
  }
}

/** Min/max per bucket of `step` frames directly from raw planar channel data (mono average). */
export function peaksFromRaw(channels: Float32Array[], frames: number, step: number): { mins: Float32Array; maxs: Float32Array } {
  const buckets = Math.ceil(frames / step);
  const mins = new Float32Array(buckets);
  const maxs = new Float32Array(buckets);
  fillBucketPeaks(channels, frames, 0, buckets, step, mins, maxs);
  return { mins, maxs };
}
