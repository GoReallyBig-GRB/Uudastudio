/**
 * Uuda Studio waveform peak cache.
 * Peak levels are quantized to powers of two and kept within a measured allocation budget.
 * Peak extraction reads channels directly instead of allocating a full-length mono copy.
 */
export interface WaveformPeaks {
  mins: Float32Array;
  maxs: Float32Array;
  samplesPerPixel: number;
  /** Index of the first bucket stored. 0 for full-asset levels; >0 for windowed levels. */
  firstBucket?: number;
}

/** Above this many source samples (frames x channels) a full-asset scan is too slow for the UI thread. */
const FULL_SCAN_SAMPLE_LIMIT = 8_000_000;

const MAX_CACHE_BYTES = 64 * 1024 * 1024;

class WaveformCache {
  // Map insertion order is the LRU order: oldest entry is evicted first.
  private cache = new Map<string, WaveformPeaks>();
  private cacheBytes = 0;

  public clearAsset(assetId: string): void {
    this.lastWindow.delete(assetId);
    for (const [key, peaks] of this.cache) {
      if (key.startsWith(`${assetId}:`)) {
        this.cacheBytes -= peaks.mins.byteLength + peaks.maxs.byteLength;
        this.cache.delete(key);
      }
    }
  }

  private quantizeSamplesPerPixel(samplesPerPixel: number): number {
    const safe = Math.max(1, Number.isFinite(samplesPerPixel) ? samplesPerPixel : 1);
    return Math.max(1, 2 ** Math.round(Math.log2(safe)));
  }

  private hasExactOrFinerLevel(assetId: string, step: number): boolean {
    for (const [key, peaks] of this.cache) {
      if (key.startsWith(`${assetId}:`) && peaks.samplesPerPixel <= step && step % peaks.samplesPerPixel === 0) return true;
    }
    return false;
  }

  private lastWindow = new Map<string, WaveformPeaks & { start: number; end: number }>();

  /**
   * Peaks that are exact for the requested zoom over the requested sample range.
   * Never returns a coarser level than requested (that caused solid blocks when zoomed in).
   * For long sources whose fine level is not cached, only the visible window is scanned.
   */
  public getPeaksForRange(
    assetId: string,
    buffer: AudioBuffer,
    startSample: number,
    endSample: number,
    samplesPerPixel: number
  ): WaveformPeaks {
    const step = this.quantizeSamplesPerPixel(samplesPerPixel);
    const total = buffer.length;
    const channelsCount = Math.max(1, buffer.numberOfChannels);
    if (this.hasExactOrFinerLevel(assetId, step) || total * channelsCount <= FULL_SCAN_SAMPLE_LIMIT) {
      return this.getPeaks(assetId, buffer, step, false);
    }
    const first = Math.max(0, Math.floor(Math.max(0, startSample) / step) - 1);
    const last = Math.min(Math.ceil(total / step), Math.ceil(Math.max(startSample, endSample) / step) + 1);
    const memo = this.lastWindow.get(assetId);
    if (memo && memo.samplesPerPixel === step && memo.start <= first && memo.end >= last) return memo;
    // Pad the window so small scrolls reuse it.
    const pad = Math.max(16, last - first);
    const wFirst = Math.max(0, first - pad);
    const wLast = Math.min(Math.ceil(total / step), last + pad);
    const n = Math.max(0, wLast - wFirst);
    const mins = new Float32Array(n);
    const maxs = new Float32Array(n);
    const chans = Array.from({ length: channelsCount }, (_, c) => buffer.getChannelData(c));
    for (let b = 0; b < n; b++) {
      const s = (wFirst + b) * step;
      const e = Math.min(s + step, total);
      let min = Infinity;
      let max = -Infinity;
      for (let i = s; i < e; i++) {
        let v = 0;
        for (let c = 0; c < channelsCount; c++) v += chans[c][i];
        v /= channelsCount;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      mins[b] = Number.isFinite(min) ? min : 0;
      maxs[b] = Number.isFinite(max) ? max : 0;
    }
    const result = { mins, maxs, samplesPerPixel: step, firstBucket: wFirst, start: wFirst, end: wLast };
    this.lastWindow.set(assetId, result);
    return result;
  }

  public getPeaks(assetId: string, buffer: AudioBuffer, samplesPerPixel: number, allowCoarse = true): WaveformPeaks {
    const roundedStep = this.quantizeSamplesPerPixel(samplesPerPixel);
    const cacheKey = `${assetId}:${roundedStep}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      // Refresh LRU position.
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return cached;
    }

    // If the requested zoom is finer than every cached level, reuse the closest coarser
    // level rather than synchronously rescanning every sample of a potentially hour-long
    // source on the UI thread. This keeps the waveform visible and interactive while zooming;
    // the displayed envelope may be less detailed than a freshly computed fine level.
    const hasUsableFinerLevel = [...this.cache].some(([key, peaks]) =>
      key.startsWith(`${assetId}:`) &&
      peaks.samplesPerPixel < roundedStep &&
      roundedStep % peaks.samplesPerPixel === 0
    );
    let coarserKey: string | null = null;
    let coarserPeaks: WaveformPeaks | null = null;
    if (allowCoarse && !hasUsableFinerLevel) {
      for (const [key, peaks] of this.cache) {
        if (!key.startsWith(`${assetId}:`) || peaks.samplesPerPixel <= roundedStep) continue;
        if (!coarserPeaks || peaks.samplesPerPixel < coarserPeaks.samplesPerPixel) {
          coarserKey = key;
          coarserPeaks = peaks;
        }
      }
    }
    if (coarserKey && coarserPeaks) {
      this.cache.delete(coarserKey);
      this.cache.set(coarserKey, coarserPeaks);
      return coarserPeaks;
    }

    const totalSamples = buffer.length;
    const numBuckets = Math.ceil(totalSamples / roundedStep);
    const mins = new Float32Array(numBuckets);
    const maxs = new Float32Array(numBuckets);
    const assetPrefix = `${assetId}:`;

    // A coarser level can be built exactly from a cached finer level because all levels
    // are power-of-two aligned. This avoids another source-buffer scan when zooming out.
    let finerKey: string | null = null;
    let finerPeaks: WaveformPeaks | null = null;
    for (const [key, peaks] of this.cache) {
      if (!key.startsWith(assetPrefix) || peaks.samplesPerPixel >= roundedStep) continue;
      if (roundedStep % peaks.samplesPerPixel !== 0) continue;
      if (!finerPeaks || peaks.samplesPerPixel > finerPeaks.samplesPerPixel) {
        finerKey = key;
        finerPeaks = peaks;
      }
    }

    if (finerPeaks) {
      const ratio = roundedStep / finerPeaks.samplesPerPixel;
      for (let bucket = 0; bucket < numBuckets; bucket++) {
        const start = bucket * ratio;
        const end = Math.min(start + ratio, finerPeaks.mins.length);
        let min = Infinity;
        let max = -Infinity;
        for (let i = start; i < end; i++) {
          if (finerPeaks.mins[i] < min) min = finerPeaks.mins[i];
          if (finerPeaks.maxs[i] > max) max = finerPeaks.maxs[i];
        }
        mins[bucket] = Number.isFinite(min) ? min : 0;
        maxs[bucket] = Number.isFinite(max) ? max : 0;
      }
      if (finerKey && finerPeaks) {
        this.cache.delete(finerKey);
        this.cache.set(finerKey, finerPeaks);
      }
    } else {
      const numChannels = buffer.numberOfChannels;
      const channels = Array.from({ length: numChannels }, (_, channel) => buffer.getChannelData(channel));
      for (let bucket = 0; bucket < numBuckets; bucket++) {
        const start = bucket * roundedStep;
        const end = Math.min(start + roundedStep, totalSamples);
        let min = Infinity;
        let max = -Infinity;

        for (let i = start; i < end; i++) {
          let monoSample = 0;
          for (let channel = 0; channel < numChannels; channel++) monoSample += channels[channel][i];
          monoSample /= Math.max(1, numChannels);
          if (monoSample < min) min = monoSample;
          if (monoSample > max) max = monoSample;
        }

        mins[bucket] = Number.isFinite(min) ? min : 0;
        maxs[bucket] = Number.isFinite(max) ? max : 0;
      }
    }

    const result: WaveformPeaks = { mins, maxs, samplesPerPixel: roundedStep };
    const resultBytes = mins.byteLength + maxs.byteLength;
    // Return oversized levels for this draw, but don't retain them in the cache.
    if (resultBytes <= MAX_CACHE_BYTES) {
      while (this.cacheBytes + resultBytes > MAX_CACHE_BYTES && this.cache.size > 0) {
        const oldestKey = this.cache.keys().next().value as string | undefined;
        if (!oldestKey) break;
        const oldest = this.cache.get(oldestKey)!;
        this.cacheBytes -= oldest.mins.byteLength + oldest.maxs.byteLength;
        this.cache.delete(oldestKey);
      }
      this.cache.set(cacheKey, result);
      this.cacheBytes += resultBytes;
    }
    return result;
  }
}

export const waveformCache = new WaveformCache();
