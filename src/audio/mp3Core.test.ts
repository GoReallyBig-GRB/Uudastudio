import { describe, it, expect } from 'vitest';
import { Mp3Core } from './mp3Core';
import { createMp3Sink, memoryTarget } from './exportSinks';

const SR = 44100;
const tone = (frames: number, hz: number) => {
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) out[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / SR) * 12000);
  return out;
};
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const isFrameSync = (b: Uint8Array, at: number) => b[at] === 0xff && (b[at + 1] & 0xe0) === 0xe0;

async function encodeInChunks(left: Int16Array, right: Int16Array, chunk: number, kbps = 192): Promise<Uint8Array> {
  const core = await Mp3Core.create(2, SR, kbps);
  const parts: Uint8Array[] = [];
  for (let o = 0; o < left.length; o += chunk) parts.push(core.encode(left.subarray(o, o + chunk), right.subarray(o, o + chunk)));
  parts.push(core.finish());
  return concat(parts);
}

describe('MP3 encoder (LAME in WebAssembly)', () => {
  it('produces a CBR stream of the expected size that starts on a frame boundary', async () => {
    const frames = SR * 4;
    const bytes = await encodeInChunks(tone(frames, 440), tone(frames, 660), SR);
    expect(isFrameSync(bytes, 0)).toBe(true);
    const expected = (192000 / 8) * (frames / SR);
    expect(Math.abs(bytes.length - expected) < expected * 0.03).toBe(true);
  });

  it('gives the same bytes however the input is split into blocks', async () => {
    const frames = SR * 3 + 777;
    const l = tone(frames, 523), r = tone(frames, 311);
    const whole = await encodeInChunks(l, r, frames);
    const odd = await encodeInChunks(l, r, 10007);
    expect(odd.length).toBe(whole.length);
    let same = true;
    for (let i = 0; i < whole.length; i++) if (whole[i] !== odd[i]) { same = false; break; }
    expect(same).toBe(true);
  });

  it('rejects sample rates MP3 cannot carry, and more than two channels', async () => {
    let rate = '', channels = '';
    try { await Mp3Core.create(2, 96000, 192); } catch (e) { rate = (e as Error).message; }
    try { await Mp3Core.create(6, 48000, 192); } catch (e) { channels = (e as Error).message; }
    expect(rate.includes('96000')).toBe(true);
    expect(channels.includes('mono or stereo')).toBe(true);
  });

  it('the export sink writes a playable stream through the in-thread path (no Worker here)', async () => {
    const frames = SR * 2;
    const sink = createMp3Sink(memoryTarget(), 2, SR, 128);
    const l = Float32Array.from(tone(frames, 440), (v) => v / 32768);
    for (let o = 0; o < frames; o += 30000) {
      const n = Math.min(30000, frames - o);
      await sink.write([l.subarray(o, o + n), l.subarray(o, o + n)], n);
    }
    const blob = await sink.close();
    expect(blob.size > 128000 / 8 * 2 * 0.95).toBe(true);
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    expect(isFrameSync(head, 0)).toBe(true);
  });
});
