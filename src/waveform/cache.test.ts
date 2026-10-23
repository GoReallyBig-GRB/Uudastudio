import { describe, expect, it } from 'vitest';
import { waveformCache } from './cache';

function makeStereoBuffer(length: number): AudioBuffer {
  const left = Float32Array.from({ length }, (_, i) => Math.sin(i * 0.31) * (i % 11 === 0 ? 1.2 : 0.8));
  const right = Float32Array.from({ length }, (_, i) => Math.cos(i * 0.17) * (i % 7 === 0 ? 0.9 : 0.5));
  const channels = [left, right];
  return {
    length,
    numberOfChannels: 2,
    getChannelData: (channel: number) => channels[channel],
  } as unknown as AudioBuffer;
}

describe('waveform peak cache', () => {
  it('aggregates a coarser level from cached finer peaks without changing extrema', () => {
    const buffer = makeStereoBuffer(4099);
    waveformCache.clearAsset('waveform-fine');
    waveformCache.clearAsset('waveform-direct');

    waveformCache.getPeaks('waveform-fine', buffer, 2);
    const aggregated = waveformCache.getPeaks('waveform-fine', buffer, 8);
    const direct = waveformCache.getPeaks('waveform-direct', buffer, 8);

    expect(aggregated.samplesPerPixel).toBe(8);
    expect(Array.from(aggregated.mins)).toEqual(Array.from(direct.mins));
    expect(Array.from(aggregated.maxs)).toEqual(Array.from(direct.maxs));

    waveformCache.clearAsset('waveform-fine');
    waveformCache.clearAsset('waveform-direct');
  });
});
