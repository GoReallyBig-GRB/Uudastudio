import { describe, expect, it } from 'vitest';
import { PeakAccumulator, aggregatePeaks, peaksFromRaw, splitInterleavedPeaks } from './peakMath';

describe('peak math', () => {
  const left = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i * 0.07));
  const right = Float32Array.from({ length: 1000 }, (_, i) => Math.cos(i * 0.05) * 0.5);

  it('accumulates mono-averaged min/max per bucket, including the partial last bucket', () => {
    const acc = new PeakAccumulator(64);
    acc.push([left, right], 1000);
    const { mins, maxs } = splitInterleavedPeaks(acc.finish());
    expect(mins.length).toBe(Math.ceil(1000 / 64));
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 64; i++) { const v = (left[i] + right[i]) / 2; if (v < lo) lo = v; if (v > hi) hi = v; }
    expect(mins[0]).toBeCloseTo(lo, 6);
    expect(maxs[0]).toBeCloseTo(hi, 6);
  });

  it('gives the same result when audio arrives in uneven chunks', () => {
    const whole = peaksFromRaw([left, right], 1000, 64);
    const acc = new PeakAccumulator(64);
    for (const [a, b] of [[0, 100], [100, 333], [333, 1000]]) acc.push([left.subarray(a, b), right.subarray(a, b)], b - a);
    const chunked = splitInterleavedPeaks(acc.finish());
    expect(Array.from(chunked.mins)).toEqual(Array.from(whole.mins));
    expect(Array.from(chunked.maxs)).toEqual(Array.from(whole.maxs));
  });

  it('aggregating a fine level equals computing the coarse level directly', () => {
    const fine = peaksFromRaw([left, right], 1000, 16);
    const agg = aggregatePeaks(fine.mins, fine.maxs, 4);
    const direct = peaksFromRaw([left, right], 1000, 64);
    expect(Array.from(agg.mins)).toEqual(Array.from(direct.mins));
    expect(Array.from(agg.maxs)).toEqual(Array.from(direct.maxs));
  });
});
