/**
 * Main-thread entry point for importing long audio as a streamed asset.
 * Short files keep using the existing in-memory decode path; only files large enough that the
 * in-memory path would run the browser out of memory are streamed to disk.
 */
import type { Asset } from '../types';
import { streamedStorageAvailable, deleteStreamedAssetWithRetry } from './streamedStore';
import type { ImportMessage } from './streamImportWorker';

/** Compressed size from which an MP3 decodes to roughly 1.5 GB or more. */
export const STREAM_IMPORT_MIN_BYTES_MP3 = 75 * 1024 * 1024;
/** WAV decodes to about 2x its size as float32 plus copies; stream from 500 MB. */
export const STREAM_IMPORT_MIN_BYTES_WAV = 500 * 1024 * 1024;

export type StreamImportKind = 'mp3' | 'wav';

export function streamImportKind(file: Pick<File, 'name' | 'type'>): StreamImportKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.mp3') || file.type === 'audio/mpeg') return 'mp3';
  if (name.endsWith('.wav') || file.type === 'audio/wav' || file.type === 'audio/x-wav') return 'wav';
  return null;
}

export function shouldStreamImport(file: Pick<File, 'name' | 'type' | 'size'>): boolean {
  const kind = streamImportKind(file);
  if (!kind || !streamedStorageAvailable() || typeof Worker === 'undefined') return false;
  if (kind === 'mp3' && typeof (globalThis as { AudioDecoder?: unknown }).AudioDecoder === 'undefined') return false;
  return file.size >= (kind === 'mp3' ? STREAM_IMPORT_MIN_BYTES_MP3 : STREAM_IMPORT_MIN_BYTES_WAV);
}

export interface StreamImportHandle {
  promise: Promise<Asset>;
  cancel(): void;
}

export function importStreamedFile(file: File, assetId: string, onProgress: (fraction: number, decodedSeconds: number) => void): StreamImportHandle {
  const kind = streamImportKind(file);
  let worker: Worker | null = null;
  let settled = false;
  let rejectFn: (e: Error) => void = () => {};
  const promise = new Promise<Asset>((resolve, reject) => {
    rejectFn = reject;
    if (!kind) { reject(new Error('Unsupported file type for streamed import.')); return; }
    worker = new Worker(new URL('./streamImportWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<ImportMessage>) => {
      const m = ev.data;
      if (m.type === 'progress') { onProgress(m.fraction, m.decodedSeconds); return; }
      settled = true;
      worker?.terminate();
      if (m.type === 'error') { reject(new Error(m.message)); return; }
      resolve({
        id: assetId,
        name: file.name,
        kind: 'import',
        source: { storeId: m.meta.storeId, frames: m.meta.frames, peakBaseSamplesPerPixel: m.meta.peakBase },
        sampleRate: m.meta.sampleRate,
        durationSeconds: m.meta.durationSeconds,
        numberOfChannels: m.meta.channels,
      });
    };
    worker.onerror = (ev) => {
      settled = true;
      worker?.terminate();
      reject(new Error(ev.message || 'The import worker could not start.'));
    };
    worker.postMessage({ type: 'import', file, storeId: assetId, kind });
  });
  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      worker?.terminate();
      void deleteStreamedAssetWithRetry(assetId);
      rejectFn(new Error('Import cancelled.'));
    },
  };
}
