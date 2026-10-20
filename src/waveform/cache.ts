/**
 * X-PRO AUDIO - Waveform Peak Extraction & Caching
 * Computes min/max sample slices for AudioBuffers and caches them for high-performance canvas rendering.
 */

export interface WaveformPeaks {
  mins: Float32Array;
  maxs: Float32Array;
  samplesPerPixel: number;
}

class WaveformCache {
  // Map of `${assetId}:${samplesPerPixel}` -> WaveformPeaks
  private cache: Map<string, WaveformPeaks> = new Map();
  // Map of assetId -> mono merged Float32Array
  private monoChannels: Map<string, Float32Array> = new Map();

  public clearAsset(assetId: string): void {
    this.monoChannels.delete(assetId);
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(`${assetId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  public getMonoChannel(assetId: string, buffer: AudioBuffer): Float32Array {
    let mono = this.monoChannels.get(assetId);
    if (mono) return mono;

    const length = buffer.length;
    const numChannels = buffer.numberOfChannels;
    mono = new Float32Array(length);

    if (numChannels === 1) {
      const ch0 = buffer.getChannelData(0);
      mono.set(ch0);
    } else {
      // Merge channels
      for (let ch = 0; ch < numChannels; ch++) {
        const chData = buffer.getChannelData(ch);
        for (let i = 0; i < length; i++) {
          mono[i] += chData[i];
        }
      }
      const inv = 1 / numChannels;
      for (let i = 0; i < length; i++) {
        mono[i] *= inv;
      }
    }

    this.monoChannels.set(assetId, mono);
    return mono;
  }

  /**
   * Get or calculate min/max peak arrays for an asset at a specific samplesPerPixel resolution
   */
  public getPeaks(assetId: string, buffer: AudioBuffer, samplesPerPixel: number): WaveformPeaks {
    const roundedStep = Math.max(1, Math.round(samplesPerPixel));
    const cacheKey = `${assetId}:${roundedStep}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

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
    this.cache.set(cacheKey, result);
    return result;
  }
}

export const waveformCache = new WaveformCache();
