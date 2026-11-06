/**
 * Effects (delay, EQ, chorus, flanger, phaser, reverb) on audio of any length, block by block.
 *
 * Each block is rendered on its own, with the effect's decay tail added after it. The tail of one block is added on top of
 * the start of the next (overlap-add). For effects that are linear and fixed in time (delay, EQ, reverb) this gives the
 * same samples as rendering the whole clip at once. Chorus, flanger and phaser sweep with a slow oscillator that restarts
 * at the start of each block, so their sweep position jumps back at every block boundary.
 */
import type { Asset, Clip, ReverbParams, TrackEffect } from '../../types';
import { createStreamedWriter, StreamedWriter } from '../../assets/streamedWriter';
import { ChunkedCancelled, createVirtualSource } from '../chunkedProcess';
import type { PieceSource } from '../chunkedProcess';
import { pieceFromClip } from '../chunkedJob';
import type { ChunkedJobResult } from '../chunkedJob';
import { renderBufferWithEffect } from './dspChain';
import { nextPow2 } from './fftConvolve';
import { buildReverbKernel } from './reverbKernel';
import { ReverbPool } from './reverbPool';

export const EFFECT_BLOCK_SECONDS = 30;

interface OverlapAddOptions {
  source: { totalFrames: number; read: (start: number, count: number) => Promise<Float32Array[]> };
  sampleRate: number;
  blockSeconds?: number;
  /** Renders one block; the result is the block plus its decay tail (so at least as long as the block). */
  render: (block: Float32Array[]) => Promise<Float32Array[]>;
  write: (chunk: Float32Array[]) => Promise<void>;
  onProgress?: (fraction: number) => void;
  signal?: { aborted: boolean };
  /** Write the final decay tail after the last block (default). False keeps the output exactly as long as the input,
   *  for a piece in the middle of a track whose next piece starts where this one ends. */
  keepTail?: boolean;
  /** How many blocks are rendered at the same time (default 1). Reading, tail adding and writing stay in order, so the
   *  result is identical for any value; rendering is what takes the time and runs on the audio threads. */
  concurrency?: number;
  /** Filled in with where the time went, in milliseconds (render is wall time of each group of blocks) */
  timing?: { readMs: number; renderMs: number; writeMs: number; blocks: number };
}

/** Returns the number of frames written (the clip length, plus the final decay tail unless keepTail is false). */
export const overlapAddRender = async (opts: OverlapAddOptions): Promise<number> => {
  const blockFrames = Math.max(1, Math.round((opts.blockSeconds ?? EFFECT_BLOCK_SECONDS) * opts.sampleRate));
  let carry: Float32Array[] = [];
  let written = 0;
  const group = Math.max(1, Math.floor(opts.concurrency ?? 1));
  const timing = opts.timing;
  const starts: number[] = [];
  for (let start = 0; start < opts.source.totalFrames; start += blockFrames) starts.push(start);

  const readGroup = async (g: number): Promise<Float32Array[][]> => {
    const inputs: Float32Array[][] = [];
    for (const start of starts.slice(g, g + group)) {
      const frames = Math.min(blockFrames, opts.source.totalFrames - start);
      inputs.push(await opts.source.read(start, frames));
    }
    return inputs;
  };
  // Reading the next group and writing the previous one happen while this group renders, so only render time is waited on
  // (the timing figures count only the time actually spent waiting).
  let nextInputs: Promise<Float32Array[][]> | null = starts.length > 0 ? readGroup(0) : null;
  nextInputs?.catch(() => undefined);
  let pendingWrite: Promise<void> = Promise.resolve();
  const waited = async <T,>(p: Promise<T>, bucket: 'readMs' | 'renderMs' | 'writeMs'): Promise<T> => {
    const t0 = performance.now();
    try { return await p; } finally { if (timing) timing[bucket] += performance.now() - t0; }
  };

  for (let g = 0; g < starts.length; g += group) {
    if (opts.signal?.aborted) throw new ChunkedCancelled();
    const inputs = await waited(nextInputs!, 'readMs');
    nextInputs = g + group < starts.length ? readGroup(g + group) : null;
    nextInputs?.catch(() => undefined);
    const outs = await waited(Promise.all(inputs.map((input) => opts.render(input))), 'renderMs');
    // Add each block's predecessor tail now (cheap, and it must happen in order), then queue the writes
    const batch = starts.slice(g, g + group);
    const ready: Float32Array[][] = [];
    for (let k = 0; k < batch.length; k++) {
      const out = outs[k];
      const frames = Math.min(blockFrames, opts.source.totalFrames - batch[k]);
      for (let c = 0; c < out.length; c++) {
        const tail = carry[c];
        if (!tail) continue;
        const n = Math.min(tail.length, out[c].length);
        for (let i = 0; i < n; i++) out[c][i] += tail[i];
      }
      ready.push(out.map((ch) => ch.subarray(0, frames)));
      carry = out.map((ch) => ch.slice(frames));
    }
    await waited(pendingWrite, 'writeMs');
    pendingWrite = (async () => {
      for (let k = 0; k < ready.length; k++) {
        if (opts.signal?.aborted) throw new ChunkedCancelled();
        await opts.write(ready[k]);
        written += ready[k][0].length;
        if (timing) timing.blocks++;
        opts.onProgress?.(Math.min(1, written / opts.source.totalFrames));
      }
    })();
    pendingWrite.catch(() => undefined);
  }
  await waited(pendingWrite, 'writeMs');
  if (opts.signal?.aborted) throw new ChunkedCancelled();
  if ((opts.keepTail ?? true) && carry.length > 0 && carry[0].length > 0) {
    await opts.write(carry);
    written += carry[0].length;
  }
  return written;
};

/** Apply one effect to a clip (or the pieces of an edited clip) and store the result as a new streamed asset. */
export const processEffectChunked = async (opts: {
  clips: Clip[];
  getAsset: (assetId: string) => Asset | undefined;
  effect: TrackEffect;
  storeId: string;
  onProgress?: (fraction: number) => void;
  signal?: { aborted: boolean };
  /** See overlapAddRender; false for a range piece that is followed by more of the same track */
  keepTail?: boolean;
}): Promise<ChunkedJobResult> => {
  // Several blocks at once, but leave a core for the page itself
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  let concurrency = Math.max(1, Math.min(4, cores - 1));
  const timing = { readMs: 0, renderMs: 0, writeMs: 0, blocks: 0 };
  const startedAt = performance.now();
  const assets = opts.clips.map((c) => opts.getAsset(c.assetId));
  if (assets.some((a) => !a)) throw new Error('Audio for this clip is not loaded.');
  const sampleRate = assets[0]!.sampleRate || 48000;
  const channels = Math.max(1, Math.min(2, Math.max(...assets.map((a) => a!.numberOfChannels || 1))));
  const pieces: PieceSource[] = opts.clips.map((c, i) => pieceFromClip(assets[i]!, c, true));
  const source = createVirtualSource(pieces, channels);
  // Reverb goes through fast convolution in background workers (several times faster than the browser's own
  // convolver when rendering a long clip). If workers cannot start, it falls back to the built-in path below.
  let pool: ReverbPool | null = null;
  let blockSeconds: number | undefined;
  if (opts.effect.type === 'reverb') {
    try {
      const kernel = await buildReverbKernel(sampleRate, opts.effect.params as ReverbParams);
      // Transform size: about eight times the response, so a short reverb is not charged for a long one's transform.
      // Between 2^19 and 2^21 frames: smaller wastes time on per-block overhead, larger on memory (about 65 MB per worker at 2^21).
      const n = Math.min(1 << 21, Math.max(1 << 19, nextPow2(kernel.length * 8)));
      pool = await ReverbPool.create(Math.max(1, Math.min(n >= 1 << 21 ? 4 : 6, cores - 1)), kernel, n);
      blockSeconds = (n - kernel.length + 1) / sampleRate;
      concurrency = pool.size;
    } catch (e) {
      console.warn('[effects] Fast reverb is unavailable, using the built-in reverb:', e);
      pool = null;
    }
  }
  const writer: StreamedWriter = await createStreamedWriter(opts.storeId, sampleRate, channels);
  try {
    await overlapAddRender({
      source,
      sampleRate,
      blockSeconds,
      write: writer.write,
      onProgress: opts.onProgress,
      signal: opts.signal,
      keepTail: opts.keepTail,
      concurrency,
      timing,
      render: async (block) => {
        if (pool) return pool.run(block);
        const length = Math.max(1, block[0].length);
        const buffer = new AudioBuffer({ length, numberOfChannels: channels, sampleRate });
        block.forEach((ch, c) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
        const rendered = await renderBufferWithEffect(buffer, opts.effect);
        return Array.from({ length: channels }, (_, c) => rendered.getChannelData(Math.min(c, rendered.numberOfChannels - 1)).slice());
      },
    });
    const meta = await writer.finish();
    const sec = (ms: number) => (ms / 1000).toFixed(1);
    console.info(`[effects] ${opts.effect.name} (${pool ? 'fast reverb' : 'built-in'}): ${timing.blocks} blocks, ${concurrency} at a time, ${sec(performance.now() - startedAt)} s total (read ${sec(timing.readMs)} s, render ${sec(timing.renderMs)} s, write ${sec(timing.writeMs)} s) for ${(meta.frames / sampleRate / 60).toFixed(1)} min of audio (${cores} logical cores)`);
    return { storeId: meta.storeId, frames: meta.frames, sampleRate, channels, durationSeconds: meta.frames / sampleRate };
  } catch (e) {
    await writer.abort();
    throw e;
  } finally {
    pool?.dispose();
  }
};
