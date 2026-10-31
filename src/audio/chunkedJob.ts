/**
 * Process clips of any length: read the clip (or the pieces of an edited clip) as one stretch of audio, run a tool over it
 * block by block, and write a new stored asset. Memory stays flat. See `chunkedProcess.ts` for the block machinery.
 *
 * Tools that keep the length (Amplify, Compress, Denoise) are here. Pitch and Speed change timing at block joins and
 * are added separately.
 */
import type { Asset, Clip, CompressorParams, DenoiseParams } from '../types';
import { readStreamedFrames } from '../assets/streamedStore';
import { createStreamedWriter, StreamedWriter } from '../assets/streamedWriter';
import { processCompression } from './dsp/compressor';
import { processBasicDenoise } from './dsp/denoiser';
import { ChunkedOptions, PieceSource, createVirtualSource, runChunked } from './chunkedProcess';

export type ChunkTool =
  | { kind: 'amplify'; gainDb: number }
  | { kind: 'compress'; params: CompressorParams }
  | { kind: 'denoise'; params: DenoiseParams };

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

const toBuffer = (channels: Float32Array[], sampleRate: number): AudioBuffer => {
  const buf = new AudioBuffer({ length: Math.max(1, channels[0].length), numberOfChannels: channels.length, sampleRate });
  channels.forEach((ch, c) => buf.copyToChannel(ch as never, c));
  return buf;
};

const fromBuffer = (buf: AudioBuffer): Float32Array[] =>
  Array.from({ length: buf.numberOfChannels }, (_, c) => new Float32Array(buf.getChannelData(c)));

/** How a tool processes one block, and how much earlier audio it needs to warm up. */
export const toolProcessor = (tool: ChunkTool): { leadInSeconds: number; process: ChunkedOptions['process'] } => {
  if (tool.kind === 'amplify') {
    const g = Math.pow(10, tool.gainDb / 20);
    return { leadInSeconds: 0, process: (block) => block.map((ch) => ch.map((v) => v * g)) };
  }
  if (tool.kind === 'compress') {
    return {
      leadInSeconds: 4,
      process: async (block, info) => fromBuffer(await processCompression(toBuffer(block, info.sampleRate), tool.params)),
    };
  }
  return {
    leadInSeconds: 4,
    process: async (block, info) => fromBuffer(await processBasicDenoise(toBuffer(block, info.sampleRate), tool.params)),
  };
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
  const { leadInSeconds, process } = toolProcessor(opts.tool);
  try {
    const frames = await runChunked({ source, sampleRate, leadInSeconds, process, write: writer.write, onProgress: opts.onProgress, signal: opts.signal });
    const meta = await writer.finish();
    return { storeId: meta.storeId, frames, sampleRate, channels, durationSeconds: frames / sampleRate };
  } catch (e) {
    await writer.abort();
    throw e;
  }
};
