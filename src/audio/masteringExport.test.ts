import { describe, expect, it } from 'vitest';
import { exportAudioBufferToWav, exportAudioBufferToWavAsync } from './mastering';

function fakeAudioBuffer(
  channels: Float32Array[],
  sampleRate = 8
): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  return {
    sampleRate,
    length,
    duration: length / sampleRate,
    numberOfChannels: channels.length,
    getChannelData: (channel: number) => channels[channel],
  } as unknown as AudioBuffer;
}

function readAscii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

describe('responsive WAV export', () => {
  it.each([16, 24] as const)(
    'matches the synchronous PCM reference byte-for-byte at %i-bit',
    async (bitDepth) => {
      const input = fakeAudioBuffer([
        new Float32Array([-1, -0.5, 0, 0.5, 1, 0.125]),
        new Float32Array([1, 0.5, 0, -0.5, -1, -0.125]),
      ]);
      const expected = new Uint8Array(await exportAudioBufferToWav(input, bitDepth).arrayBuffer());
      const actual = new Uint8Array(await (await exportAudioBufferToWavAsync(input, bitDepth)).arrayBuffer());

      expect(Array.from(actual)).toEqual(Array.from(expected));
      expect(readAscii(actual, 0, 4)).toBe('RIFF');
      expect(readAscii(actual, 8, 4)).toBe('WAVE');
      expect(readAscii(actual, 36, 4)).toBe('data');
      expect(new DataView(actual.buffer).getUint32(4, true)).toBe(actual.length - 8);
      expect(new DataView(actual.buffer).getUint32(40, true)).toBe(actual.length - 44);
    }
  );

  it('reports monotonic encoding progress and reaches the final block', async () => {
    const input = fakeAudioBuffer([Float32Array.from({ length: 24 }, (_, i) => Math.sin(i))]);
    const progress: number[] = [];
    await exportAudioBufferToWavAsync(input, 16, (update) => progress.push(update.percent));

    expect(progress.length).toBeGreaterThan(1);
    expect(progress[0]).toBe(80);
    expect(progress[progress.length - 1]).toBe(94);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
  });

  it('rejects unsupported channel counts before reading channel data', async () => {
    const input = {
      numberOfChannels: 3,
      sampleRate: 48000,
      length: 10,
      getChannelData: () => {
        throw new Error('must reject before reading samples');
      },
    } as unknown as AudioBuffer;

    await expect(exportAudioBufferToWavAsync(input)).rejects.toThrow(/mono or stereo/);
  });

  it('rejects output exceeding the RIFF 4 GiB limit before allocating sample buffers', async () => {
    const input = {
      numberOfChannels: 2,
      sampleRate: 48000,
      length: 0x40000000,
      getChannelData: () => {
        throw new Error('must reject before reading samples');
      },
    } as unknown as AudioBuffer;

    await expect(exportAudioBufferToWavAsync(input, 16)).rejects.toThrow(/4 GiB size limit/);
  });
});
