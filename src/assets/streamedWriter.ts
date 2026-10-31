/**
 * Writes a NEW stored asset (planar float32 per channel plus a peak file) one block at a time, from the main thread, so a
 * processed copy of a long clip never has to be held in memory. meta.json is written last: a run that is cancelled or fails
 * leaves nothing that looks finished (abort() removes the partial files).
 */
import { PEAK_BASE_SAMPLES_PER_PIXEL, PeakAccumulator } from '../waveform/peakMath';
import { STREAMED_ROOT_DIR, StreamedMeta, deleteStreamedAsset, streamedStorageAvailable } from './streamedStore';

export interface StreamedWriter {
  storeId: string;
  /** Append one block (planar channels, same length in each) */
  write: (chunk: Float32Array[]) => Promise<void>;
  /** Close the files, write the peaks and meta.json. Returns the finished meta. */
  finish: () => Promise<StreamedMeta>;
  /** Stop and remove everything written so far. Never throws. */
  abort: () => Promise<void>;
}

interface WritableLike {
  write(data: BufferSource | string): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export const streamedWriterAvailable = (): boolean => streamedStorageAvailable();

export async function createStreamedWriter(storeId: string, sampleRate: number, channels: number): Promise<StreamedWriter> {
  if (!streamedStorageAvailable()) throw new Error('This browser cannot keep long audio in file storage.');
  const root = await navigator.storage.getDirectory();
  const base = await root.getDirectoryHandle(STREAMED_ROOT_DIR, { create: true });
  try { await base.removeEntry(storeId, { recursive: true }); } catch { /* none yet */ }
  const dir = await base.getDirectoryHandle(storeId, { create: true });
  const writables: WritableLike[] = [];
  for (let c = 0; c < channels; c++) {
    const fh = await dir.getFileHandle(`ch${c}.f32`, { create: true });
    writables.push(await (fh as unknown as { createWritable(): Promise<WritableLike> }).createWritable());
  }
  const peaks = new PeakAccumulator(PEAK_BASE_SAMPLES_PER_PIXEL);
  let frames = 0;
  let closed = false;

  const writeFile = async (name: string, data: BufferSource | string) => {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await (fh as unknown as { createWritable(): Promise<WritableLike> }).createWritable();
    await w.write(data);
    await w.close();
  };

  return {
    storeId,
    async write(chunk) {
      const n = chunk[0]?.length ?? 0;
      if (n === 0) return;
      for (let c = 0; c < channels; c++) {
        const src = chunk[Math.min(c, chunk.length - 1)];
        await writables[c].write(src as unknown as BufferSource);
      }
      peaks.push(chunk, n);
      frames += n;
    },
    async finish() {
      for (const w of writables) await w.close();
      closed = true;
      await writeFile('peaks.f32', peaks.finish() as unknown as BufferSource);
      const meta: StreamedMeta = {
        storeId, sampleRate, channels, frames, durationSeconds: frames / sampleRate,
        peakBase: PEAK_BASE_SAMPLES_PER_PIXEL, complete: true, createdAt: Date.now(),
      };
      await writeFile('meta.json', JSON.stringify(meta));
      return meta;
    },
    async abort() {
      if (!closed) for (const w of writables) { try { await w.abort(); } catch { /* already closed */ } }
      closed = true;
      await deleteStreamedAsset(storeId);
    },
  };
}
