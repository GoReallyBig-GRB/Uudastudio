import { describe, it, expect } from 'vitest';
import { createCollector, createWavSink, encodePcmBlock, memoryTarget, wavHeaderBytes } from './exportSinks';
import { exportAudioBufferToWav } from './mastering';
import { planMixdown } from './blockMixdown';

const ramp = (n: number, k: number) => Float32Array.from({ length: n }, (_, i) => Math.sin(i * k) * 0.9);
const fakeBuf = (ch: Float32Array[], sr = 48000): AudioBuffer =>
  ({ numberOfChannels: ch.length, sampleRate: sr, length: ch[0].length, getChannelData: (c: number) => ch[c] }) as unknown as AudioBuffer;

describe('WAV sink', () => {
  it.each([16, 24] as const)('written in odd-sized blocks equals the whole-buffer encoder at %i-bit', async (bits) => {
    const L = ramp(10007, 0.01), R = ramp(10007, 0.02);
    const sink = await createWavSink(memoryTarget(), 2, 48000, L.length, bits);
    for (let at = 0, k = 0; at < L.length; k++) {
      const n = Math.min([1, 999, 4096, 33][k % 4], L.length - at);
      await sink.write([L.subarray(at, at + n), R.subarray(at, at + n)], n);
      at += n;
    }
    const a = new Uint8Array(await (await sink.close()).arrayBuffer());
    const b = new Uint8Array(await exportAudioBufferToWav(fakeBuf([L, R]), bits).arrayBuffer());
    expect(a.length).toBe(b.length);
    expect(a.every((v, i) => v === b[i])).toBe(true);
  });

  it('refuses to close if fewer frames were written than the header promised', async () => {
    const sink = await createWavSink(memoryTarget(), 2, 48000, 100, 16);
    await sink.write([new Float32Array(40), new Float32Array(40)], 40);
    let message = '';
    try { await sink.close(); } catch (e) { message = (e as Error).message; }
    expect(message.includes('expected 100')).toBe(true);
  });

  it('rejects a file over the 4 GiB RIFF limit and bad channel counts up front', () => {
    const thrown = (fn: () => unknown) => { try { fn(); return ''; } catch (e) { return (e as Error).message; } };
    expect(/4 GiB/.test(thrown(() => wavHeaderBytes(2, 48000, 0x40000000, 16)))).toBe(true);
    expect(/mono or stereo/.test(thrown(() => wavHeaderBytes(3, 48000, 10, 16)))).toBe(true);
    // 3 hours of 24-bit stereo at 48 kHz fits
    expect(wavHeaderBytes(2, 48000, 3 * 3600 * 48000, 24).length).toBe(44);
  });

  it('quantises like before: full scale, silence and NaN', () => {
    const out = encodePcmBlock([Float32Array.from([-1, 0, 1, NaN])], 0, 4, 16);
    const v = new DataView(out.buffer);
    expect([v.getInt16(0, true), v.getInt16(2, true), v.getInt16(4, true), v.getInt16(6, true)]).toEqual([-32768, 0, 32767, 0]);
  });
});

describe('collector', () => {
  it('collects blocks in order and refuses overflow', async () => {
    const c = createCollector(2, 5);
    await c.write([Float32Array.from([1, 2, 3]), Float32Array.from([4, 5, 6])], 3);
    await c.write([Float32Array.from([7, 8]), Float32Array.from([9, 10])], 2);
    expect(Array.from(c.result().channels[0])).toEqual([1, 2, 3, 7, 8]);
    expect(Array.from(c.result().channels[1])).toEqual([4, 5, 6, 9, 10]);
    let failed = false;
    try { await c.write([new Float32Array(1), new Float32Array(1)], 1); } catch { failed = true; }
    expect(failed).toBe(true);
  });
});

describe('planMixdown', () => {
  const project: any = { tracks: [{ clips: [{ startSeconds: 2, durationSeconds: 10 }] }, { clips: [{ startSeconds: 0, durationSeconds: 30 }] }] };
  it('covers the whole project, or a clamped range', () => {
    expect(planMixdown(project, 48000).totalFrames).toBe(30 * 48000);
    const r = planMixdown(project, 48000, { startSeconds: 10, endSeconds: 99 });
    expect(r.rangeStart).toBe(10);
    expect(r.rangeEnd).toBe(30);
    expect(r.totalFrames).toBe(20 * 48000);
  });
  it('never plans less than one second', () => {
    expect(planMixdown({ tracks: [] } as any, 44100).totalFrames).toBe(44100);
  });
});
