import { describe, expect, it } from 'vitest';
import type { Asset } from '../types';
import { peakProvider } from './peakProvider';
import { PeakAccumulator, fillBucketPeaks, peaksFromRaw, splitInterleavedPeaks } from './peakMath';

function bufferAsset(id: string, frames: number, channelCount = 2): Asset {
  const chans = Array.from({ length: channelCount }, (_, c) => Float32Array.from({ length: frames }, (_, i) => Math.sin(i * (0.01 + c * 0.003)) * (0.3 + 0.3 * Math.sin(i * 0.00002))));
  const buffer = { length: frames, numberOfChannels: channelCount, getChannelData: (c: number) => chans[c] } as unknown as AudioBuffer;
  return { id, name: id, kind: 'import', buffer, sampleRate: 44100, durationSeconds: frames / 44100, numberOfChannels: channelCount };
}
const channelsOf = (a: Asset) => Array.from({ length: a.numberOfChannels }, (_, c) => a.buffer!.getChannelData(c));

describe('fillBucketPeaks', () => {
  it('matches the streaming accumulator for mono, stereo and 3 channels', () => {
    for (const n of [1, 2, 3]) {
      const a = bufferAsset('fill-' + n, 5000, n);
      const ch = channelsOf(a);
      const acc = new PeakAccumulator(256);
      acc.push(ch, 5000);
      const ref = splitInterleavedPeaks(acc.finish());
      const got = peaksFromRaw(ch, 5000, 256);
      expect(Array.from(got.mins)).toEqual(Array.from(ref.mins));
      expect(Array.from(got.maxs)).toEqual(Array.from(ref.maxs));
    }
  });

  it('fills a sub-range of buckets at output index zero', () => {
    const ch = channelsOf(bufferAsset('fill-range', 4096, 2));
    const full = peaksFromRaw(ch, 4096, 256);
    const mins = new Float32Array(4), maxs = new Float32Array(4);
    fillBucketPeaks(ch, 4096, 6, 10, 256, mins, maxs);
    expect(Array.from(mins)).toEqual(Array.from(full.mins.subarray(6, 10)));
    expect(Array.from(maxs)).toEqual(Array.from(full.maxs.subarray(6, 10)));
  });
});

describe('peakProvider (in-memory assets)', () => {
  it('serves a small buffer immediately, exact at zoomed-out and zoomed-in levels', () => {
    const a = bufferAsset('small', 300_000);
    const out = peakProvider.getPeaksForRange(a, 0, 300_000, 1024)!;
    expect(out.samplesPerPixel).toBe(1024);
    const direct = peaksFromRaw(channelsOf(a), 300_000, 1024);
    expect(Array.from(out.mins)).toEqual(Array.from(direct.mins));
    expect(Array.from(out.maxs)).toEqual(Array.from(direct.maxs));

    const win = peakProvider.getPeaksForRange(a, 100_000, 100_000 + 32 * 500, 32)!;
    expect(win.samplesPerPixel).toBe(32);
    const w0 = win.firstBucket || 0;
    const d32 = peaksFromRaw(channelsOf(a), 300_000, 32);
    for (let i = 0; i < win.mins.length; i += 37) {
      expect(win.mins[i]).toBe(d32.mins[w0 + i]);
      expect(win.maxs[i]).toBe(d32.maxs[w0 + i]);
    }
    peakProvider.clearAsset('small');
  });

  it('builds a large buffer in the background, returns null until ready, then is exact', async () => {
    const a = bufferAsset('large', 4_000_000); // 8M samples: above the immediate-build limit
    const ready = new Promise<void>((resolve) => { const off = peakProvider.subscribe(() => { off(); resolve(); }); });
    expect(peakProvider.getPeaksForRange(a, 0, 4_000_000, 4096) === null).toBe(true);
    await ready;
    const out = peakProvider.getPeaksForRange(a, 0, 4_000_000, 4096)!;
    expect(out.samplesPerPixel).toBe(4096);
    const direct = peaksFromRaw(channelsOf(a), 4_000_000, 4096);
    expect(Array.from(out.mins)).toEqual(Array.from(direct.mins));
    expect(Array.from(out.maxs)).toEqual(Array.from(direct.maxs));
    peakProvider.clearAsset('large');
  });

  it('stops a background build when the asset is cleared', async () => {
    const a = bufferAsset('cleared', 4_000_000);
    let notified = 0;
    const off = peakProvider.subscribe(() => { notified++; });
    peakProvider.getPeaksForRange(a, 0, 4_000_000, 4096);
    peakProvider.clearAsset('cleared');
    await new Promise((r) => setTimeout(r, 400));
    off();
    expect(notified).toBe(0);
  });

  it('returns null for an asset with no audio source', () => {
    const a: Asset = { id: 'none', name: 'n', kind: 'import', sampleRate: 44100, durationSeconds: 1, numberOfChannels: 2 };
    expect(peakProvider.getPeaksForRange(a, 0, 100, 64) === null).toBe(true);
  });
});
