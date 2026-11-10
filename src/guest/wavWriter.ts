/** Writes the talent's recording as a standard mono WAV file, 16-bit or 24-bit. Pure, unit-tested. */

export type Bits = 16 | 24;
/** One block of recorded samples: 16-bit values, or 24-bit values held in 32-bit slots */
export type Pcm = Int16Array | Int32Array;

export const floatToInt16 = (input: Float32Array): Int16Array => {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const v = Math.max(-1, Math.min(1, input[i]));
    out[i] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
  }
  return out;
};

export const floatToInt24 = (input: Float32Array): Int32Array => {
  const out = new Int32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const v = Math.max(-1, Math.min(1, input[i]));
    out[i] = v < 0 ? Math.round(v * 0x800000) : Math.round(v * 0x7fffff);
  }
  return out;
};

export const floatToPcm = (input: Float32Array, bits: Bits): Pcm => (bits === 24 ? floatToInt24(input) : floatToInt16(input));

/** Back to -1..1 floats, for measuring */
export const pcmToFloat = (chunks: readonly Pcm[], bits: Bits): Float32Array => {
  const n = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Float32Array(n);
  const scale = bits === 24 ? 0x800000 : 0x8000;
  let o = 0;
  for (const c of chunks) for (let i = 0; i < c.length; i++) out[o++] = c[i] / scale;
  return out;
};

/** The 44-byte header for `samples` mono samples */
export const wavHeader = (samples: number, sampleRate: number, bits: Bits = 16): Uint8Array => {
  const width = bits / 8;
  const dataBytes = samples * width;
  const b = new ArrayBuffer(44);
  const v = new DataView(b);
  const tag = (o: number, s: string) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); tag(8, 'WAVE');
  tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * width, true); v.setUint16(32, width, true); v.setUint16(34, bits, true);
  tag(36, 'data'); v.setUint32(40, dataBytes, true);
  return new Uint8Array(b);
};

export const totalSamples = (chunks: readonly Pcm[]): number => chunks.reduce((n, c) => n + c.length, 0);

/** 24-bit values packed three bytes each, little-endian, as a WAV expects */
const pack24 = (c: Int32Array): Uint8Array => {
  const out = new Uint8Array(c.length * 3);
  for (let i = 0, o = 0; i < c.length; i++) { const v = c[i]; out[o++] = v & 0xff; out[o++] = (v >> 8) & 0xff; out[o++] = (v >> 16) & 0xff; }
  return out;
};

export const wavBlob = (chunks: readonly Pcm[], sampleRate: number, bits: Bits = 16): Blob =>
  new Blob([wavHeader(totalSamples(chunks), sampleRate, bits) as BlobPart, ...(bits === 24 ? (chunks as readonly Int32Array[]).map(pack24) : chunks) as unknown as BlobPart[]], { type: 'audio/wav' });

/** Bytes a recording of this length takes as a WAV */
export const wavBytes = (seconds: number, sampleRate: number, bits: Bits = 16): number => 44 + Math.round(seconds * sampleRate) * (bits / 8);

const safe = (s: string) => s.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40);

/** "Voiceover-Intro_Ada_take-2.wav": job, talent and take number, safe on every system */
export const takeFileName = (jobTitle: string, talent: string, take: number): string =>
  `${safe(jobTitle) || 'Voice-recording'}_${safe(talent) || 'Talent'}_take-${take}.wav`;

/** Level of a block of samples, 0 to 1 (peak), for the meter */
export const peakOf = (block: Float32Array): number => {
  let p = 0;
  for (let i = 0; i < block.length; i++) { const a = Math.abs(block[i]); if (a > p) p = a; }
  return p;
};
