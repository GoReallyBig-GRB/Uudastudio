/**
 * Background worker: reads an MP3 or WAV file in pieces, writes planar float32 channel files and a peak file
 * to OPFS, and never holds more than a few MB of audio in memory. Runs off the UI thread.
 */
import { id3v2TagLength, isMp3MetadataFrame, scanMp3Frames } from './mp3Frames';
import { parseWavHeader, pcmToPlanar } from './wavHeader';
import { PEAK_BASE_SAMPLES_PER_PIXEL, PeakAccumulator } from '../waveform/peakMath';
import { STREAMED_ROOT_DIR } from './streamedStore';
import type { StreamedMeta } from './streamedStore';

interface SyncHandle {
  write(data: ArrayBufferView, opts: { at: number }): number;
  flush(): void;
  close(): void;
}
export interface ImportRequest { type: 'import'; file: File; storeId: string; kind: 'mp3' | 'wav' }
export type ImportMessage =
  | { type: 'progress'; fraction: number; decodedSeconds: number }
  | { type: 'done'; meta: StreamedMeta }
  | { type: 'error'; message: string };

const post = (m: ImportMessage) => (self as unknown as { postMessage(m: unknown): void }).postMessage(m);
const MB = 1024 * 1024;

async function createOutputs(storeId: string, channels: number) {
  const root = await navigator.storage.getDirectory();
  const base = await root.getDirectoryHandle(STREAMED_ROOT_DIR, { create: true });
  try { await base.removeEntry(storeId, { recursive: true }); } catch { /* none yet */ }
  const dir = await base.getDirectoryHandle(storeId, { create: true });
  const handles: SyncHandle[] = [];
  for (let c = 0; c < channels; c++) {
    const fh = await dir.getFileHandle(`ch${c}.f32`, { create: true });
    handles.push(await (fh as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle());
  }
  return { base, dir, handles };
}

async function finishOutputs(dir: FileSystemDirectoryHandle, peaks: Float32Array, meta: StreamedMeta): Promise<void> {
  const writeFile = async (name: string, data: BufferSource | string) => {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await (fh as unknown as { createWritable(): Promise<{ write(d: BufferSource | string): Promise<void>; close(): Promise<void> }> }).createWritable();
    await w.write(data);
    await w.close();
  };
  await writeFile('peaks.f32', peaks as unknown as BufferSource);
  await writeFile('meta.json', JSON.stringify(meta)); // written last: marks the import complete
}

async function importMp3(file: File, storeId: string): Promise<StreamedMeta> {
  const Decoder = (globalThis as unknown as { AudioDecoder?: typeof AudioDecoder }).AudioDecoder;
  if (!Decoder) throw new Error('This browser cannot decode MP3 in chunks (WebCodecs missing).');
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  let pos = id3v2TagLength(head);
  let carry: Uint8Array = new Uint8Array(0);
  let decoder: AudioDecoder | null = null;
  let outputs: Awaited<ReturnType<typeof createOutputs>> | null = null;
  let sampleRate = 0, channels = 0, frameIndex = 0, decodedFrames = 0, firstFrame = true;
  let failure: string | null = null;
  const peaks = new PeakAccumulator(PEAK_BASE_SAMPLES_PER_PIXEL);
  const tmp: Float32Array[] = [];
  let lastPost = 0;

  const onAudio = (ad: AudioData) => {
    try {
      const frames = ad.numberOfFrames;
      const have = Math.min(ad.numberOfChannels, channels);
      for (let c = 0; c < channels; c++) if (!tmp[c] || tmp[c].length < frames) tmp[c] = new Float32Array(frames);
      for (let c = 0; c < have; c++) ad.copyTo(tmp[c], { planeIndex: c, format: 'f32-planar' });
      for (let c = have; c < channels; c++) tmp[c].set(tmp[0].subarray(0, frames)); // mono source into a stereo file
      for (let c = 0; c < channels; c++) {
        const wrote = outputs!.handles[c].write(new Uint8Array(tmp[c].buffer, 0, frames * 4), { at: decodedFrames * 4 });
        if (wrote !== frames * 4) throw new Error('Storage write was incomplete (disk full?).');
      }
      peaks.push(tmp.slice(0, channels), frames);
      decodedFrames += frames;
    } catch (e) {
      if (!failure) failure = e instanceof Error ? e.message : String(e);
    } finally {
      ad.close();
    }
  };

  try {
    while (pos < file.size && !failure) {
      const slice = new Uint8Array(await file.slice(pos, Math.min(file.size, pos + MB)).arrayBuffer());
      pos += slice.length;
      const data = new Uint8Array(carry.length + slice.length);
      data.set(carry); data.set(slice, carry.length);
      const scan = scanMp3Frames(data, pos >= file.size);
      for (const f of scan.frames) {
        const bytes = data.subarray(f.start, f.start + f.header.size);
        if (firstFrame) {
          firstFrame = false;
          if (isMp3MetadataFrame(bytes)) continue; // Xing/Info frame: no audio
        }
        if (!decoder) {
          sampleRate = f.header.sampleRate;
          channels = f.header.channels;
          const config = { codec: 'mp3', sampleRate, numberOfChannels: channels };
          const support = await Decoder.isConfigSupported(config);
          if (!support.supported) throw new Error('This browser cannot decode this MP3.');
          outputs = await createOutputs(storeId, channels);
          decoder = new Decoder({ output: onAudio, error: (e) => { if (!failure) failure = `Decoder error: ${e.message}`; } });
          decoder.configure(config);
        }
        if (failure || decoder.state === 'closed') break;
        decoder.decode(new EncodedAudioChunk({
          type: 'key',
          timestamp: Math.round((frameIndex * f.header.samplesPerFrame) / sampleRate * 1e6),
          data: bytes,
        }));
        frameIndex++;
        if (decoder.decodeQueueSize > 300) await new Promise((r) => setTimeout(r, 0));
      }
      carry = data.slice(scan.consumed);
      const now = performance.now();
      if (now - lastPost > 250) { lastPost = now; post({ type: 'progress', fraction: pos / file.size, decodedSeconds: sampleRate ? decodedFrames / sampleRate : 0 }); }
    }
    if (decoder && !failure) await decoder.flush();
    if (failure) throw new Error(failure);
    if (!decoder || !outputs || decodedFrames === 0) throw new Error('No audio could be read from this MP3.');
    outputs.handles.forEach((h) => { h.flush(); h.close(); });
    const meta: StreamedMeta = { storeId, sampleRate, channels, frames: decodedFrames, durationSeconds: decodedFrames / sampleRate, peakBase: PEAK_BASE_SAMPLES_PER_PIXEL, complete: true, createdAt: Date.now() };
    await finishOutputs(outputs.dir, peaks.finish(), meta);
    return meta;
  } catch (e) {
    try { decoder && decoder.state !== 'closed' && decoder.close(); } catch { /* ignore */ }
    outputs?.handles.forEach((h) => { try { h.close(); } catch { /* ignore */ } });
    if (outputs) { try { await outputs.base.removeEntry(storeId, { recursive: true }); } catch { /* ignore */ } }
    throw e;
  }
}

async function importWav(file: File, storeId: string): Promise<StreamedMeta> {
  const info = parseWavHeader(new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer()), file.size);
  if (!info || info.frames <= 0) throw new Error('Unsupported or empty WAV file.');
  const outputs = await createOutputs(storeId, info.channels);
  const peaks = new PeakAccumulator(PEAK_BASE_SAMPLES_PER_PIXEL);
  const FRAMES_PER_READ = 262144;
  const planar = Array.from({ length: info.channels }, () => new Float32Array(FRAMES_PER_READ));
  let done = 0, lastPost = 0;
  try {
    while (done < info.frames) {
      const frames = Math.min(FRAMES_PER_READ, info.frames - done);
      const start = info.dataOffset + done * info.bytesPerFrame;
      const bytes = new Uint8Array(await file.slice(start, start + frames * info.bytesPerFrame).arrayBuffer());
      const got = Math.floor(bytes.length / info.bytesPerFrame);
      if (got === 0) break;
      pcmToPlanar(bytes, info, got, planar);
      for (let c = 0; c < info.channels; c++) {
        const wrote = outputs.handles[c].write(new Uint8Array(planar[c].buffer, 0, got * 4), { at: done * 4 });
        if (wrote !== got * 4) throw new Error('Storage write was incomplete (disk full?).');
      }
      peaks.push(planar, got);
      done += got;
      const now = performance.now();
      if (now - lastPost > 250) { lastPost = now; post({ type: 'progress', fraction: done / info.frames, decodedSeconds: done / info.sampleRate }); }
    }
    outputs.handles.forEach((h) => { h.flush(); h.close(); });
    const meta: StreamedMeta = { storeId, sampleRate: info.sampleRate, channels: info.channels, frames: done, durationSeconds: done / info.sampleRate, peakBase: PEAK_BASE_SAMPLES_PER_PIXEL, complete: true, createdAt: Date.now() };
    await finishOutputs(outputs.dir, peaks.finish(), meta);
    return meta;
  } catch (e) {
    outputs.handles.forEach((h) => { try { h.close(); } catch { /* ignore */ } });
    try { await outputs.base.removeEntry(storeId, { recursive: true }); } catch { /* ignore */ }
    throw e;
  }
}

self.onmessage = async (e: MessageEvent<ImportRequest>) => {
  if (e.data.type !== 'import') return;
  try {
    const meta = e.data.kind === 'mp3' ? await importMp3(e.data.file, e.data.storeId) : await importWav(e.data.file, e.data.storeId);
    post({ type: 'done', meta });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
