/**
 * Main-thread side of recording to disk. Builds the capture node (an AudioWorklet that sends blocks straight to the writer
 * worker), gives the page small peak messages for the live waveform, and finishes or recovers takes. Never holds the take in memory.
 */
import { PEAK_BASE_SAMPLES_PER_PIXEL, PeakAccumulator } from '../waveform/peakMath';
import { STREAMED_ROOT_DIR, getStreamedAssetDir, readStreamedChannelRange, streamedStorageAvailable, type StreamedMeta } from '../assets/streamedStore';
import { JOURNAL_FILE, STALE_AFTER_MS, isStale, newRecordingId, parseJournal, recoverableFrames, type RecordingJournal } from './recordingJournal';
import type { RecorderMessage } from './recordingWorker';

const WORKLET = `
class Rec extends AudioWorkletProcessor {
  constructor(){
    super();
    this.n = 0; this.size = 4096; this.out = null; this.stopped = false; this.mono = false;
    this.a = new Float32Array(this.size); this.b = new Float32Array(this.size);
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.out) { this.out = d.out; this.mono = !!d.mono; }
      if (d.stop) { this.flush(); if (this.out) this.out.postMessage({ end: true }); this.stopped = true; }
    };
  }
  flush(){
    if (!this.n || !this.out) return;
    const n = this.n;
    const a = this.a.slice(0, n), b = this.b.slice(0, n);
    const q = n >> 2; const pk = [0, 0, 0, 0];
    for (let s = 0; s < 4; s++) { let p = 0; for (let i = s * q; i < (s + 1) * q; i++) { const x = Math.abs(a[i]), y = this.mono ? 0 : Math.abs(b[i]); if (x > p) p = x; if (y > p) p = y; } pk[s] = p; }
    this.port.postMessage({ pk, frames: n });
    const blocks = this.mono ? [a] : [a, b];
    this.out.postMessage({ blocks }, blocks.map((x) => x.buffer));
    this.n = 0;
  }
  process(inputs){
    if (this.stopped) return false;
    const l = inputs[0] && inputs[0][0], r = inputs[0] && inputs[0][1];
    if (l && this.out) {
      for (let i = 0; i < l.length; i++) {
        this.a[this.n] = l[i]; this.b[this.n] = r ? r[i] : l[i]; this.n++;
        if (this.n === this.size) this.flush();
      }
    }
    return true;
  }
}
registerProcessor('uuda-rec', Rec);`;

export const diskRecordingAvailable = (): boolean =>
  streamedStorageAvailable() && typeof Worker !== 'undefined' && typeof AudioWorkletNode !== 'undefined';

export interface DiskRecording {
  /** Connect the last node of the input chain to this, and connect it on to the destination through a silent gain so the browser keeps it running */
  node: AudioWorkletNode;
  storeId: string;
  /** Resolves with the finished take once the audio thread and the writer have both finished */
  stop(): Promise<StreamedMeta>;
  /** Throw everything away */
  abort(): Promise<void>;
}

export interface DiskRecordingHandlers {
  /** Four loudness values per block and the block's frame count */
  onPeaks: (pk: number[], frames: number) => void;
  /** The writer could not keep going (disk full, storage blocked). What was written stays. */
  onError: (message: string) => void;
}

let moduleLoadedFor: AudioContext | null = null;

export async function startDiskRecording(ctx: AudioContext, channels: number, name: string, h: DiskRecordingHandlers): Promise<DiskRecording> {
  if (moduleLoadedFor !== ctx) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    moduleLoadedFor = ctx;
  }
  const ch = Math.max(1, Math.min(2, Math.floor(channels)));
  const journal: RecordingJournal = { storeId: newRecordingId(), sampleRate: ctx.sampleRate, channels: ch, startedAt: Date.now(), name };
  const worker = new Worker(new URL('./recordingWorker.ts', import.meta.url), { type: 'module' });
  const node = new AudioWorkletNode(ctx, 'uuda-rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit', outputChannelCount: [1] });
  const channel = new MessageChannel();

  let resolveDone: (m: StreamedMeta) => void = () => {};
  let rejectDone: (e: Error) => void = () => {};
  const done = new Promise<StreamedMeta>((res, rej) => { resolveDone = res; rejectDone = rej; });
  const started = new Promise<void>((res, rej) => {
    worker.onmessage = (e: MessageEvent<RecorderMessage>) => {
      const m = e.data;
      if (m.type === 'started') res();
      else if (m.type === 'done') { worker.terminate(); resolveDone(m.meta); }
      else if (m.type === 'error') { h.onError(m.message); rej(new Error(m.message)); rejectDone(new Error(m.message)); }
    };
    worker.onerror = (ev) => { const msg = ev.message || 'The recording writer could not start.'; rej(new Error(msg)); rejectDone(new Error(msg)); };
  });
  worker.postMessage({ type: 'start', journal, port: channel.port1 }, [channel.port1]);
  await started; // the files exist before the first sound is taken
  node.port.onmessage = (e: MessageEvent<{ pk: number[]; frames: number }>) => h.onPeaks(e.data.pk, e.data.frames);
  node.port.postMessage({ out: channel.port2, mono: ch === 1 }, [channel.port2]);

  return {
    node,
    storeId: journal.storeId,
    stop: () => { node.port.postMessage({ stop: true }); return done; },
    abort: async () => {
      try { node.disconnect(); } catch { /* not connected */ }
      worker.postMessage({ type: 'abort' });
      setTimeout(() => worker.terminate(), 500);
    },
  };
}

export interface UnfinishedRecording { journal: RecordingJournal; frames: number; seconds: number }

/** Recordings that were cut short: a journal but no meta.json, and nothing written to them for a while. */
export async function findUnfinishedRecordings(now = Date.now()): Promise<UnfinishedRecording[]> {
  if (!streamedStorageAvailable()) return [];
  const out: UnfinishedRecording[] = [];
  try {
    const root = await navigator.storage.getDirectory();
    const base = await root.getDirectoryHandle(STREAMED_ROOT_DIR);
    const names: string[] = [];
    for await (const n of (base as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(n);
    for (const id of names) {
      const dir = await getStreamedAssetDir(id);
      if (!dir) continue;
      try { await dir.getFileHandle('meta.json'); continue; } catch { /* no meta: maybe cut short */ }
      let journal: RecordingJournal | null = null;
      try { journal = parseJournal(await (await (await dir.getFileHandle(JOURNAL_FILE)).getFile()).text()); } catch { continue; }
      if (!journal) continue;
      const sizes: number[] = [];
      let newest = 0;
      for (let c = 0; c < journal.channels; c++) {
        try { const f = await (await dir.getFileHandle(`ch${c}.f32`)).getFile(); sizes.push(f.size); newest = Math.max(newest, f.lastModified); } catch { sizes.push(0); }
      }
      if (!isStale(newest || journal.startedAt, now)) continue;
      const frames = recoverableFrames(sizes);
      if (frames < journal.sampleRate / 2) continue; // under half a second: nothing worth keeping
      out.push({ journal, frames, seconds: frames / journal.sampleRate });
    }
  } catch { /* nothing stored yet */ }
  return out.sort((a, b) => b.journal.startedAt - a.journal.startedAt);
}

/** Closes a cut-short recording: works out the waveform from what was written and marks it complete. */
export async function recoverRecording(u: UnfinishedRecording): Promise<StreamedMeta> {
  const { journal, frames } = u;
  const dir = await getStreamedAssetDir(journal.storeId);
  if (!dir) throw new Error('The recording is no longer on this device.');
  const peaks = new PeakAccumulator(PEAK_BASE_SAMPLES_PER_PIXEL);
  const BLOCK = 1 << 18;
  for (let at = 0; at < frames; at += BLOCK) {
    const n = Math.min(BLOCK, frames - at);
    const planar = await Promise.all(Array.from({ length: journal.channels }, (_, c) => readStreamedChannelRange(journal.storeId, c, at, n)));
    if (planar.some((p) => p.length < n)) throw new Error('Part of the recording could not be read back.');
    peaks.push(planar, n);
  }
  const put = async (name: string, data: BufferSource | string) => {
    const w = await (await dir.getFileHandle(name, { create: true }) as unknown as { createWritable(): Promise<{ write(d: BufferSource | string): Promise<void>; close(): Promise<void> }> }).createWritable();
    await w.write(data);
    await w.close();
  };
  await put('peaks.f32', peaks.finish() as unknown as BufferSource);
  const meta: StreamedMeta = {
    storeId: journal.storeId, sampleRate: journal.sampleRate, channels: journal.channels, frames,
    durationSeconds: frames / journal.sampleRate, peakBase: PEAK_BASE_SAMPLES_PER_PIXEL, complete: true, createdAt: Date.now(),
  };
  await put('meta.json', JSON.stringify(meta));
  return meta;
}

export { STALE_AFTER_MS };
