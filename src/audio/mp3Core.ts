/**
 * MP3 encoder: LAME (3.99, the reference encoder) compiled to WebAssembly, see tools/lame-wasm.
 * Used inside a worker for exports, and directly where workers are not available. Quality is LAME's default (-q 3),
 * the same setting the previous JavaScript encoder used, at several times the speed.
 */
import { LAME_WASM_BASE64 } from './lame/lameWasm';

const LAME_QUALITY = 3;
/** Sample rates the MP3 standard (MPEG 1/2/2.5) can carry */
export const MP3_SAMPLE_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

interface LameExports {
  memory: WebAssembly.Memory;
  enc_create(channels: number, sampleRate: number, kbps: number, quality: number): number;
  enc_left(frames: number): number;
  enc_right(): number;
  enc_out(): number;
  enc_encode(frames: number, stereo: number): number;
  enc_flush(): number;
  enc_close(): void;
}

let compiled: Promise<WebAssembly.Module> | null = null;
function compileLame(): Promise<WebAssembly.Module> {
  if (!compiled) {
    const bin = atob(LAME_WASM_BASE64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    compiled = WebAssembly.compile(bytes);
  }
  return compiled;
}

export class Mp3Core {
  private constructor(private readonly x: LameExports, private readonly channels: number) {}

  static async create(channels: number, sampleRate: number, kbps: number): Promise<Mp3Core> {
    if (channels < 1 || channels > 2) throw new Error(`MP3 export supports mono or stereo audio; received ${channels} channels.`);
    if (!MP3_SAMPLE_RATES.includes(sampleRate)) {
      throw new Error(`MP3 cannot hold ${sampleRate} Hz audio. Set the project to 48000 Hz or 44100 Hz, or export WAV.`);
    }
    const module = await compileLame();
    const instance = await WebAssembly.instantiate(module, {
      env: { js_sin: Math.sin, js_cos: Math.cos, js_atan: Math.atan, js_exp: Math.exp, js_log: Math.log, js_log10: Math.log10, js_pow: Math.pow },
    });
    const x = instance.exports as unknown as LameExports;
    if (x.enc_create(channels, sampleRate, kbps, LAME_QUALITY) !== 0) throw new Error(`The MP3 encoder rejected ${sampleRate} Hz at ${kbps} kbps.`);
    return new Mp3Core(x, channels);
  }

  /** Encodes a block of 16-bit samples; returns the bytes produced so far (may be empty). */
  encode(left: Int16Array, right?: Int16Array): Uint8Array {
    const n = left.length;
    if (n === 0) return new Uint8Array(0);
    const x = this.x;
    const l = x.enc_left(n);
    new Int16Array(x.memory.buffer, l, n).set(left);
    if (this.channels > 1) new Int16Array(x.memory.buffer, x.enc_right(), n).set(right ?? left);
    const bytes = x.enc_encode(n, this.channels > 1 ? 1 : 0);
    if (bytes < 0) throw new Error(`MP3 encoder error ${bytes}.`);
    return new Uint8Array(x.memory.buffer, x.enc_out(), bytes).slice();
  }

  /** Flushes what the encoder still holds and releases it. */
  finish(): Uint8Array {
    const bytes = this.x.enc_flush();
    const out = bytes > 0 ? new Uint8Array(this.x.memory.buffer, this.x.enc_out(), bytes).slice() : new Uint8Array(0);
    this.x.enc_close();
    return out;
  }
}
