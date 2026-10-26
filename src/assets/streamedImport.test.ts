import { describe, expect, it } from 'vitest';
import { id3v2TagLength, isMp3MetadataFrame, parseMp3Header, scanMp3Frames } from './mp3Frames';
import { parseWavHeader, pcmToPlanar } from './wavHeader';

function mp3Frame(size = 417): Uint8Array {
  const f = new Uint8Array(size);
  f.set([0xff, 0xfb, 0x90, 0x00]); // MPEG-1 Layer III, 128 kbps, 44.1 kHz, no padding, stereo
  return f;
}
function join(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

describe('mp3 frame parsing', () => {
  it('reads header fields', () => {
    const h = parseMp3Header(mp3Frame(), 0)!;
    expect(h.size).toBe(417);
    expect(h.sampleRate).toBe(44100);
    expect(h.channels).toBe(2);
    expect(h.samplesPerFrame).toBe(1152);
    expect(h.bitrate).toBe(128000);
  });

  it('rejects non-mp3 bytes and reserved values', () => {
    expect(parseMp3Header(new Uint8Array([0, 0, 0, 0]), 0) === null).toBe(true);
    expect(parseMp3Header(new Uint8Array([0xff, 0xfb, 0xf0, 0x00]), 0) === null).toBe(true); // bad bitrate index
    expect(parseMp3Header(new Uint8Array([0xff, 0xff, 0x90, 0x00]), 0) === null).toBe(true); // layer I/reserved version mix
  });

  it('scans consecutive frames and keeps an unverifiable last frame for the next chunk', () => {
    const data = join(mp3Frame(), mp3Frame(), mp3Frame(), mp3Frame(), mp3Frame());
    const mid = scanMp3Frames(data, false);
    expect(mid.frames.length).toBe(4);
    expect(mid.consumed).toBe(4 * 417);
    const last = scanMp3Frames(data, true);
    expect(last.frames.length).toBe(5);
    expect(last.consumed).toBe(5 * 417);
  });

  it('waits for incomplete frames', () => {
    const data = join(mp3Frame(), mp3Frame().subarray(0, 100));
    const scan = scanMp3Frames(data, true);
    expect(scan.frames.length).toBe(1);
    expect(scan.consumed).toBe(417);
  });

  it('skips garbage and false syncs before real frames', () => {
    const falseSync = new Uint8Array(500);
    falseSync.set([0xff, 0xfb, 0x90, 0x00]); // looks like a header but nothing valid follows after 417 bytes
    const data = join(new Uint8Array(30), falseSync, mp3Frame(), mp3Frame(), mp3Frame());
    const scan = scanMp3Frames(data, true);
    expect(scan.frames.length).toBe(3);
    expect(scan.frames[0].start).toBe(30 + 500);
  });

  it('detects Xing/Info/VBRI metadata frames and ID3 tags', () => {
    const xing = mp3Frame();
    xing.set([0x58, 0x69, 0x6e, 0x67], 36);
    expect(isMp3MetadataFrame(xing)).toBe(true);
    expect(isMp3MetadataFrame(mp3Frame())).toBe(false);
    const id3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 2, 0]);
    expect(id3v2TagLength(id3)).toBe(10 + 256);
    expect(id3v2TagLength(new Uint8Array(10))).toBe(0);
  });
});

function wavHeader(opts: { tag?: number; channels: number; rate: number; bits: number; dataSize: number; extensible?: boolean }): Uint8Array {
  const fmtSize = opts.extensible ? 40 : 16;
  const b = new Uint8Array(12 + 8 + fmtSize + 8);
  const v = new DataView(b.buffer);
  b.set([0x52, 0x49, 0x46, 0x46]); v.setUint32(4, 0, true); b.set([0x57, 0x41, 0x56, 0x45], 8);
  b.set([0x66, 0x6d, 0x74, 0x20], 12); v.setUint32(16, fmtSize, true);
  v.setUint16(20, opts.extensible ? 0xfffe : (opts.tag ?? 1), true);
  v.setUint16(22, opts.channels, true); v.setUint32(24, opts.rate, true);
  v.setUint32(28, opts.rate * opts.channels * (opts.bits / 8), true);
  v.setUint16(32, opts.channels * (opts.bits / 8), true); v.setUint16(34, opts.bits, true);
  if (opts.extensible) { v.setUint16(36, 22, true); v.setUint16(44, opts.tag ?? 1, true); }
  const d = 20 + fmtSize;
  b.set([0x64, 0x61, 0x74, 0x61], d); v.setUint32(d + 4, opts.dataSize, true);
  return b;
}

describe('wav header parsing', () => {
  it('parses 16-bit stereo PCM', () => {
    const head = wavHeader({ channels: 2, rate: 44100, bits: 16, dataSize: 4000 });
    const info = parseWavHeader(head, head.length + 4000)!;
    expect(info.format).toBe('pcm');
    expect(info.channels).toBe(2);
    expect(info.sampleRate).toBe(44100);
    expect(info.frames).toBe(1000);
    expect(info.dataOffset).toBe(head.length);
  });

  it('clamps an oversized or streamed data size to the file length and handles extensible float', () => {
    const head = wavHeader({ tag: 3, channels: 1, rate: 48000, bits: 32, dataSize: 0xffffffff, extensible: true });
    const info = parseWavHeader(head, head.length + 4003)!;
    expect(info.format).toBe('float');
    expect(info.frames).toBe(1000); // 4003 bytes -> 1000 whole 4-byte frames
  });

  it('rejects non-wav and unsupported formats', () => {
    expect(parseWavHeader(new Uint8Array(64), 64) === null).toBe(true);
    const head = wavHeader({ tag: 6, channels: 1, rate: 8000, bits: 8, dataSize: 10 });
    expect(parseWavHeader(head, head.length + 10) === null).toBe(true);
  });

  it('converts 16/24/32-bit and float samples to planar floats', () => {
    const out = [new Float32Array(2), new Float32Array(2)];
    const s16 = new Uint8Array(new Int16Array([16384, -32768, 0, 32767]).buffer);
    pcmToPlanar(s16, { format: 'pcm', bitsPerSample: 16, channels: 2 }, 2, out);
    expect(out[0][0]).toBeCloseTo(0.5, 6); expect(out[1][0]).toBeCloseTo(-1, 6);
    expect(out[0][1]).toBeCloseTo(0, 6); expect(out[1][1]).toBeCloseTo(32767 / 32768, 6);
    const s24 = new Uint8Array([0x00, 0x00, 0x40, 0x00, 0x00, 0xc0]); // 0.5 and -0.5
    const mono = [new Float32Array(2)];
    pcmToPlanar(s24, { format: 'pcm', bitsPerSample: 24, channels: 1 }, 2, mono);
    expect(mono[0][0]).toBeCloseTo(0.5, 6); expect(mono[0][1]).toBeCloseTo(-0.5, 6);
    const s32 = new Uint8Array(new Int32Array([1073741824, -2147483648]).buffer);
    pcmToPlanar(s32, { format: 'pcm', bitsPerSample: 32, channels: 1 }, 2, mono);
    expect(mono[0][0]).toBeCloseTo(0.5, 6); expect(mono[0][1]).toBeCloseTo(-1, 6);
    const f32 = new Uint8Array(new Float32Array([0.25, -0.75]).buffer);
    pcmToPlanar(f32, { format: 'float', bitsPerSample: 32, channels: 1 }, 2, mono);
    expect(mono[0][0]).toBeCloseTo(0.25, 6); expect(mono[0][1]).toBeCloseTo(-0.75, 6);
  });
});
