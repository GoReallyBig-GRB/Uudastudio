/**
 * Chunked processing for long audio.
 *
 * A clip (one piece, or several pieces of an edited clip joined end to end) is read as ONE virtual stretch of audio,
 * processed block by block, and written out block by block. Memory stays at about three blocks whatever the length, and the
 * same path serves short and long audio. A lead-in (audio read before each block, processed and thrown away) warms up
 * tools with a memory, such as a compressor's level detector, so blocks join without a step.
 *
 * Everything here takes its input and output as functions, so it is unit-tested without a browser or file storage.
 */

/** One stretch of source audio that is part of the clip. */
export interface PieceSource {
  /** Length of this piece in frames */
  frames: number;
  /** Linear gain baked into the output (the clip's gain) */
  gain: number;
  /** A muted piece reads as silence */
  muted: boolean;
  /** Reads `count` frames starting `startFrame` frames into this piece (already offset into the stored audio). May return fewer at the end. */
  read: (startFrame: number, count: number) => Promise<Float32Array[]>;
}

export interface VirtualSource {
  totalFrames: number;
  channels: number;
  read: (startFrame: number, count: number) => Promise<Float32Array[]>;
}

/** The pieces, in time order, as one source with `channels` output channels (a mono piece fills every channel). */
export const createVirtualSource = (pieces: readonly PieceSource[], channels: number): VirtualSource => {
  const totalFrames = pieces.reduce((n, p) => n + Math.max(0, p.frames), 0);
  const read = async (startFrame: number, count: number): Promise<Float32Array[]> => {
    const start = Math.max(0, startFrame);
    const end = Math.min(totalFrames, start + Math.max(0, count));
    const length = Math.max(0, end - start);
    const out = Array.from({ length: channels }, () => new Float32Array(length));
    let pieceStart = 0;
    for (const piece of pieces) {
      const pieceEnd = pieceStart + piece.frames;
      const from = Math.max(start, pieceStart);
      const to = Math.min(end, pieceEnd);
      if (to > from && !piece.muted && piece.gain !== 0) {
        const got = await piece.read(from - pieceStart, to - from);
        for (let c = 0; c < channels; c++) {
          const src = got[Math.min(c, got.length - 1)];
          if (!src) continue;
          const dst = out[c];
          const base = from - start;
          const n = Math.min(src.length, to - from);
          if (piece.gain === 1) dst.set(n === src.length ? src : src.subarray(0, n), base);
          else for (let i = 0; i < n; i++) dst[base + i] = src[i] * piece.gain;
        }
      }
      pieceStart = pieceEnd;
      if (pieceStart >= end) break;
    }
    return out;
  };
  return { totalFrames, channels, read };
};

export interface Block {
  index: number;
  /** First frame of the block in the source (and in the output, for tools that keep the length) */
  start: number;
  frames: number;
  /** Frames of lead-in actually available before `start` (less than asked for at the very beginning) */
  leadIn: number;
}

/** Cut `totalFrames` into blocks of `blockFrames`, each with up to `leadInFrames` of earlier audio to warm up on. */
export const planBlocks = (totalFrames: number, blockFrames: number, leadInFrames: number): Block[] => {
  if (!(totalFrames > 0) || !(blockFrames > 0)) return [];
  const blocks: Block[] = [];
  for (let start = 0, i = 0; start < totalFrames; start += blockFrames, i++) {
    blocks.push({ index: i, start, frames: Math.min(blockFrames, totalFrames - start), leadIn: Math.min(Math.max(0, leadInFrames), start) });
  }
  return blocks;
};

export interface ChunkedOptions {
  source: VirtualSource;
  sampleRate: number;
  blockSeconds?: number;
  leadInSeconds?: number;
  /** Processes one block (lead-in first). Must return the same number of frames it was given, per channel. */
  process: (block: Float32Array[], info: { leadIn: number; sampleRate: number; index: number }) => Promise<Float32Array[]> | Float32Array[];
  /** Receives the processed audio of each block, in order, lead-in already removed. */
  write: (chunk: Float32Array[]) => Promise<void>;
  /** 0..1 */
  onProgress?: (fraction: number) => void;
  /** Set `aborted` to true to stop between blocks */
  signal?: { aborted: boolean };
}

export class ChunkedCancelled extends Error {
  constructor() {
    super('Processing cancelled');
    this.name = 'ChunkedCancelled';
  }
}

export const DEFAULT_BLOCK_SECONDS = 30;

/** Run the whole clip through `process`, block by block. Returns the number of frames written. */
export const runChunked = async (opts: ChunkedOptions): Promise<number> => {
  const { source, sampleRate } = opts;
  const blockFrames = Math.max(1, Math.round((opts.blockSeconds ?? DEFAULT_BLOCK_SECONDS) * sampleRate));
  const leadInFrames = Math.max(0, Math.round((opts.leadInSeconds ?? 0) * sampleRate));
  const blocks = planBlocks(source.totalFrames, blockFrames, leadInFrames);
  let written = 0;
  for (const block of blocks) {
    if (opts.signal?.aborted) throw new ChunkedCancelled();
    const input = await source.read(block.start - block.leadIn, block.leadIn + block.frames);
    const processed = await opts.process(input, { leadIn: block.leadIn, sampleRate, index: block.index });
    const trimmed = processed.map((ch) => ch.subarray(block.leadIn, block.leadIn + block.frames));
    await opts.write(trimmed);
    written += block.frames;
    opts.onProgress?.(Math.min(1, written / source.totalFrames));
  }
  if (opts.signal?.aborted) throw new ChunkedCancelled();
  return written;
};

/**
 * How many processed copies of a long clip the undo history may keep alive (each holds a full-length copy on disk).
 * Cuts, deletes, silence and level changes cost nothing and are not limited. `null` means no limit.
 * Stereo 44.1 kHz float32 is about 21 MB per minute.
 */
export const processedUndoLimit = (clipMinutes: number): number | null => {
  if (!Number.isFinite(clipMinutes) || clipMinutes < 20) return null;
  if (clipMinutes < 60) return 3;
  if (clipMinutes < 120) return 2;
  return 1;
};

/** Output length of a time-stretch: the input length divided by the speed ratio (2 = twice as fast = half as long). */
export const stretchedFrames = (inputFrames: number, ratio: number): number =>
  !(ratio > 0) || !Number.isFinite(ratio) ? inputFrames : Math.max(1, Math.round(inputFrames / ratio));

/**

 * Join the head of the next block onto the tail of the previous one with a smooth cross-fade whose weights add to 1
 * (the overlap holds the same audio twice, so the level stays put), in place on `prevTail` (returns it). Both arrays must hold the same overlapping stretch of audio.
 */
export const crossfadeInto = (prevTail: Float32Array, nextHead: Float32Array): Float32Array => {
  const n = Math.min(prevTail.length, nextHead.length);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 1 : i / (n - 1);
    // The two blocks hold the SAME audio in the overlap, so the weights must add to 1 (cos² + sin²), not to equal power
    const a = Math.cos(t * Math.PI / 2) ** 2;
    const b = Math.sin(t * Math.PI / 2) ** 2;
    prevTail[i] = prevTail[i] * a + nextHead[i] * b;
  }
  return prevTail;
};

/**
 * Run the clip through streaming stages (one per channel) that may change the length, such as Speed or Pitch. The stages hold
 * their own state, so there are no seams between blocks. Returns the number of frames written.
 */
export const runStreamed = async (opts: {
  source: VirtualSource;
  sampleRate: number;
  makeStage: (channelIndex: number, totalFrames: number) => { push(c: Float32Array): Float32Array; finish(): Float32Array };
  write: (chunk: Float32Array[]) => Promise<void>;
  blockSeconds?: number;
  onProgress?: (fraction: number) => void;
  signal?: { aborted: boolean };
}): Promise<number> => {
  const { source } = opts;
  const stages = Array.from({ length: source.channels }, (_, c) => opts.makeStage(c, source.totalFrames));
  const blockFrames = Math.max(1, Math.round((opts.blockSeconds ?? DEFAULT_BLOCK_SECONDS) * opts.sampleRate));
  let written = 0;
  const emit = async (outs: Float32Array[]) => {
    const n = Math.min(...outs.map((o) => o.length));
    if (n > 0) {
      await opts.write(outs.map((o) => o.subarray(0, n)));
      written += n;
    }
  };
  for (let start = 0; start < source.totalFrames; start += blockFrames) {
    if (opts.signal?.aborted) throw new ChunkedCancelled();
    const count = Math.min(blockFrames, source.totalFrames - start);
    const input = await source.read(start, count);
    await emit(stages.map((st, c) => st.push(input[Math.min(c, input.length - 1)])));
    opts.onProgress?.(Math.min(1, (start + count) / source.totalFrames));
  }
  if (opts.signal?.aborted) throw new ChunkedCancelled();
  await emit(stages.map((st) => st.finish()));
  return written;
};
