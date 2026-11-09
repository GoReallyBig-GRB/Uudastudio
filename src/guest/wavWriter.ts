/** Writes the talent's recording as a standard 16-bit mono WAV file. Pure, unit-tested. */

export const floatToInt16 = (input: Float32Array): Int16Array => {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const v = Math.max(-1, Math.min(1, input[i]));
    out[i] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
  }
  return out;
};

/** The 44-byte header for `samples` mono 16-bit samples */
export const wavHeader = (samples: number, sampleRate: number): Uint8Array => {
  const dataBytes = samples * 2;
  const b = new ArrayBuffer(44);
  const v = new DataView(b);
  const tag = (o: number, s: string) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); tag(8, 'WAVE');
  tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, 'data'); v.setUint32(40, dataBytes, true);
  return new Uint8Array(b);
};

export const totalSamples = (chunks: readonly Int16Array[]): number => chunks.reduce((n, c) => n + c.length, 0);

export const wavBlob = (chunks: readonly Int16Array[], sampleRate: number): Blob =>
  new Blob([wavHeader(totalSamples(chunks), sampleRate) as BlobPart, ...(chunks as unknown as BlobPart[])], { type: 'audio/wav' });

/** Bytes a recording of this length takes as a WAV */
export const wavBytes = (seconds: number, sampleRate: number): number => 44 + Math.round(seconds * sampleRate) * 2;

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
