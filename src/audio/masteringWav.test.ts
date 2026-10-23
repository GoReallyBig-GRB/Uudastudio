import { describe, expect, it } from 'vitest';
import { exportAudioBufferToWavAsync } from './mastering';

function mockBuffer(channels: Float32Array[], sampleRate = 4): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0]?.length ?? 0,
    getChannelData: (channel: number) => channels[channel],
  } as unknown as AudioBuffer;
}

describe('exportAudioBufferToWavAsync', () => {
  it('writes a valid little-endian stereo 16-bit WAV across multiple blocks', async () => {
    const buffer = mockBuffer([
      Float32Array.from([-1, -0.5, 0, 0.5, 1, 0.25, -0.25, 0]),
      Float32Array.from([1, 0.5, 0, -0.5, -1, -0.25, 0.25, 0]),
    ]);
    const progress: number[] = [];
    const blob = await exportAudioBufferToWavAsync(buffer, 16, (p) => progress.push(p.percent));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + 8 * 2 * 2);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE');
    expect(view.getUint32(40, true)).toBe(32);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-16384);
    expect(view.getInt16(50, true)).toBe(16383);
    expect(progress.length).toBeGreaterThan(1);
    expect(progress[progress.length - 1]).toBeGreaterThan(progress[0]);
  });

  it('writes packed little-endian 24-bit samples', async () => {
    const blob = await exportAudioBufferToWavAsync(mockBuffer([Float32Array.from([-1, 0, 1])]), 24);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(blob.size).toBe(44 + 9);
    expect(Array.from(bytes.slice(44, 47))).toEqual([0, 0, 128]);
    expect(Array.from(bytes.slice(47, 50))).toEqual([0, 0, 0]);
    expect(Array.from(bytes.slice(50, 53))).toEqual([255, 255, 127]);
  });

  it('rejects more than two channels rather than silently truncating audio', async () => {
    await expect(exportAudioBufferToWavAsync(mockBuffer([
      new Float32Array([0]), new Float32Array([0]), new Float32Array([0])
    ]))).rejects.toThrow(/mono or stereo/);
  });
});
