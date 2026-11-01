/**
 * Process clips of any length: read the clip (or the pieces of an edited clip) as one stretch of audio, run a tool over it
 * block by block, and write a new stored asset. Memory stays flat. See `chunkedProcess.ts` for the block machinery.
 *
 * Every tool is seamless: Amplify has no memory, and Compress, Denoise, Pitch and Speed are streaming stages that carry
 * their state across blocks and give the same samples as processing the whole clip at once.
 */
import type { Asset, Clip, CompressorParams, DenoiseParams } from '../types';
import { readStreamedFrames } from '../assets/streamedStore';
import { createStreamedWriter, StreamedWriter } from '../assets/streamedWriter';
import { WORKER_BLOCK_SECONDS, openStage } from './dsp/dspWorkerClient';
import { ChunkedOptions, PieceSource, createVirtualSource, runChunked, runStreamed } from './chunkedProcess';

export type ChunkTool =
  | { kind: 'amplify'; gainDb: number }
  | { kind: 'compress'; params: CompressorParams }
  | { kind: 'denoise'; params: DenoiseParams }
  /** Keeps the length */
  | { kind: 'pitch'; semitones: number }
  /** ratio 2 = twice as fast, half as long; changes the length */
  | { kind: 'speed'; ratio: number };

/** One clip as a source piece: its stretch of the stored audio, with the clip's gain and mute. Works for memory and disk audio. */
export const pieceFromClip = (asset: Asset, clip: Clip, bakeGain = true): PieceSource => {
  const sr = asset.sampleRate;
  const offsetFrames = Math.max(0, Math.round((clip.offsetSeconds || 0) * sr));
  const frames = Math.max(0, Math.round(clip.durationSeconds * sr));
  const channels = Math.max(1, asset.numberOfChannels);
  return {
    frames,
    gain: bakeGain ? clip.gain : 1,
    muted: !!clip.muted,
    read: async (start, count) => {
      if (asset.buffer) {
        const out: Float32Array[] = [];
        for (let c = 0; c < Math.min(channels, asset.buffer.numberOfChannels); c++) {
          out.push(asset.buffer.getChannelData(c).subarray(offsetFrames + start, offsetFrames + start + count));
        }
        return out;
      }
      if (asset.source) return readStreamedFrames(asset.source.storeId, channels, offsetFrames + start, count);
      return [new Float32Array(0)];
    },
  };
};

/** How the length-keeping, memoryless Amplify processes one block. */
export const amplifyProcessor = (gainDb: number): ChunkedOptions['process'] => {
  const g = Math.pow(10, gainDb / 20);
  return (block) => block.map((ch) => ch.map((v) => v * g));
};

export interface ChunkedJobResult {
  storeId: string;
  frames: number;
  sampleRate: number;
  channels: number;
  durationSeconds: number;
}

/**
 * Run `tool` over `clips` (in time order, touching end to end) and write the result as a new stored asset.
 * Throws ChunkedCancelled if `signal.aborted` is set; the partial output is removed either way on failure.
 */
export const processClipsChunked = async (opts: {
  clips: Clip[];
  getAsset: (assetId: string) => Asset | undefined;
  tool: ChunkTool;
  storeId: string;
  onProgress?: (fraction: number) => void;
  signal?: { aborted: boolean };
}): Promise<ChunkedJobResult> => {
  const assets = opts.clips.map((c) => opts.getAsset(c.assetId));
  if (assets.some((a) => !a)) throw new Error('Audio for this clip is not loaded.');
  const first = assets[0]!;
  const sampleRate = first.sampleRate || 48000;
  const channels = Math.max(1, Math.min(2, Math.max(...assets.map((a) => a!.numberOfChannels || 1))));
  const bakeGain = true; // the clip's gain is baked in when its pieces become one asset
  const source = createVirtualSource(opts.clips.map((c, i) => pieceFromClip(assets[i]!, c, bakeGain)), channels);
  const writer: StreamedWriter = await createStreamedWriter(opts.storeId, sampleRate, channels);
  try {
    const tool = opts.tool;
    let frames: number;
    if (tool.kind === 'amplify') {
      frames = await runChunked({ source, sampleRate, leadInSeconds: 0, process: amplifyProcessor(tool.gainDb), write: writer.write, onProgress: opts.onProgress, signal: opts.signal });
    } else {
      // The heavy work runs in a Web Worker (or here, if one cannot start), so the interface stays smooth
      const stage = await openStage({ tool, channels, totalFrames: source.totalFrames, sampleRate });
      try {
        frames = await runStreamed({
          source,
          sampleRate,
          blockSeconds: WORKER_BLOCK_SECONDS,
          makeStage: () => stage,
          write: writer.write,
          onProgress: opts.onProgress,
          signal: opts.signal,
        });
      } catch (e) {
        stage.close();
        throw e;
      }
    }
    const meta = await writer.finish();
    frames = meta.frames;
    return { storeId: meta.storeId, frames, sampleRate, channels, durationSeconds: frames / sampleRate };
  } catch (e) {
    await writer.abort();
    throw e;
  }
};
