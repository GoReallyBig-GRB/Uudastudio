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
    expect(Array.from(mono.mins)[0]).toBeCloseTo(-0.8, 6);
    expect(Array.from(mono.mins)[1]).toBeCloseTo(-0.1, 6);
    expect(Array.from(mono.maxs)[0]).toBeCloseTo(0.2, 6);
    expect(Array.from(mono.maxs)[1]).toBeCloseTo(0.6, 6);

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
    expect(Array.from(second.mins)[0]).toBeCloseTo(-0.4, 6);
    expect(Array.from(second.mins)[1]).toBeCloseTo(0.4, 6);
    waveformCache.clearAsset(id);
  });
 
  it('reuses a cached coarser level when zooming in would require a full source rescan', () => {
    const id = 'test-coarse-fallback';
    const values = Float32Array.from({ length: 16_384 }, (_, i) => Math.sin(i * 0.03));
    const buffer = {
      length: values.length,
      numberOfChannels: 1,
      getChannelData: () => values,
    } as unknown as AudioBuffer;
    waveformCache.clearAsset(id);
    const coarse = waveformCache.getPeaks(id, buffer, 1024);
    const finerRequest = waveformCache.getPeaks(id, buffer, 64);
    expect(finerRequest).toBe(coarse);
    expect(finerRequest.samplesPerPixel).toBe(1024);
    waveformCache.clearAsset(id);
  });

  it('aggregates coarser peaks from a cached finer level without changing extrema', () => {
    const channels = [
      Float32Array.from({ length: 4099 }, (_, i) => Math.sin(i * 0.31) * (i % 11 === 0 ? 1.2 : 0.8)),
      Float32Array.from({ length: 4099 }, (_, i) => Math.cos(i * 0.17) * (i % 7 === 0 ? 0.9 : 0.5)),
    ];
    const buffer = {
      length: channels[0].length,
      numberOfChannels: 2,
      getChannelData: (channel: number) => channels[channel],
    } as unknown as AudioBuffer;
    const fineId = 'test-waveform-pyramid-fine';
    const directId = 'test-waveform-pyramid-direct';
    waveformCache.clearAsset(fineId);
    waveformCache.clearAsset(directId);
    waveformCache.getPeaks(fineId, buffer, 2);
    const aggregated = waveformCache.getPeaks(fineId, buffer, 8);
    const direct = waveformCache.getPeaks(directId, buffer, 8);
    expect(aggregated.samplesPerPixel).toBe(8);
    expect(Array.from(aggregated.mins)).toEqual(Array.from(direct.mins));
    expect(Array.from(aggregated.maxs)).toEqual(Array.from(direct.maxs));
    waveformCache.clearAsset(fineId);
    waveformCache.clearAsset(directId);
  });

  it('returns exact fine peaks for a window of a long source instead of a coarse block level', () => {
    const id = 'test-window-fine';
    const length = 5_000_000;
    const values = new Float32Array(length);
    for (let i = 0; i < length; i++) values[i] = Math.sin(i * 0.01) * 0.5;
    const buffer = { length, numberOfChannels: 2, getChannelData: () => values } as unknown as AudioBuffer;
    waveformCache.clearAsset(id);
    const coarse = waveformCache.getPeaks(id, buffer, 4096);
    const start = 2_000_000;
    const win = waveformCache.getPeaksForRange(id, buffer, start, start + 48 * 800, 48);
    expect(win).not.toBe(coarse);
    expect(win.samplesPerPixel).toBe(32 * 2 >= 48 ? 64 : 32);
    expect(win.firstBucket).toBeGreaterThan(0);
    const b = Math.floor(start / win.samplesPerPixel) - (win.firstBucket || 0);
    let min = Infinity; let max = -Infinity;
    for (let i = 0; i < win.samplesPerPixel; i++) {
      const v = values[Math.floor(start / win.samplesPerPixel) * win.samplesPerPixel + i];
      if (v < min) min = v; if (v > max) max = v;
    }
    expect(win.mins[b]).toBeCloseTo(min, 6);
    expect(win.maxs[b]).toBeCloseTo(max, 6);
    waveformCache.clearAsset(id);
  });

});
