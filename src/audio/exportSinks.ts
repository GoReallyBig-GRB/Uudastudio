/**
 * Where exported audio goes, one block at a time: WAV and MP3 writers, a plain in-memory collector for short results,
 * and byte targets that write to browser file storage (so a multi-gigabyte export is never held in memory).
 *
 * The whole-buffer encoders in mastering.ts feed these same writers, so there is one WAV encoder and one MP3 encoder.
 */
import { Mp3Encoder } from '@breezystack/lamejs';

/** Receives planar float32 blocks in order. `frames` is the valid length of each channel array. */
export interface AudioSink {
  write(channels: Float32Array[], frames: number): Promise<void>;
  /** Finishes the output and returns it. */
  close(): Promise<Blob>;
  /** Releases anything half-written after a failure or cancel. */
  abort(): Promise<void>;
}

/** Where encoded bytes go. */
export interface ByteTarget {
  write(bytes: Uint8Array): Promise<void>;
  finish(mime: string): Promise<Blob>;
  abort(): Promise<void>;
}

export function memoryTarget(): ByteTarget {
  const parts: BlobPart[] = [];
  return {
    async write(bytes) { parts.push(bytes.slice()); },
    async finish(mime) { return new Blob(parts, { type: mime }); },
    async abort() { parts.length = 0; },
  };
}

const EXPORT_DIR = 'uuda-export-temp';

async function exportDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(EXPORT_DIR, { create: true });
}

/** Whether exports can be written to browser file storage instead of memory. */
export function diskExportAvailable(): boolean {
  try {
    return typeof navigator !== 'undefined'
      && !!navigator.storage?.getDirectory
      && typeof (globalThis as any).FileSystemFileHandle !== 'undefined'
      && typeof (globalThis as any).FileSystemFileHandle.prototype.createWritable === 'function';
  } catch { return false; }
}

/** Removes leftovers of earlier exports (their downloads are long finished). Never throws. */
export async function clearExportTemp(): Promise<void> {
  try {
    if (!diskExportAvailable()) return;
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(EXPORT_DIR, { recursive: true });
  } catch { /* nothing to clear */ }
}

/**
 * A byte target backed by a file in browser storage. The finished Blob is the file itself (disk-backed), so even a
 * 3 GB export costs almost no memory. Falls back to memory when storage is unavailable.
 */
export async function createByteTarget(name: string): Promise<ByteTarget> {
  if (!diskExportAvailable()) return memoryTarget();
  try {
    await clearExportTemp();
    const dir = await exportDir();
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await (handle as any).createWritable();
    return {
      async write(bytes) { await writable.write(bytes); },
      async finish(mime) {
        await writable.close();
        const file = await handle.getFile();
        return file.slice(0, file.size, mime);
      },
      async abort() {
        try { await writable.abort(); } catch { /* already closed */ }
        await clearExportTemp();
      },
    };
  } catch {
    return memoryTarget();
  }
}

export const WAV_MAX_DATA_BYTES = 0xffffffff - 36;

export function wavHeaderBytes(channels: number, sampleRate: number, frames: number, bitDepth: 16 | 24): Uint8Array {
  if (channels < 1 || channels > 2) throw new Error(`WAV export supports mono or stereo audio; received ${channels} channels.`);
  if (bitDepth !== 16 && bitDepth !== 24) throw new Error('WAV bit depth must be 16 or 24.');
  const blockAlign = channels * (bitDepth / 8);
  const dataSize = frames * blockAlign;
  if (!Number.isSafeInteger(dataSize) || dataSize > WAV_MAX_DATA_BYTES) {
    throw new Error('This WAV export exceeds the RIFF/WAVE 4 GiB size limit. Export a shorter range or use a future RF64-capable format.');
  }
  const out = new Uint8Array(44);
  const view = new DataView(out.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true); view.setUint16(34, bitDepth, true);
  str(36, 'data'); view.setUint32(40, dataSize, true);
  return out;
}

/** Interleaved little-endian PCM for `frames` frames starting at `start` of each channel. */
export function encodePcmBlock(channels: Float32Array[], start: number, frames: number, bitDepth: 16 | 24): Uint8Array {
  const n = channels.length;
  const bytes = new Uint8Array(frames * n * (bitDepth / 8));
  const view = new DataView(bytes.buffer);
  let o = 0;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < n; c++) {
      const raw = channels[c][start + f];
      const s = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
      if (bitDepth === 16) {
        view.setInt16(o, Math.floor(s < 0 ? s * 0x8000 : s * 0x7fff), true);
        o += 2;
      } else {
        const v = Math.floor(s < 0 ? s * 0x800000 : s * 0x7fffff);
        view.setUint8(o, v & 0xff); view.setUint8(o + 1, (v >> 8) & 0xff); view.setUint8(o + 2, (v >> 16) & 0xff);
        o += 3;
      }
    }
  }
  return bytes;
}

/** WAV writer. The total length must be known up front so the header can be written first. */
export async function createWavSink(
  target: ByteTarget, channels: number, sampleRate: number, totalFrames: number, bitDepth: 16 | 24,
): Promise<AudioSink> {
  await target.write(wavHeaderBytes(channels, sampleRate, totalFrames, bitDepth));
  let written = 0;
  return {
    async write(data, frames) {
      if (frames <= 0) return;
      await target.write(encodePcmBlock(data.slice(0, channels), 0, frames, bitDepth));
      written += frames;
    },
    async close() {
      if (written !== totalFrames) throw new Error(`WAV export wrote ${written} frames but expected ${totalFrames}.`);
      return target.finish('audio/wav');
    },
    abort: () => target.abort(),
  };
}

/** MP3 writer (lamejs). Accepts blocks of any size. */
export function createMp3Sink(target: ByteTarget, channels: number, sampleRate: number, kbps: number): AudioSink {
  if (channels < 1 || channels > 2) throw new Error(`MP3 export supports mono or stereo audio; received ${channels} channels.`);
  const encoder = new Mp3Encoder(channels, sampleRate, kbps);
  const FRAME = 1152;
  let carryL = new Int16Array(0);
  let carryR = new Int16Array(0);
  const toInt = (v: number) => { const s = Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0)); return s < 0 ? s * 0x8000 : s * 0x7fff; };
  // Encoded bytes are batched so storage sees a few large writes instead of one per 1152-sample frame
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  const flush = async () => {
    if (pendingBytes === 0) return;
    const joined = new Uint8Array(pendingBytes);
    let at = 0;
    for (const p of pending) { joined.set(p, at); at += p.length; }
    pending = []; pendingBytes = 0;
    await target.write(joined);
  };
  const encode = async (l: Int16Array, r?: Int16Array) => {
    const buf = encoder.encodeBuffer(l, r);
    if (buf.length > 0) { pending.push(new Uint8Array(buf)); pendingBytes += buf.length; }
    if (pendingBytes >= 262144) await flush();
  };
  const join = (carry: Int16Array, src: Float32Array, frames: number) => {
    const out = new Int16Array(carry.length + frames);
    out.set(carry, 0);
    for (let i = 0; i < frames; i++) out[carry.length + i] = toInt(src[i]);
    return out;
  };
  return {
    async write(data, frames) {
      if (frames <= 0) return;
      const l = join(carryL, data[0], frames);
      const r = channels > 1 ? join(carryR, data[1], frames) : undefined;
      const usable = Math.floor(l.length / FRAME) * FRAME;
      // One 1152-sample frame per call, as the encoder is normally driven
      for (let o = 0; o < usable; o += FRAME) {
        await encode(l.subarray(o, o + FRAME), r?.subarray(o, o + FRAME));
      }
      carryL = l.slice(usable);
      carryR = r ? r.slice(usable) : carryR;
    },
    async close() {
      if (carryL.length > 0) await encode(carryL, channels > 1 ? carryR : undefined);
      const end = encoder.flush();
      if (end.length > 0) { pending.push(new Uint8Array(end)); pendingBytes += end.length; }
      await flush();
      return target.finish('audio/mp3');
    },
    abort: () => target.abort(),
  };
}

/** Collects blocks into planar arrays: for short results that are auditioned or reused from memory. */
export interface CollectedAudio { channels: Float32Array[]; frames: number }
export function createCollector(channels: number, totalFrames: number): AudioSink & { result(): CollectedAudio } {
  const out = Array.from({ length: channels }, () => new Float32Array(totalFrames));
  let at = 0;
  return {
    async write(data, frames) {
      if (at + frames > totalFrames) throw new Error('More audio arrived than the collector was sized for.');
      for (let c = 0; c < channels; c++) out[c].set(data[Math.min(c, data.length - 1)].subarray(0, frames), at);
      at += frames;
    },
    async close() { return new Blob(); },
    async abort() { /* nothing held outside */ },
    result() { return { channels: out, frames: at }; },
  };
}
