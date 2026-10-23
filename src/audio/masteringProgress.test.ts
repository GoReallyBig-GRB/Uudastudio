import { describe, expect, it } from 'vitest';
import { calculateTruePeak, calculateTruePeakAsync, createMonotonicProgressReporter, measureLoudnessAsync } from './mastering';

describe('long-file mastering progress', () => {
  it('advances true-peak progress instead of reporting a fixed percentage', async () => {
    const samples = new Float32Array(1_100_000);
    samples.fill(0.1);
    const buffer = {
      numberOfChannels: 1,
      length: samples.length,
      sampleRate: 48_000,
      getChannelData: () => samples,
    } as unknown as AudioBuffer;
    const updates: Array<{ percent: number; message: string }> = [];

    await measureLoudnessAsync(buffer, ({ percent, message }) => {
      updates.push({ percent, message });
    }, 60, 69);

    const truePeakUpdates = updates.filter((update) => update.message.startsWith('Measuring true peak'));
    expect(truePeakUpdates.length).toBeGreaterThanOrEqual(2);
    expect(truePeakUpdates[truePeakUpdates.length - 1].percent)
      .toBeGreaterThan(truePeakUpdates[0].percent);
    expect(truePeakUpdates.every((update, index) => index === 0 || update.percent >= truePeakUpdates[index - 1].percent))
      .toBe(true);
  });

  it('never lets nested mastering stages move the reported percentage backwards', () => {
    const updates: number[] = [];
    const report = createMonotonicProgressReporter(({ percent }) => updates.push(percent));

    report({ stage: 'mastering', percent: 65, message: 'Starting analysis' });
    report({ stage: 'mastering', percent: 60, message: 'True peak phase starts' });
    report({ stage: 'mastering', percent: 63, message: 'Filtering audio' });
    report({ stage: 'mastering', percent: 75, message: 'Applying mastering' });
    report({ stage: 'mastering', percent: 101, message: 'Final stage' });

    expect(updates).toEqual([65, 65, 65, 75, 100]);
    expect(updates.every((value, index) => index === 0 || value >= updates[index - 1])).toBe(true);
  });

  it('keeps the optimized async true-peak result equivalent to the synchronous reference', async () => {
    const samples = Float32Array.from({ length: 20_003 }, (_, index) =>
      Math.sin(index * 0.031) * (index % 13 === 0 ? 1.15 : 0.72)
    );
    const syncPeak = calculateTruePeak(samples);
    const asyncPeak = await calculateTruePeakAsync(samples);
    expect(asyncPeak).toBeCloseTo(syncPeak, 6);
  });

  it('reports monotonic progress across all loudness-analysis phases', async () => {
    const samples = new Float32Array(1_100_000);
    samples.fill(0.1);
    const buffer = {
      numberOfChannels: 1,
      length: samples.length,
      sampleRate: 48_000,
      getChannelData: () => samples,
    } as unknown as AudioBuffer;
    const percentages: number[] = [];

    await measureLoudnessAsync(buffer, ({ percent }) => percentages.push(percent), 60, 69);

    expect(percentages.length).toBeGreaterThan(4);
    expect(percentages.every((value, index) => index === 0 || value >= percentages[index - 1])).toBe(true);
    expect(percentages[percentages.length - 1]).toBeGreaterThanOrEqual(68);
  });
});
