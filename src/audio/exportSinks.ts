/**
 * Where exported audio goes, one block at a time: WAV and MP3 writers, and byte targets that write to browser file
 * storage (so a multi-gigabyte export is never held in memory). Every export, of any length, goes through these.
 */
import { Mp3Core } from './mp3Core';
import type { Mp3WorkerIn, Mp3WorkerOut } from './mp3Worker';

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

const toInt16 = (src: Float32Array, frames: number): Int16Array => {
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    const v = src[i];
    const s = Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
};

/** How many blocks may be waiting in the encoder at once (bounds memory while keeping it busy). */
const MP3_MAX_BLOCKS_IN_FLIGHT = 3;

/**
 * MP3 writer. Encoding runs in a worker so rendering the next block overlaps with encoding this one (the page also
 * stays responsive). Where workers are unavailable the same encoding loop runs in place.
 */
export function createMp3Sink(target: ByteTarget, channels: number, sampleRate: number, kbps: number): AudioSink {
  if (channels < 1 || channels > 2) throw new Error(`MP3 export supports mono or stereo audio; received ${channels} channels.`);
  let worker: Worker | null = null;
  try {
    if (typeof Worker !== 'undefined') worker = new Worker(new URL('./mp3Worker.ts', import.meta.url), { type: 'module' });
  } catch { worker = null; }

  const convert = (data: Float32Array[], frames: number) => ({
    left: toInt16(data[0], frames),
    right: channels > 1 ? toInt16(data[1], frames) : undefined,
  });

  if (!worker) {
    const coreReady = Mp3Core.create(channels, sampleRate, kbps);
    coreReady.catch(() => { /* reported by the first write or close */ });
    return {
      async write(data, frames) {
        if (frames <= 0) return;
        const { left, right } = convert(data, frames);
        const bytes = (await coreReady).encode(left, right);
        if (bytes.length > 0) await target.write(bytes);
      },
      async close() {
        const bytes = (await coreReady).finish();
        if (bytes.length > 0) await target.write(bytes);
        return target.finish('audio/mp3');
      },
      abort: () => target.abort(),
    };
  }

  const w = worker;
  let failure: Error | null = null;
  let inFlight = 0;
  let nextId = 0;
  let writes: Promise<void> = Promise.resolve();
  let wake: (() => void) | null = null;
  let finished: ((bytes: Uint8Array) => void) | null = null;
  const settle = () => { const f = wake; wake = null; f?.(); };
  const fail = (e: Error) => { failure = failure ?? e; settle(); finished?.(new Uint8Array(0)); };

  w.onmessage = (e: MessageEvent<Mp3WorkerOut>) => {
    const m = e.data;
    if (m.type === 'data') {
      inFlight--;
      if (m.bytes.length > 0) writes = writes.then(() => target.write(m.bytes)).catch((err) => fail(err instanceof Error ? err : new Error(String(err))));
      settle();
    } else if (m.type === 'done') {
      finished?.(m.bytes);
    } else if (m.type === 'error') {
      fail(new Error(`MP3 encoder failed: ${m.message}`));
    }
  };
  w.onerror = (e) => fail(new Error(`MP3 encoder failed: ${e.message || 'worker error'}`));
  w.postMessage({ type: 'init', channels, sampleRate, kbps } satisfies Mp3WorkerIn);

  return {
    async write(data, frames) {
      if (frames <= 0) return;
      while (inFlight >= MP3_MAX_BLOCKS_IN_FLIGHT && !failure) await new Promise<void>((r) => { wake = r; });
      if (failure) throw failure;
      const { left, right } = convert(data, frames);
      inFlight++;
      const transfer: Transferable[] = [left.buffer];
      if (right) transfer.push(right.buffer);
      w.postMessage({ type: 'encode', id: nextId++, left, right } satisfies Mp3WorkerIn, transfer);
    },
    async close() {
      const last = new Promise<Uint8Array>((resolve) => { finished = resolve; });
      w.postMessage({ type: 'finish' } satisfies Mp3WorkerIn);
      const tail = await last;
      await writes;
      w.terminate();
      if (failure) throw failure;
      if (tail.length > 0) await target.write(tail);
      return target.finish('audio/mp3');
    },
    async abort() {
      w.terminate();
      await target.abort();
    },
  };
}
