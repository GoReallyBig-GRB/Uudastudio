/**
 * Export and mastering of a project of any length, block by block, in bounded memory.
 *
 * Analysis (`analyzeMastering`) renders the mix in blocks, runs it through the mastering chain without make-up gain and
 * measures it, which gives the gain that lands the result on the target loudness. Export (`runExport`) renders the mix
 * again, applies chain, gain and the look-ahead limiter, measures the result and writes it to the sink. If a current
 * analysis is supplied, export needs a single pass; otherwise it analyses first.
 */
import type { Project } from '../types';
import { LoudnessMeter, type MeterStats } from './loudnessMeter';
import { LookaheadLimiter } from './streamingLimiter';
import { mixdownInBlocks, planMixdown, type MixdownDeps, type MixdownPlan, type SkippedPluginInfo } from './blockMixdown';
import type { AudioSink } from './exportSinks';
import {
  CHAIN_COMPRESSOR_KNEE_DB, CHAIN_COMPRESSOR_THRESHOLD_DB, CHAIN_LIMITER_LOOKAHEAD_SECONDS, CHAIN_LIMITER_RELEASE_SECONDS, CHAIN_PRESENCE_Q,
  type ChainSettings,
} from './masteringSettings';

export type { ChainSettings };

export interface PipelineProgress {
  stage: 'rendering' | 'mastering' | 'encoding';
  percent: number;
  message: string;
}

export interface ExportRunOptions {
  sampleRate: number;
  range?: { startSeconds: number; endSeconds: number };
  /**
   * null = export the mix as it is. With `gainDb` (from a current analysis) export is a single pass; without it the
   * mix is analysed first.
   */
  mastering: { settings: ChainSettings; gainDb?: number } | null;
  blockSeconds?: number;
  onProgress?: (p: PipelineProgress) => void;
  isCancelled?: () => boolean;
}

export interface ExportRunResult {
  /** Loudness of the raw mix; null unless an analysis ran as part of this export */
  preStats: MeterStats | null;
  postStats: MeterStats;
  gainAdjustmentDb: number;
  plan: MixdownPlan;
  skippedPlugins: SkippedPluginInfo[];
}

export interface AnalysisResult {
  /** Gain (dB) that brings the processed mix to the target loudness */
  gainDb: number;
  /** Raw mix, before mastering */
  mixStats: MeterStats;
  /** After presence EQ and compression, before the gain */
  processedStats: MeterStats;
  plan: MixdownPlan;
  skippedPlugins: SkippedPluginInfo[];
}

/** Seconds of the previous mix fed in before each block so the compressor's state has settled. */
const CHAIN_LEAD_IN_SECONDS = 3;

/** presence EQ -> compressor -> make-up gain, on one block */
export function buildMasteringChain(ctx: OfflineAudioContext, source: AudioNode, s: ChainSettings, gainDb: number): AudioNode {
  let last: AudioNode = source;
  if (s.midPresenceGainDb !== 0) {
    const eq = ctx.createBiquadFilter();
    eq.type = 'peaking';
    eq.frequency.setValueAtTime(s.midPresenceFreqHz, 0);
    eq.Q.setValueAtTime(CHAIN_PRESENCE_Q, 0);
    eq.gain.setValueAtTime(s.midPresenceGainDb, 0);
    last.connect(eq);
    last = eq;
  }
  if (s.compressionRatio > 1.0) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.setValueAtTime(CHAIN_COMPRESSOR_THRESHOLD_DB, 0);
    comp.knee.setValueAtTime(CHAIN_COMPRESSOR_KNEE_DB, 0);
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

/**
 * Runs successive blocks of a mix through the chain. Each block is preceded by the end of the previous raw mix so the
 * compressor and filters have settled before the block begins; that lead-in is discarded from the output.
 */
class ChainRunner {
  private tail: Float32Array[] = [new Float32Array(0), new Float32Array(0)];
  private readonly leadFrames: number;
  constructor(private readonly sampleRate: number, private readonly settings: ChainSettings, private readonly gainDb: number) {
    this.leadFrames = Math.round(CHAIN_LEAD_IN_SECONDS * sampleRate);
  }

  async process(block: Float32Array[], frames: number): Promise<Float32Array[]> {
    const lead = this.tail[0].length;
    const joined = [0, 1].map((c) => {
      const j = new Float32Array(lead + frames);
      j.set(this.tail[c], 0);
      j.set(block[c].subarray(0, frames), lead);
      return j;
    });
    const ctx = new OfflineAudioContext(2, lead + frames, this.sampleRate);
    const buf = ctx.createBuffer(2, lead + frames, this.sampleRate);
    for (let c = 0; c < 2; c++) buf.copyToChannel(joined[c] as Float32Array<ArrayBuffer>, c);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    buildMasteringChain(ctx, src, this.settings, this.gainDb).connect(ctx.destination);
    src.start(0);
    const out = await ctx.startRendering();
    this.tail = joined.map((j) => j.slice(Math.max(0, j.length - this.leadFrames)));
    return [out.getChannelData(0).slice(lead, lead + frames), out.getChannelData(1).slice(lead, lead + frames)];
  }
}

function makeLimiters(sr: number, ceilingDbTP: number): LookaheadLimiter[] {
  return [0, 1].map(() => new LookaheadLimiter(
    Math.pow(10, ceilingDbTP / 20),
    Math.max(1, Math.floor(CHAIN_LIMITER_LOOKAHEAD_SECONDS * sr)),
    Math.exp(-1 / (CHAIN_LIMITER_RELEASE_SECONDS * sr)),
  ));
}

const reporter = (onProgress: ExportRunOptions['onProgress'], stage: PipelineProgress['stage']) =>
  (fraction: number, from: number, to: number, message: string) =>
    onProgress?.({ stage, percent: Math.round(from + fraction * (to - from)), message });

/**
 * Measures the mix and the mix after the chain (without gain) and returns the gain that reaches the target loudness.
 * The gain is linear and follows the compressor, so it holds exactly for what export produces (apart from the limiter,
 * which only touches peaks above the ceiling).
 */
export async function analyzeMastering(
  project: Project,
  deps: MixdownDeps,
  options: { sampleRate: number; settings: ChainSettings; range?: ExportRunOptions['range']; blockSeconds?: number; onProgress?: ExportRunOptions['onProgress']; isCancelled?: () => boolean },
): Promise<AnalysisResult> {
  const sr = options.sampleRate;
  const plan = planMixdown(project, sr, options.range);
  const mixMeter = new LoudnessMeter(2, sr, plan.totalFrames);
  const procMeter = new LoudnessMeter(2, sr, plan.totalFrames);
  const runner = new ChainRunner(sr, options.settings, 0);
  const report = reporter(options.onProgress, 'mastering');
  const run = await mixdownInBlocks(project, deps, sr, {
    range: options.range,
    blockSeconds: options.blockSeconds,
    isCancelled: options.isCancelled,
    onProgress: (f) => report(f, 0, 99, 'Measuring loudness...'),
  }, async (ch, _start, frames) => {
    mixMeter.push(ch, frames);
    procMeter.push(await runner.process(ch, frames), frames);
  });
  const mixStats = mixMeter.finish();
  const processedStats = procMeter.finish();
  const gainDb = processedStats.integratedLUFS > -60 ? options.settings.targetLufs - processedStats.integratedLUFS : 0;
  return { gainDb, mixStats, processedStats, plan, skippedPlugins: run.skippedPlugins };
}

export async function runExport(
  project: Project,
  deps: MixdownDeps,
  options: ExportRunOptions,
  sink: AudioSink,
): Promise<ExportRunResult> {
  const sr = options.sampleRate;
  const plan = planMixdown(project, sr, options.range);
  const chain = options.mastering && options.mastering.settings.type !== 'bypass' ? options.mastering : null;

  let preStats: MeterStats | null = null;
  let gainDb = chain?.gainDb ?? 0;
  let skipped: SkippedPluginInfo[] = [];
  let writeFrom = 0;

  if (chain && chain.gainDb === undefined) {
    const analysis = await analyzeMastering(project, deps, {
      sampleRate: sr, settings: chain.settings, range: options.range, blockSeconds: options.blockSeconds,
      onProgress: (p) => options.onProgress?.({ stage: 'mastering', percent: Math.round(p.percent * 0.45), message: 'Pass 1 of 2: measuring loudness...' }),
      isCancelled: options.isCancelled,
    });
    preStats = analysis.mixStats;
    gainDb = analysis.gainDb;
    skipped = analysis.skippedPlugins;
    writeFrom = 45;
  }

  const post = new LoudnessMeter(2, sr, plan.totalFrames);
  const runner = chain ? new ChainRunner(sr, chain.settings, gainDb) : null;
  const limiters = chain ? makeLimiters(sr, chain.settings.ceilingDbTP) : null;
  let written = 0;
  const emit = async (data: Float32Array[]) => {
    const frames = data[0].length;
    if (frames === 0) return;
    post.push(data, frames);
    await sink.write(data, frames);
    written += frames;
  };

  const report = reporter(options.onProgress, 'rendering');
  const label = chain
    ? (chain.gainDb === undefined ? 'Pass 2 of 2: mastering and writing...' : 'Mastering and writing...')
    : 'Rendering and writing...';
  const second = await mixdownInBlocks(project, deps, sr, {
    range: options.range,
    blockSeconds: options.blockSeconds,
    isCancelled: options.isCancelled,
    onProgress: (f) => report(f, writeFrom, 97, label),
  }, async (ch, _start, frames) => {
    if (!runner || !limiters) {
      await emit([ch[0].slice(0, frames), ch[1].slice(0, frames)]);
      return;
    }
    const mastered = await runner.process(ch, frames);
    await emit(mastered.map((m, c) => limiters[c].process(m)));
  });
  if (skipped.length === 0) skipped = second.skippedPlugins;

  if (limiters) await emit(limiters.map((l) => l.finish()));
  if (written !== plan.totalFrames) throw new Error(`Export produced ${written} frames but expected ${plan.totalFrames}.`);

  return { preStats, postStats: post.finish(), gainAdjustmentDb: Math.round(gainDb * 10) / 10, plan, skippedPlugins: skipped };
}
