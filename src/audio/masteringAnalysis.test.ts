import { describe, expect, it } from 'vitest';
import { measureLoudness, measureLoudnessAsync } from './mastering';

function makeBuffer(sampleRate: number, channels: Float32Array[]): AudioBuffer {
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    getChannelData: (channel: number) => channels[channel],
  } as unknown as AudioBuffer;
}

describe('measureLoudnessAsync', () => {
  it('matches synchronous loudness and true-peak statistics', async () => {
    const length = 8192;
    const channels = [
      Float32Array.from({ length }, (_, i) => Math.sin(i * 0.031) * (i % 29 === 0 ? 0.95 : 0.4)),
      Float32Array.from({ length }, (_, i) => Math.cos(i * 0.017) * (i % 43 === 0 ? 0.88 : 0.3)),
    ];
    const buffer = makeBuffer(8000, channels);
    const expected = measureLoudness(buffer);
    const actual = await measureLoudnessAsync(buffer);
    expect(actual).toEqual(expected);
  });

  it('emits progress during long analysis and never moves backwards', async () => {
    const length = 270_000;
    const buffer = makeBuffer(8000, [
      Float32Array.from({ length }, (_, i) => Math.sin(i * 0.023) * 0.6),
    ]);
    const updates: number[] = [];
    await measureLoudnessAsync(buffer, (progress) => updates.push(progress.percent), 60, 70);
    expect(updates.length).toBeGreaterThan(0);
    for (let i = 1; i < updates.length; i++) {
      expect(updates[i]).toBeGreaterThanOrEqual(updates[i - 1]);
    }
  });
});
