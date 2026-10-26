/**
 * Export and mastering of a project of any length, block by block, in bounded memory.
 *
 * With mastering: pass 1 renders the mix in blocks and only measures it (integrated loudness, true peak). Pass 2 renders
 * it again, runs each block through the mastering chain (presence EQ, compressor, make-up gain), then the look-ahead
 * limiter, measures the result, and writes it to the sink. Rendering twice costs time but needs no multi-gigabyte
 * temporary file. Without mastering it is a single pass.
 */
import type { Project } from '../types';
import { LoudnessMeter, type MeterStats } from './loudnessMeter';
import { LookaheadLimiter } from './streamingLimiter';
import { mixdownInBlocks, planMixdown, type MixdownDeps, type MixdownPlan, type SkippedPluginInfo } from './blockMixdown';
import type { AudioSink } from './exportSinks';

/** The parts of a mastering profile the chain needs. */
export interface ChainSettings {
  type: string;
  targetLufs: number;
  ceilingDbTP: number;
  midPresenceGainDb: number;
  midPresenceFreqHz: number;
  compressionRatio: number;
  attackMs: number;
  releaseMs: number;
}

export interface PipelineProgress {
  stage: 'rendering' | 'mastering' | 'encoding';
  percent: number;
  message: string;
}

export interface ExportRunOptions {
  sampleRate: number;
  range?: { startSeconds: number; endSeconds: number };
  /** null = export the mix as it is */
  mastering: ChainSettings | null;
  blockSeconds?: number;
  onProgress?: (p: PipelineProgress) => void;
  isCancelled?: () => boolean;
}

export interface ExportRunResult {
  /** Loudness of the raw mix; null when not mastering */
  preStats: MeterStats | null;
  postStats: MeterStats;
  gainAdjustmentDb: number;
  plan: MixdownPlan;
  skippedPlugins: SkippedPluginInfo[];
}

/** Seconds of the previous mix fed in before each block so the compressor's state has settled. */
const CHAIN_LEAD_IN_SECONDS = 3;

/** presence EQ -> compressor -> make-up gain, the same chain as before, on one block */
export function buildMasteringChain(ctx: OfflineAudioContext, source: AudioNode, s: ChainSettings, gainDb: number): AudioNode {
  let last: AudioNode = source;
  if (s.midPresenceGainDb !== 0) {
    const eq = ctx.createBiquadFilter();
    eq.type = 'peaking';
    eq.frequency.setValueAtTime(s.midPresenceFreqHz, 0);
    eq.Q.setValueAtTime(1.5, 0);
    eq.gain.setValueAtTime(s.midPresenceGainDb, 0);
    last.connect(eq);
    last = eq;
  }
  if (s.compressionRatio > 1.0) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.setValueAtTime(-22, 0);
    comp.knee.setValueAtTime(8, 0);
    comp.ratio.setValueAtTime(s.compressionRatio, 0);
    comp.attack.setValueAtTime(s.attackMs / 1000, 0);
    comp.release.setValueAtTime(s.releaseMs / 1000, 0);
    last.connect(comp);
    last = comp;
  }
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(Math.pow(10, gainDb / 20), 0);
  last.connect(gain);
  return gain;
}

async function renderChain(input: Float32Array[], frames: number, sampleRate: number, s: ChainSettings, gainDb: number): Promise<Float32Array[]> {
  const ctx = new OfflineAudioContext(2, frames, sampleRate);
  const buf = ctx.createBuffer(2, frames, sampleRate);
  for (let c = 0; c < 2; c++) buf.copyToChannel(input[c].subarray(0, frames) as Float32Array<ArrayBuffer>, c);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  buildMasteringChain(ctx, src, s, gainDb).connect(ctx.destination);
  src.start(0);
  const out = await ctx.startRendering();
  return [out.getChannelData(0), out.getChannelData(1)];
}

export async function runExport(
  project: Project,
  deps: MixdownDeps,
  options: ExportRunOptions,
  sink: AudioSink,
): Promise<ExportRunResult> {
  const sr = options.sampleRate;
  const plan = planMixdown(project, sr, options.range);
  const chain = options.mastering && options.mastering.type !== 'bypass' ? options.mastering : null;
  const report = (stage: PipelineProgress['stage'], fraction: number, from: number, to: number, message: string) =>
    options.onProgress?.({ stage, percent: Math.round(from + fraction * (to - from)), message });
  const mix = (onBlock: Parameters<typeof mixdownInBlocks>[4], from: number, to: number, label: string) =>
    mixdownInBlocks(project, deps, sr, {
      range: options.range,
      blockSeconds: options.blockSeconds,
      isCancelled: options.isCancelled,
      onProgress: (f) => report('rendering', f, from, to, label),
    }, onBlock);

  let preStats: MeterStats | null = null;
  let gainDb = 0;
  let skipped: SkippedPluginInfo[] = [];

  if (chain) {
    // Pass 1: measure the raw mix
    const meter = new LoudnessMeter(2, sr, plan.totalFrames);
    const first = await mix((ch, _start, frames) => { meter.push(ch, frames); }, 0, 45, 'Pass 1 of 2: measuring the mix...');
    skipped = first.skippedPlugins;
    preStats = meter.finish();
    if (preStats.integratedLUFS > -60) gainDb = chain.targetLufs - preStats.integratedLUFS;
  }

  // Pass 2 (or the only pass): render, master, limit, measure, write
  const post = new LoudnessMeter(2, sr, plan.totalFrames);
  const leadFrames = chain ? Math.round(CHAIN_LEAD_IN_SECONDS * sr) : 0;
  const limiters = chain
    ? [0, 1].map(() => new LookaheadLimiter(
        Math.pow(10, chain.ceilingDbTP / 20),
        Math.max(1, Math.floor(0.002 * sr)),
        Math.exp(-1 / (0.05 * sr)),
      ))
    : null;
  let tail: Float32Array[] = [new Float32Array(0), new Float32Array(0)];
  let written = 0;

  const emit = async (data: Float32Array[]) => {
    const frames = data[0].length;
    if (frames === 0) return;
    post.push(data, frames);
    await sink.write(data, frames);
    written += frames;
  };

  const from2 = chain ? 45 : 0;
  const second = await mix(async (ch, _start, frames) => {
    if (!chain || !limiters) {
      await emit([ch[0].slice(0, frames), ch[1].slice(0, frames)]);
      return;
    }
    const lead = tail[0].length;
    const joined = [0, 1].map((c) => {
      const j = new Float32Array(lead + frames);
      j.set(tail[c], 0);
      j.set(ch[c].subarray(0, frames), lead);
      return j;
    });
    const rendered = await renderChain(joined, lead + frames, sr, chain, gainDb);
    const mastered = [0, 1].map((c) => rendered[c].subarray(lead, lead + frames));
    await emit(mastered.map((m, c) => limiters[c].process(m)));
    // keep the end of the raw mix as the next block's lead-in
    tail = joined.map((j) => j.slice(Math.max(0, j.length - leadFrames)));
  }, from2, chain ? 95 : 95, chain ? 'Pass 2 of 2: mastering and writing...' : 'Rendering the mix...');
  if (!chain) skipped = second.skippedPlugins;

  if (limiters) await emit(limiters.map((l) => l.finish()));
  if (written !== plan.totalFrames) throw new Error(`Export produced ${written} frames but expected ${plan.totalFrames}.`);

  const postStats = post.finish();
  return { preStats, postStats, gainAdjustmentDb: Math.round(gainDb * 10) / 10, plan, skippedPlugins: skipped };
}
