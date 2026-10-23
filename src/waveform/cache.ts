/**
 * X-PRO AUDIO - Waveform Peak Extraction & Caching
 * Computes min/max sample slices for AudioBuffers and caches them for high-performance canvas rendering.
 */

export interface WaveformPeaks {
  mins: Float32Array;
  maxs: Float32Array;
  samplesPerPixel: number;
}

const PEAK_CACHE_BUDGET_BYTES = 64 * 1024 * 1024;
const MONO_CACHE_BUDGET_BYTES = 64 * 1024 * 1024;

class WaveformCache {
  // Map insertion order is used as an LRU: hits are moved to the end.
  private cache: Map<string, WaveformPeaks> = new Map();
  private peakCacheBytes = 0;
  private monoChannels: Map<string, Float32Array> = new Map();
  private monoCacheBytes = 0;

  public clearAsset(assetId: string): void {
    const mono = this.monoChannels.get(assetId);
    if (mono) {
      this.monoCacheBytes -= mono.byteLength;
      this.monoChannels.delete(assetId);
    }
    for (const [key, peaks] of this.cache) {
      if (key.startsWith(`${assetId}:`)) {
        this.peakCacheBytes -= peaks.mins.byteLength + peaks.maxs.byteLength;
        this.cache.delete(key);
      }
    }
  }

  private rememberMono(assetId: string, mono: Float32Array): void {
    // Very long assets still get processed, but their full-length mono copy is
    // transient rather than retained alongside the decoded AudioBuffer.
    if (mono.byteLength > MONO_CACHE_BUDGET_BYTES) return;
    while (this.monoCacheBytes + mono.byteLength > MONO_CACHE_BUDGET_BYTES) {
      const oldest = this.monoChannels.entries().next().value as [string, Float32Array] | undefined;
      if (!oldest) break;
      this.monoChannels.delete(oldest[0]);
      this.monoCacheBytes -= oldest[1].byteLength;
    }
    this.monoChannels.set(assetId, mono);
    this.monoCacheBytes += mono.byteLength;
  }

  private rememberPeaks(cacheKey: string, peaks: WaveformPeaks): void {
    const bytes = peaks.mins.byteLength + peaks.maxs.byteLength;
    if (bytes > PEAK_CACHE_BUDGET_BYTES) return;
    const existing = this.cache.get(cacheKey);
    if (existing) {
      this.peakCacheBytes -= existing.mins.byteLength + existing.maxs.byteLength;
      this.cache.delete(cacheKey);
    }
    while (this.peakCacheBytes + bytes > PEAK_CACHE_BUDGET_BYTES) {
      const oldest = this.cache.entries().next().value as [string, WaveformPeaks] | undefined;
      if (!oldest) break;
      this.cache.delete(oldest[0]);
      this.peakCacheBytes -= oldest[1].mins.byteLength + oldest[1].maxs.byteLength;
    }
    this.cache.set(cacheKey, peaks);
    this.peakCacheBytes += bytes;
  }

  public getMonoChannel(assetId: string, buffer: AudioBuffer): Float32Array {
    const mono = this.monoChannels.get(assetId);
    if (mono) {
      // Refresh recency without copying the potentially large array.
      this.monoChannels.delete(assetId);
      this.monoChannels.set(assetId, mono);
      return mono;
    }

    const length = buffer.length;
    const numChannels = buffer.numberOfChannels;
    const merged = new Float32Array(length);

    if (numChannels === 1) {
      merged.set(buffer.getChannelData(0));
    } else {
      for (let ch = 0; ch < numChannels; ch++) {
        const chData = buffer.getChannelData(ch);
        for (let i = 0; i < length; i++) merged[i] += chData[i];
      }
      const inv = 1 / numChannels;
      for (let i = 0; i < length; i++) merged[i] *= inv;
    }

    this.rememberMono(assetId, merged);
    return merged;
  }

  /**
   * Get or calculate min/max peak arrays for an asset at a specific samplesPerPixel resolution.
   * Both retained caches have fixed byte budgets so zooming or opening long assets
   * cannot grow these auxiliary caches without bound.
   */
  public getPeaks(assetId: string, buffer: AudioBuffer, samplesPerPixel: number): WaveformPeaks {
    const roundedStep = Number.isFinite(samplesPerPixel) && samplesPerPixel > 0
      ? Math.max(1, Math.round(samplesPerPixel))
      : 1;
    const cacheKey = `${assetId}:${roundedStep}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return cached;
    }

    const channelData = this.getMonoChannel(assetId, buffer);
    const totalSamples = channelData.length;
    const numBuckets = Math.ceil(totalSamples / roundedStep);
    const mins = new Float32Array(numBuckets);
    const maxs = new Float32Array(numBuckets);

    for (let bucket = 0; bucket < numBuckets; bucket++) {
      const start = bucket * roundedStep;
      const end = Math.min(start + roundedStep, totalSamples);
      let min = 1.0;
      let max = -1.0;
      for (let i = start; i < end; i++) {
        const val = channelData[i];
        if (val < min) min = val;
        if (val > max) max = val;
      }
      mins[bucket] = min === 1.0 ? 0 : min;
      maxs[bucket] = max === -1.0 ? 0 : max;
    }

    const result: WaveformPeaks = { mins, maxs, samplesPerPixel: roundedStep };
    this.rememberPeaks(cacheKey, result);
    return result;
  }
}

export const waveformCache = new WaveformCache();
