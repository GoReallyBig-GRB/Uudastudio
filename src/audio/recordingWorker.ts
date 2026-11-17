/**
 * Background worker that writes a recording to disk while it is made. Audio blocks arrive straight from the audio thread over a
 * private channel (the page's busy moments cannot delay or drop them) and go into planar float32 files with sync access handles,
 * which are flushed about once a second, so a crash loses at most the last second. The peak file and meta.json are written
 * last, only when the take ends cleanly.
 */
import { PEAK_BASE_SAMPLES_PER_PIXEL, PeakAccumulator } from '../waveform/peakMath';
import { STREAMED_ROOT_DIR } from '../assets/streamedStore';
import type { StreamedMeta } from '../assets/streamedStore';
import { JOURNAL_FILE, type RecordingJournal } from './recordingJournal';

interface SyncHandle { write(data: ArrayBufferView, opts: { at: number }): number; flush(): void; close(): void }

export type RecorderRequest =
  | { type: 'start'; journal: RecordingJournal; port: MessagePort }
  | { type: 'abort' };
export type RecorderMessage =
  | { type: 'started' }
  | { type: 'progress'; frames: number }
  | { type: 'done'; meta: StreamedMeta }
  | { type: 'error'; message: string };

const post = (m: RecorderMessage) => (self as unknown as { postMessage(m: unknown): void }).postMessage(m);

let handles: SyncHandle[] = [];
let dir: FileSystemDirectoryHandle | null = null;
let base: FileSystemDirectoryHandle | null = null;
let journal: RecordingJournal | null = null;
let frames = 0;
let failed = false;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let peaks = new PeakAccumulator(PEAK_BASE_SAMPLES_PER_PIXEL);

const writeFile = async (name: string, data: BufferSource | string) => {
  const fh = await dir!.getFileHandle(name, { create: true });
  const w = await (fh as unknown as { createWritable(): Promise<{ write(d: BufferSource | string): Promise<void>; close(): Promise<void> }> }).createWritable();
  await w.write(data);
  await w.close();
};

const fail = (message: string) => {
  if (failed) return;
  failed = true;
  post({ type: 'error', message });
};

const closeHandles = () => {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  for (const h of handles) { try { h.flush(); h.close(); } catch { /* already closed */ } }
  handles = [];
};

async function begin(j: RecordingJournal, port: MessagePort) {
  journal = j;
  frames = 0;
  failed = false;
  peaks = new PeakAccumulator(PEAK_BASE_SAMPLES_PER_PIXEL);
  const root = await navigator.storage.getDirectory();
  base = await root.getDirectoryHandle(STREAMED_ROOT_DIR, { create: true });
  try { await base.removeEntry(j.storeId, { recursive: true }); } catch { /* none yet */ }
  dir = await base.getDirectoryHandle(j.storeId, { create: true });
  await writeFile(JOURNAL_FILE, JSON.stringify(j)); // first, so even a take cut short at once is found next time
  handles = [];
  for (let c = 0; c < j.channels; c++) {
    const fh = await dir.getFileHandle(`ch${c}.f32`, { create: true });
    handles.push(await (fh as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle());
  }
  flushTimer = setInterval(() => {
    try { for (const h of handles) h.flush(); post({ type: 'progress', frames }); } catch (e) { fail(e instanceof Error ? e.message : String(e)); }
  }, 1000);

  port.onmessage = (e: MessageEvent<{ blocks?: Float32Array[]; end?: boolean }>) => {
    if (failed) return;
    const d = e.data;
    if (d.blocks) {
      try {
        const n = d.blocks[0]?.length ?? 0;
        if (n > 0) {
          for (let c = 0; c < handles.length; c++) {
            const block = d.blocks[Math.min(c, d.blocks.length - 1)];
            const wrote = handles[c].write(new Uint8Array(block.buffer, block.byteOffset, n * 4), { at: frames * 4 });
            if (wrote !== n * 4) throw new Error('The recording could not be written (the device may be full).');
          }
          peaks.push(handles.map((_, c) => d.blocks![Math.min(c, d.blocks!.length - 1)]), n);
          frames += n;
        }
      } catch (err) { fail(err instanceof Error ? err.message : String(err)); }
    }
    if (d.end) void finish();
  };
  post({ type: 'started' });
}

async function finish() {
  if (!journal || !dir || failed) return;
  try {
    closeHandles();
    await writeFile('peaks.f32', peaks.finish() as unknown as BufferSource);
    const meta: StreamedMeta = {
      storeId: journal.storeId, sampleRate: journal.sampleRate, channels: journal.channels, frames,
      durationSeconds: frames / journal.sampleRate, peakBase: PEAK_BASE_SAMPLES_PER_PIXEL, complete: true, createdAt: Date.now(),
    };
    await writeFile('meta.json', JSON.stringify(meta)); // last: marks the take complete
    post({ type: 'done', meta });
  } catch (e) { fail(e instanceof Error ? e.message : String(e)); }
}

self.onmessage = async (e: MessageEvent<RecorderRequest>) => {
  const m = e.data;
  if (m.type === 'start') {
    try { await begin(m.journal, m.port); } catch (err) { fail(err instanceof Error ? err.message : String(err)); }
  } else if (m.type === 'abort') {
    closeHandles();
    try { if (base && journal) await base.removeEntry(journal.storeId, { recursive: true }); } catch { /* nothing to remove */ }
  }
};
