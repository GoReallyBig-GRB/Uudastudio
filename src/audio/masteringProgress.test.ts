import { describe, expect, it } from 'vitest';
import { measureLoudnessAsync } from './mastering';

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
});
