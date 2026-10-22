import { describe, expect, it } from 'vitest';
import { waveformCache } from './cache';

function audioBuffer(channels: number[][]): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  return {
    length,
    numberOfChannels: channels.length,
    getChannelData: (channel: number) => new Float32Array(channels[channel]),
  } as unknown as AudioBuffer;
}

describe('waveformCache', () => {
  it('extracts min/max peaks from mono and averages multichannel audio', () => {
    const monoId = 'test-mono-peaks';
    const mono = waveformCache.getPeaks(monoId, audioBuffer([[-0.8, 0.2, 0.6, -0.1]]), 2);
    expect(Array.from(mono.mins)).toEqual([-0.8, -0.1]);
    expect(Array.from(mono.maxs)).toEqual([0.2, 0.6]);

    const stereoId = 'test-stereo-peaks';
    const stereo = waveformCache.getPeaks(stereoId, audioBuffer([
      [-1, 0.5, 1, -0.5],
      [1, 0.5, -1, -0.5],
    ]), 1);
    expect(Array.from(stereo.mins)).toEqual([0, 0.5, 0, -0.5]);
    expect(Array.from(stereo.maxs)).toEqual([0, 0.5, 0, -0.5]);

    waveformCache.clearAsset(monoId);
    waveformCache.clearAsset(stereoId);
  });

  it('normalizes invalid resolutions and reuses cached peaks', () => {
    const id = 'test-cache-hit';
    const buffer = audioBuffer([[-0.25, 0.75]]);
    const first = waveformCache.getPeaks(id, buffer, 0);
    const second = waveformCache.getPeaks(id, buffer, Number.NaN);
    expect(first.samplesPerPixel).toBe(1);
    expect(second).toBe(first);
    waveformCache.clearAsset(id);
  });

  it('clears cached peaks and mono data for an asset', () => {
    const id = 'test-clear-asset';
    const buffer = audioBuffer([[-0.4, 0.4]]);
    const first = waveformCache.getPeaks(id, buffer, 1);
    waveformCache.clearAsset(id);
    const second = waveformCache.getPeaks(id, buffer, 1);
    expect(second).not.toBe(first);
    expect(Array.from(second.mins)).toEqual([-0.4, 0.4]);
    waveformCache.clearAsset(id);
  });
});
