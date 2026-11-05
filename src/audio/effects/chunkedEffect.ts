/**
 * Effects (delay, EQ, chorus, flanger, phaser, reverb) on audio of any length, block by block.
 *
 * Each block is rendered on its own, with the effect's decay tail added after it. The tail of one block is added on top of
 * the start of the next (overlap-add). For effects that are linear and fixed in time (delay, EQ, reverb) this gives the
 * same samples as rendering the whole clip at once. Chorus, flanger and phaser sweep with a slow oscillator that restarts
 * at the start of each block, so their sweep position jumps back at every block boundary.
 */
import type { Asset, Clip, TrackEffect } from '../../types';
import { createStreamedWriter, StreamedWriter } from '../../assets/streamedWriter';
import { ChunkedCancelled, createVirtualSource } from '../chunkedProcess';
import type { PieceSource } from '../chunkedProcess';
import { pieceFromClip } from '../chunkedJob';
import type { ChunkedJobResult } from '../chunkedJob';
import { renderBufferWithEffect } from './dspChain';

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
  for (let g = 0; g < starts.length; g += group) {
    if (opts.signal?.aborted) throw new ChunkedCancelled();
    const batch = starts.slice(g, g + group);
    const inputs: Float32Array[][] = [];
    let t0 = performance.now();
    for (const start of batch) {
      const frames = Math.min(blockFrames, opts.source.totalFrames - start);
      inputs.push(await opts.source.read(start, frames));
    }
    if (timing) { timing.readMs += performance.now() - t0; t0 = performance.now(); }
    const outs = await Promise.all(inputs.map((input) => opts.render(input)));
    if (timing) { timing.renderMs += performance.now() - t0; t0 = performance.now(); }
    for (let k = 0; k < batch.length; k++) {
      if (opts.signal?.aborted) throw new ChunkedCancelled();
      const out = outs[k];
      const frames = Math.min(blockFrames, opts.source.totalFrames - batch[k]);
      // Add the previous block's tail onto the start of this block's output
      for (let c = 0; c < out.length; c++) {
        const tail = carry[c];
        if (!tail) continue;
        const n = Math.min(tail.length, out[c].length);
        for (let i = 0; i < n; i++) out[c][i] += tail[i];
      }
      await opts.write(out.map((ch) => ch.subarray(0, frames)));
      written += frames;
      carry = out.map((ch) => ch.slice(frames));
      if (timing) timing.blocks++;
      opts.onProgress?.(Math.min(1, written / opts.source.totalFrames));
    }
    if (timing) timing.writeMs += performance.now() - t0;
  }
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
  const concurrency = Math.max(1, Math.min(4, cores - 1));
  const timing = { readMs: 0, renderMs: 0, writeMs: 0, blocks: 0 };
  const startedAt = performance.now();
  const assets = opts.clips.map((c) => opts.getAsset(c.assetId));
  if (assets.some((a) => !a)) throw new Error('Audio for this clip is not loaded.');
  const sampleRate = assets[0]!.sampleRate || 48000;
  const channels = Math.max(1, Math.min(2, Math.max(...assets.map((a) => a!.numberOfChannels || 1))));
  const pieces: PieceSource[] = opts.clips.map((c, i) => pieceFromClip(assets[i]!, c, true));
  const source = createVirtualSource(pieces, channels);
  const writer: StreamedWriter = await createStreamedWriter(opts.storeId, sampleRate, channels);
  try {
    await overlapAddRender({
      source,
      sampleRate,
      write: writer.write,
      onProgress: opts.onProgress,
      signal: opts.signal,
      keepTail: opts.keepTail,
      concurrency,
      timing,
      render: async (block) => {
        const length = Math.max(1, block[0].length);
        const buffer = new AudioBuffer({ length, numberOfChannels: channels, sampleRate });
        block.forEach((ch, c) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
        const rendered = await renderBufferWithEffect(buffer, opts.effect);
        return Array.from({ length: channels }, (_, c) => rendered.getChannelData(Math.min(c, rendered.numberOfChannels - 1)).slice());
      },
    });
    const meta = await writer.finish();
    const sec = (ms: number) => (ms / 1000).toFixed(1);
    console.info(`[effects] ${opts.effect.name}: ${timing.blocks} blocks, ${concurrency} at a time, ${sec(performance.now() - startedAt)} s total (read ${sec(timing.readMs)} s, render ${sec(timing.renderMs)} s, write ${sec(timing.writeMs)} s) for ${(meta.frames / sampleRate / 60).toFixed(1)} min of audio`);
    return { storeId: meta.storeId, frames: meta.frames, sampleRate, channels, durationSeconds: meta.frames / sampleRate };
  } catch (e) {
    await writer.abort();
    throw e;
  }
};
