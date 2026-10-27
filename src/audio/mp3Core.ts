/**
 * The MP3 encoding loop: feeds the lamejs encoder one 1152-sample frame at a time (carrying leftovers between calls)
 * and returns the encoded bytes. Used inside a worker for exports, and directly where workers are not available.
 */
import { Mp3Encoder } from '@breezystack/lamejs';

export const MP3_FRAME_SAMPLES = 1152;

export class Mp3Core {
  private readonly encoder: Mp3Encoder;
  private carryL = new Int16Array(0);
  private carryR = new Int16Array(0);

  constructor(private readonly channels: number, sampleRate: number, kbps: number) {
    if (channels < 1 || channels > 2) throw new Error(`MP3 export supports mono or stereo audio; received ${channels} channels.`);
    this.encoder = new Mp3Encoder(channels, sampleRate, kbps);
  }

  private static join(carry: Int16Array, next: Int16Array): Int16Array {
    if (carry.length === 0) return next;
    const out = new Int16Array(carry.length + next.length);
    out.set(carry, 0);
    out.set(next, carry.length);
    return out;
  }

  /** Encodes as many whole frames as the input allows; returns the bytes produced. */
  encode(left: Int16Array, right?: Int16Array): Uint8Array {
    const l = Mp3Core.join(this.carryL, left);
    const r = this.channels > 1 ? Mp3Core.join(this.carryR, right ?? left) : undefined;
    const usable = Math.floor(l.length / MP3_FRAME_SAMPLES) * MP3_FRAME_SAMPLES;
    const parts: Uint8Array[] = [];
    let bytes = 0;
    for (let o = 0; o < usable; o += MP3_FRAME_SAMPLES) {
      const out = this.encoder.encodeBuffer(l.subarray(o, o + MP3_FRAME_SAMPLES), r?.subarray(o, o + MP3_FRAME_SAMPLES));
      if (out.length > 0) { const u = new Uint8Array(out); parts.push(u); bytes += u.length; }
    }
    this.carryL = l.slice(usable);
    this.carryR = r ? r.slice(usable) : this.carryR;
    return Mp3Core.concat(parts, bytes);
  }

  /** Encodes what is left and flushes the encoder. */
  finish(): Uint8Array {
    const parts: Uint8Array[] = [];
    let bytes = 0;
    if (this.carryL.length > 0) {
      const out = this.encoder.encodeBuffer(this.carryL, this.channels > 1 ? this.carryR : undefined);
      if (out.length > 0) { const u = new Uint8Array(out); parts.push(u); bytes += u.length; }
    }
    const end = this.encoder.flush();
    if (end.length > 0) { const u = new Uint8Array(end); parts.push(u); bytes += u.length; }
    return Mp3Core.concat(parts, bytes);
  }

  private static concat(parts: Uint8Array[], bytes: number): Uint8Array {
    if (parts.length === 1) return parts[0];
    const out = new Uint8Array(bytes);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }
}
