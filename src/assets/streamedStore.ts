/**
 * File-backed storage for long audio, kept in the browser's private file system (OPFS).
 * Layout: uuda-assets/<storeId>/{ch0.f32, ch1.f32, ..., peaks.f32, meta.json}
 * Channels are planar little-endian float32. peaks.f32 is interleaved [min,max] per base bucket.
 * Writing happens in the import worker (sync access handles); this module is the main-thread side:
 * reading ranges, loading peaks, and housekeeping.
 */
import { splitInterleavedPeaks } from '../waveform/peakMath';

export const STREAMED_ROOT_DIR = 'uuda-assets';

export interface StreamedMeta {
  storeId: string;
  sampleRate: number;
  channels: number;
  frames: number;
  durationSeconds: number;
  peakBase: number;
  complete: true;
  createdAt: number;
}

export function streamedStorageAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage && typeof navigator.storage.getDirectory === 'function';
}

async function rootDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(STREAMED_ROOT_DIR, { create });
  } catch {
    return null;
  }
}

export async function getStreamedAssetDir(storeId: string, create = false): Promise<FileSystemDirectoryHandle | null> {
  const root = await rootDir(create);
  if (!root) return null;
  try {
    return await root.getDirectoryHandle(storeId, { create });
  } catch {
    return null;
  }
}

/** Removes a stored asset. Safe to call when it does not exist. */
export async function deleteStreamedAsset(storeId: string): Promise<void> {
  if (!streamedStorageAvailable()) return;
  const root = await rootDir(false);
  if (!root) return;
  try {
    await root.removeEntry(storeId, { recursive: true });
  } catch {
    // Already gone.
  }
}

/**
 * Like deleteStreamedAsset, but retries: a terminated import worker releases its file locks a moment later,
 * and removing a locked directory fails until then.
 */
export async function deleteStreamedAssetWithRetry(storeId: string, delaysMs: number[] = [0, 250, 750, 2000, 5000]): Promise<void> {
  for (const delay of delaysMs) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    if (!streamedStorageAvailable()) return;
    const root = await rootDir(false);
    if (!root) return;
    try {
      await root.removeEntry(storeId, { recursive: true });
      return;
    } catch (e) {
      if ((e as DOMException)?.name === 'NotFoundError') return; // already gone
    }
  }
}

/** Reads meta.json. Returns null if the asset is missing or its import never finished. */
export async function readStreamedMeta(storeId: string): Promise<StreamedMeta | null> {
  const dir = await getStreamedAssetDir(storeId);
  if (!dir) return null;
  try {
    const file = await (await dir.getFileHandle('meta.json')).getFile();
    const meta = JSON.parse(await file.text()) as StreamedMeta;
    return meta && meta.complete === true ? meta : null;
  } catch {
    return null;
  }
}

/** Reads `frames` frames of one channel starting at `startFrame`. May return fewer at the end of the file. */
export async function readStreamedChannelRange(storeId: string, channel: number, startFrame: number, frames: number): Promise<Float32Array> {
  const dir = await getStreamedAssetDir(storeId);
  if (!dir) return new Float32Array(0);
  try {
    const file = await (await dir.getFileHandle(`ch${channel}.f32`)).getFile();
    const start = Math.max(0, Math.floor(startFrame)) * 4;
    const end = Math.min(file.size, start + Math.max(0, Math.floor(frames)) * 4);
    if (end <= start) return new Float32Array(0);
    const bytes = await file.slice(start, end).arrayBuffer();
    return new Float32Array(bytes, 0, Math.floor(bytes.byteLength / 4));
  } catch {
    return new Float32Array(0);
  }
}

/** Reads the same frame range from every channel. */
export async function readStreamedFrames(storeId: string, channels: number, startFrame: number, frames: number): Promise<Float32Array[]> {
  return Promise.all(Array.from({ length: Math.max(1, channels) }, (_, c) => readStreamedChannelRange(storeId, c, startFrame, frames)));
}

/** Loads the base-level peak file fully into memory (about 7 MB per hour of audio). */
export async function readStreamedPeakBase(storeId: string): Promise<{ mins: Float32Array; maxs: Float32Array } | null> {
  const dir = await getStreamedAssetDir(storeId);
  if (!dir) return null;
  try {
    const file = await (await dir.getFileHandle('peaks.f32')).getFile();
    const bytes = await file.arrayBuffer();
    return splitInterleavedPeaks(new Float32Array(bytes, 0, Math.floor(bytes.byteLength / 4)));
  } catch {
    return null;
  }
}

/** Ids of everything stored, including unfinished imports. */
export async function listStreamedAssetIds(): Promise<string[]> {
  const root = await rootDir(false);
  if (!root) return [];
  const ids: string[] = [];
  const iterable = root as unknown as { keys(): AsyncIterable<string> };
  for await (const name of iterable.keys()) ids.push(name);
  return ids;
}
