/**
 * Project-level mastering analysis and export: wires the real engine, effect plugins and file storage into the block
 * pipeline (exportPipeline.ts) and hands back finished files.
 */
import type { Project } from '../types';
import { audioEngine } from './engine';
import { pluginManager, MASTER_TRACK_ID } from '../plugins/pluginManager';
import { readStreamedFrames } from '../assets/streamedStore';
import { planMixdown, type MixdownDeps } from './blockMixdown';
import { analyzeMastering, runExport, type ExportRunResult } from './exportPipeline';
import { createByteTarget, createMp3Sink, createWavSink } from './exportSinks';
import { LoudnessMeter, type MeterStats } from './loudnessMeter';
import { mixFingerprint, masteringKey, type ChainSettings, type MasteringAnalysis } from './masteringSettings';

export type LoudnessStats = MeterStats;

export interface ExportProgress {
  stage: 'rendering' | 'mastering' | 'encoding' | 'verifying' | 'complete';
  percent: number;
  message: string;
}

/** A plugin the export had to pass through unchanged */
export interface SkippedPlugin {
  chainId: string;
  name: string;
  reason: 'missing' | 'failed';
}

/**
 * Builds the active (non-bypassed) plugins of one chain inside an offline context and wires them in series after
 * `source`. Returns the last node. A plugin that fails to load is skipped, so one bad module never blocks an export.
 * chainId is a track id or MASTER_TRACK_ID.
 */
export async function appendOfflinePlugins(
  offlineCtx: OfflineAudioContext,
  chainId: string,
  source: AudioNode,
  skipped?: SkippedPlugin[]
): Promise<AudioNode> {
  let output: AudioNode = source;
  for (const plugin of pluginManager.getPluginsForTrack(chainId)) {
    if (plugin.isBypassed) continue;
    if (plugin.missing) {
      skipped?.push({ chainId, name: plugin.descriptor.name, reason: 'missing' });
      continue;
    }
    try {
      const offlineInst = await pluginManager.instantiatePlugin(
        offlineCtx,
        chainId,
        plugin.descriptor,
        await plugin.getState()
      );
      offlineInst.dryWet = plugin.dryWet;
      output.connect(offlineInst.inputNode);
      output = offlineInst.outputNode;
    } catch (err) {
      console.warn(`Plugin ${plugin.descriptor.name} fallback to pass-through in offline export:`, err);
      skipped?.push({ chainId, name: plugin.descriptor.name, reason: 'failed' });
    }
  }
  return output;
}

/** The real engine, plugins and storage behind the block mixdown. Tests can override parts. */
export function makeMixdownDeps(overrides?: Partial<MixdownDeps>): MixdownDeps {
  return {
    getAsset: (id) => audioEngine.getAsset(id),
    masterFaderGain: audioEngine.getMasterMute() ? 0 : audioEngine.getMasterVolume(),
    appendPlugins: (ctx, chainId, source, skipped) => appendOfflinePlugins(ctx, chainId, source, skipped),
    chainHasPlugins: (chainId) => pluginManager.getPluginsForTrack(chainId).some((p) => !p.isBypassed),
    masterChainId: MASTER_TRACK_ID,
    readFrames: (asset, start, frames) => readStreamedFrames(asset.source!.storeId, Math.max(1, asset.numberOfChannels), start, frames),
    ...overrides,
  };
}

function reportSkipped(skipped: SkippedPlugin[]): void {
  if (skipped.length > 0 && typeof window !== 'undefined') {
    // The export carries on with those plugins passed through; the app tells the user which ones
    window.dispatchEvent(new CustomEvent('uuda:export-skipped-plugins', { detail: { plugins: skipped } }));
  }
}

/** Fingerprint of the project's mix as it sounds right now, including the master fader. */
export function currentMixKey(project: Project): string {
  return mixFingerprint(project, audioEngine.getMasterVolume(), audioEngine.getMasterMute());
}

/**
 * Measures the project through the mastering chain (any length, flat memory) and returns what the live engine and the
 * export need: the gain that reaches the target loudness, tied to the settings and mix it was measured on.
 */
export async function analyzeProjectMastering(
  project: Project,
  settings: ChainSettings,
  options: { sampleRate: number; onProgress?: (p: ExportProgress) => void; isCancelled?: () => boolean; deps?: MixdownDeps },
): Promise<MasteringAnalysis> {
  const deps = options.deps ?? makeMixdownDeps();
  const result = await analyzeMastering(project, deps, {
    sampleRate: options.sampleRate,
    settings,
    onProgress: options.onProgress,
    isCancelled: options.isCancelled,
  });
  reportSkipped(result.skippedPlugins);
  return {
    settingsKey: masteringKey(settings),
    mixKey: currentMixKey(project),
    gainDb: result.gainDb,
    mixLufs: result.mixStats.integratedLUFS,
    processedLufs: result.processedStats.integratedLUFS,
    durationSeconds: result.mixStats.durationSeconds,
    measuredAt: Date.now(),
  };
}

export interface FileExportOptions {
  format: 'wav' | 'mp3';
  wavBitDepth?: 16 | 24;
  mp3Kbps?: 128 | 192 | 256 | 320;
  /** null = export the mix unchanged. With `gainDb` from a current analysis the export is a single pass. */
  mastering: { settings: ChainSettings; gainDb?: number } | null;
  range?: { startSeconds: number; endSeconds: number };
  sampleRate: number;
  onProgress?: (progress: ExportProgress) => void;
  isCancelled?: () => boolean;
  deps?: MixdownDeps;
}

/**
 * Renders, optionally masters, and encodes the project of any length straight into a file (browser file storage when
 * available), block by block. Returns the finished file and the measurements of what was written.
 */
export async function exportProjectToFile(project: Project, options: FileExportOptions): Promise<{ blob: Blob; run: ExportRunResult }> {
  const plan = planMixdown(project, options.sampleRate, options.range);
  const target = await createByteTarget(options.format === 'wav' ? 'export.wav' : 'export.mp3');
  let sink;
  try {
    sink = options.format === 'wav'
      ? await createWavSink(target, 2, options.sampleRate, plan.totalFrames, options.wavBitDepth ?? 24)
      : createMp3Sink(target, 2, options.sampleRate, options.mp3Kbps ?? 320);
  } catch (err) {
    await target.abort();
    throw err;
  }
  try {
    const run = await runExport(project, options.deps ?? makeMixdownDeps(), {
      sampleRate: options.sampleRate,
      range: options.range,
      mastering: options.mastering,
      onProgress: options.onProgress,
      isCancelled: options.isCancelled,
    }, sink);
    options.onProgress?.({ stage: 'encoding', percent: 98, message: 'Finishing the file...' });
    const blob = await sink.close();
    reportSkipped(run.skippedPlugins);
    return { blob, run };
  } catch (err) {
    await sink.abort();
    throw err;
  }
}

/**
 * Reads an exported file back into audio and measures it (integrated loudness and true peak of what a listener gets,
 * including MP3 rounding). Only for files short enough to decode into memory.
 */
export async function measureExportedBlob(blob: Blob): Promise<LoudnessStats> {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = await audioEngine.init();
  const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  const meter = new LoudnessMeter(decoded.numberOfChannels, decoded.sampleRate, decoded.length);
  const data = Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c));
  const slice = 1_048_576;
  for (let start = 0; start < decoded.length; start += slice) {
    const n = Math.min(slice, decoded.length - start);
    meter.push(data.map((d) => d.subarray(start, start + n)), n);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return meter.finish();
}

/** Trigger file download directly in browser */
export function triggerFileDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}
