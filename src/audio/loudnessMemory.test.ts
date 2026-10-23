import { describe, expect, it } from 'vitest';
import { measureLoudness } from './mastering';

function mockBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  return {
    length: channels[0]?.length ?? 0,
    sampleRate,
    numberOfChannels: channels.length,
    duration: (channels[0]?.length ?? 0) / sampleRate,
    getChannelData: (channel: number) => channels[channel],
  } as unknown as AudioBuffer;
}

describe('measureLoudness bounded-memory analysis', () => {
  it('returns finite measurements for stereo material spanning multiple overlapping blocks', () => {
    const sampleRate = 8000;
    const length = sampleRate * 2;
    const left = Float32Array.from({ length }, (_, i) => Math.sin(i * 0.031) * 0.4);
    const right = Float32Array.from({ length }, (_, i) => Math.cos(i * 0.027) * 0.2);
    const stats = measureLoudness(mockBuffer([left, right], sampleRate));

    expect(stats.durationSeconds).toBe(2);
    expect(Number.isFinite(stats.integratedLUFS)).toBe(true);
    expect(Number.isFinite(stats.truePeakDbTP)).toBe(true);
    expect(Number.isFinite(stats.rmsDb)).toBe(true);
    expect(stats.integratedLUFS).toBeGreaterThan(-70);
    expect(stats.truePeakDbTP).toBeLessThan(0);
  });

  it('handles short clips without allocating an invalid block count', () => {
    const sampleRate = 8000;
    const samples = Float32Array.from({ length: 100 }, (_, i) => Math.sin(i * 0.1) * 0.25);
    const stats = measureLoudness(mockBuffer([samples], sampleRate));
    expect(stats.durationSeconds).toBeCloseTo(0.01, 6);
    expect(Number.isFinite(stats.integratedLUFS)).toBe(true);
  });
});
