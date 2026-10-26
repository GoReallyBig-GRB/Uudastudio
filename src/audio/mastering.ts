/**
 * Uuda Pro - Phase 5 Mastering & Offline Audio Export Engine
 * Full implementation of:
 * - ITU-R BS.1770 / EBU R128 Integrated Loudness (LUFS) with dual gating
 * - 4x oversampled True Peak (dBTP) detection
 * - Broadcast Mastering Profiles (Podcast -16 LUFS, Broadcast EBU R128 -23 LUFS / ATSC A/85 -24 LKFS, Music -14 LUFS, Custom)
 * - "Measure and Apply" offline loudness normalization with brickwall true peak limiting
 * - Offline rendering with OfflineAudioContext honouring track mute/solo/vol/pan, clip fades/gain, and master bus
 * - Broadcast WAV (16-bit / 24-bit PCM) & MP3 encoding (lamejs v1.2.1, LGPL-3.0 license)
 * - Verification test runner for Phase 5 Acceptance Tests
 */

import { LoudnessMeter } from './loudnessMeter';
import { LookaheadLimiter } from './streamingLimiter';
import { Project } from '../types';
import { audioEngine } from './engine';
import { pluginManager, MASTER_TRACK_ID } from '../plugins/pluginManager';
import { readStreamedFrames } from '../assets/streamedStore';
import { planMixdown, type MixdownDeps, type MixdownPlan } from './blockMixdown';
import { runExport, type ExportRunResult } from './exportPipeline';
import {
  createByteTarget, createCollector, createMp3Sink, createWavSink, encodePcmBlock, memoryTarget, wavHeaderBytes,
  type AudioSink, type CollectedAudio,
} from './exportSinks';

export type MasteringProfileType = 'podcast' | 'broadcast' | 'music' | 'custom' | 'bypass';
export type BroadcastPreset = 'ebu_r128' | 'atsc_a85' | 'hot_commercial';

export interface MasteringProfileConfig {
  type: MasteringProfileType;
  name: string;
  description: string;
  targetLufs: number;
  ceilingDbTP: number;
  compressionRatio: number;
  attackMs: number;
  releaseMs: number;
  midPresenceGainDb: number;
  midPresenceFreqHz: number;
  broadcastPreset?: BroadcastPreset;
}

export const BROADCAST_PRESETS: Record<BroadcastPreset, { label: string; targetLufs: number; standard: string }> = {
  ebu_r128: {
    label: 'EBU R128 (-23 LUFS)',
    targetLufs: -23.0,
    standard: 'European Broadcast Standard (EBU R128, -23 LUFS, -1 dBTP ceiling)',
  },
  atsc_a85: {
    label: 'ATSC A/85 (-24 LKFS)',
    targetLufs: -24.0,
    standard: 'North American Television / Radio Standard (ATSC A/85, -24 LKFS / LUFS, -1 dBTP ceiling)',
  },
  hot_commercial: {
    label: 'Commercial Spot Hot (-14 LUFS)',
    targetLufs: -14.0,
    standard: 'High-Impact Radio Imaging & Commercial Promos (-14 LUFS, -1 dBTP ceiling)',
  },
};

export const MASTERING_PROFILES: Record<MasteringProfileType, MasteringProfileConfig> = {
  podcast: {
    type: 'podcast',
    name: 'Podcast Voice Master',
    description: 'Level voices consistently, warm broadcast compression, target -16.0 LUFS with -1.0 dBTP ceiling.',
    targetLufs: -16.0,
    ceilingDbTP: -1.0,
    compressionRatio: 2.5,
    attackMs: 20,
    releaseMs: 120,
    midPresenceGainDb: 1.0,
    midPresenceFreqHz: 3000,
  },
  broadcast: {
    type: 'broadcast',
    name: 'Broadcast / Radio Stinger',
    description: '4:1 aggressive compression, 5ms attack, +3 dB mid presence boost; configurable loudness (EBU R128 -23 LUFS / ATSC A/85 -24 LKFS).',
    targetLufs: -23.0,
    ceilingDbTP: -1.0,
    compressionRatio: 4.0,
    attackMs: 5,
    releaseMs: 60,
    midPresenceGainDb: 3.0,
    midPresenceFreqHz: 2500,
    broadcastPreset: 'ebu_r128',
  },
  music: {
    type: 'music',
    name: 'Music Bed / Wide Stereo',
    description: 'Preserve stereo width and bass dynamics, transparent true-peak limiter, target -14.0 LUFS with -1.0 dBTP ceiling.',
    targetLufs: -14.0,
    ceilingDbTP: -1.0,
    compressionRatio: 1.8,
    attackMs: 30,
    releaseMs: 200,
    midPresenceGainDb: 0.0,
    midPresenceFreqHz: 2500,
  },
  custom: {
    type: 'custom',
    name: 'Custom Loudness Profile',
    description: 'Full manual control over target LUFS, true peak ceiling, compressor ratio, attack, release and presence EQ.',
    targetLufs: -16.0,
    ceilingDbTP: -1.0,
    compressionRatio: 3.0,
    attackMs: 10,
    releaseMs: 100,
    midPresenceGainDb: 1.5,
    midPresenceFreqHz: 2500,
  },
  bypass: {
    type: 'bypass',
    name: 'Raw Mix (Bypass Mastering)',
    description: 'Export direct timeline mixdown without additional mastering DSP or compression.',
    targetLufs: -16.0,
    ceilingDbTP: -0.1,
    compressionRatio: 1.0,
    attackMs: 10,
    releaseMs: 100,
    midPresenceGainDb: 0.0,
    midPresenceFreqHz: 2500,
  },
};

export interface LoudnessStats {
  integratedLUFS: number;
  truePeakDbTP: number;
  rmsDb: number;
  loudnessRangeLU: number;
  durationSeconds: number;
}

export interface MeasureAndApplyResult {
  preStats: LoudnessStats;
  postStats: LoudnessStats;
  gainAdjustmentDb: number;
  /** Present only for short results kept in memory for audition; long exports go straight to a file. */
  masteredBuffer?: AudioBuffer;
  profile: MasteringProfileConfig;
  targetLufs: number;
  ceilingDbTP: number;
  passedLoudnessTolerance: boolean; // within 1 LU of target
  passedTruePeakCeiling: boolean;  // at or below ceiling
}

export interface ExportProgress {
  stage: 'rendering' | 'mastering' | 'encoding' | 'verifying' | 'complete';
  percent: number;
  message: string;
}

export interface ExportSummary {
  filename: string;
  format: 'wav' | 'mp3';
  bitDepthOrBitrate: string;
  durationSeconds: number;
  integratedLUFS: number;
  truePeakDbTP: number;
  fileSizeBytes: number;
  fileSizeFormatted: string;
  verifiedTargetLufs: number;
  lufsDelta: number;
  compliant: boolean;
  libraryUsed: string;
  license: string;
}

const EMPTY_STATS: LoudnessStats = { integratedLUFS: -70, truePeakDbTP: -70, rmsDb: -70, loudnessRangeLU: 0, durationSeconds: 0 };
const METER_SLICE_FRAMES = 1_048_576;

/**
 * Full ITU-R BS.1770-4 / EBU R128 measurement of a whole buffer (see loudnessMeter.ts for the method).
 * Long mixes never get here: they are measured block by block while they are rendered.
 */
export function measureLoudness(buffer: AudioBuffer): LoudnessStats {
  if (buffer.length === 0) return EMPTY_STATS;
  const meter = new LoudnessMeter(buffer.numberOfChannels, buffer.sampleRate, buffer.length);
  const data = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  meter.push(data, buffer.length);
  return meter.finish();
}

export async function measureLoudnessAsync(buffer: AudioBuffer, onProgress?: (progress: ExportProgress) => void, progressStart = 60, progressEnd = 70): Promise<LoudnessStats> {
  const length = buffer.length;
  if (length === 0) return EMPTY_STATS;
  const meter = new LoudnessMeter(buffer.numberOfChannels, buffer.sampleRate, length);
  const data = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  for (let start = 0; start < length; start += METER_SLICE_FRAMES) {
    const n = Math.min(METER_SLICE_FRAMES, length - start);
    meter.push(data.map((d) => d.subarray(start, start + n)), n);
    onProgress?.({
      stage: 'mastering',
      percent: Math.round(progressStart + ((start + n) / length) * (progressEnd - progressStart)),
      message: 'Analyzing loudness and true peak...',
    });
    // Let the browser paint and process input during long analyses.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return meter.finish();
}


/**
 * Builds the active (non-bypassed) plugins of one chain inside an offline context and wires them in series after
 * `source`. Returns the last node. A plugin that fails to load is skipped, so one bad module never blocks an export.
 * chainId is a track id or MASTER_TRACK_ID.
 */
/** A plugin the export had to pass through unchanged */
export interface SkippedPlugin {
  chainId: string;
  name: string;
  reason: 'missing' | 'failed';
}

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

/** The real engine, plugins and storage behind the block mixdown. Tests and self-checks can override parts. */
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

/** Results that live in memory (audition, reuse) are limited to this length; longer ones go straight to a file. */
export const MAX_IN_MEMORY_SECONDS = 15 * 60;

function assertFitsInMemory(plan: MixdownPlan): void {
  if (plan.totalFrames / plan.sampleRate > MAX_IN_MEMORY_SECONDS) {
    throw new Error(`This mix is longer than ${MAX_IN_MEMORY_SECONDS / 60} minutes, too long to hold in memory for preview. Export it to a file instead, or choose a shorter range.`);
  }
}

function collectedToBuffer(c: CollectedAudio, sampleRate: number): AudioBuffer {
  const buf = new AudioBuffer({ numberOfChannels: c.channels.length, length: c.frames, sampleRate });
  for (let ch = 0; ch < c.channels.length; ch++) buf.copyToChannel(c.channels[ch].subarray(0, c.frames) as Float32Array<ArrayBuffer>, ch);
  return buf;
}

function reportSkipped(skipped: SkippedPlugin[]): void {
  if (skipped.length > 0 && typeof window !== 'undefined') {
    // The export carries on with those plugins passed through; the app tells the user which ones
    window.dispatchEvent(new CustomEvent('uuda:export-skipped-plugins', { detail: { plugins: skipped } }));
  }
}

const toExportProgress = (onProgress?: (p: ExportProgress) => void) =>
  onProgress ? (p: { stage: ExportProgress['stage']; percent: number; message: string }) => onProgress(p) : undefined;

/**
 * Mix of the whole project (or a range) as one AudioBuffer, for short results that are auditioned or reused.
 * It is the block mixdown collected into memory; honours mute/solo, track volume and pan, clip gain, fades,
 * plugins, ducking and the master bus, like the live engine.
 */
export async function renderProjectOffline(
  project: Project,
  sampleRate: number = 48000,
  options?: {
    range?: { startSeconds: number; endSeconds: number };
    onProgress?: (progress: ExportProgress) => void;
    deps?: MixdownDeps;
  }
): Promise<AudioBuffer> {
  const plan = planMixdown(project, sampleRate, options?.range);
  assertFitsInMemory(plan);
  const collector = createCollector(2, plan.totalFrames);
  const run = await runExport(project, options?.deps ?? makeMixdownDeps(), {
    sampleRate, range: options?.range, mastering: null, onProgress: toExportProgress(options?.onProgress),
  }, collector);
  reportSkipped(run.skippedPlugins);
  return collectedToBuffer(collector.result(), sampleRate);
}

/**
 * Measure and Apply: measures the mix, masters it (presence EQ, compression, gain to the target loudness, true-peak
 * limiter) and returns the result in memory with before/after loudness. Limited to short mixes; use
 * `exportProjectToFile` for anything long.
 */
export async function masterProjectToBuffer(
  project: Project,
  profile: MasteringProfileConfig,
  sampleRate: number,
  options?: {
    targetLufs?: number;
    ceilingDbTP?: number;
    range?: { startSeconds: number; endSeconds: number };
    onProgress?: (progress: ExportProgress) => void;
    deps?: MixdownDeps;
  }
): Promise<MeasureAndApplyResult> {
  const targetLufs = options?.targetLufs ?? profile.targetLufs;
  const ceilingDbTP = options?.ceilingDbTP ?? profile.ceilingDbTP;
  const plan = planMixdown(project, sampleRate, options?.range);
  assertFitsInMemory(plan);
  const collector = createCollector(2, plan.totalFrames);
  const run = await runExport(project, options?.deps ?? makeMixdownDeps(), {
    sampleRate, range: options?.range, mastering: { ...profile, targetLufs, ceilingDbTP },
    onProgress: toExportProgress(options?.onProgress),
  }, collector);
  reportSkipped(run.skippedPlugins);
  const postStats = run.postStats;
  const preStats = run.preStats ?? postStats;
  return {
    preStats,
    postStats,
    gainAdjustmentDb: run.gainAdjustmentDb,
    masteredBuffer: collectedToBuffer(collector.result(), sampleRate),
    profile,
    targetLufs,
    ceilingDbTP,
    passedLoudnessTolerance: Math.abs(postStats.integratedLUFS - targetLufs) <= 1.0,
    passedTruePeakCeiling: postStats.truePeakDbTP <= ceilingDbTP + 0.1,
  };
}

/** Loudness and true peak of the project's mix, of any length, without keeping the audio. */
export async function measureProjectLoudness(
  project: Project,
  sampleRate: number,
  options?: { range?: { startSeconds: number; endSeconds: number }; onProgress?: (progress: ExportProgress) => void; deps?: MixdownDeps },
): Promise<LoudnessStats> {
  const discard: AudioSink = { async write() {}, async close() { return new Blob(); }, async abort() {} };
  const run = await runExport(project, options?.deps ?? makeMixdownDeps(), {
    sampleRate, range: options?.range, mastering: null, onProgress: toExportProgress(options?.onProgress),
  }, discard);
  reportSkipped(run.skippedPlugins);
  return run.postStats;
}

export interface FileExportOptions {
  format: 'wav' | 'mp3';
  wavBitDepth?: 16 | 24;
  mp3Kbps?: 128 | 192 | 256 | 320;
  /** null = export the mix unchanged */
  mastering: (MasteringProfileConfig & { targetLufs: number; ceilingDbTP: number }) | null;
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
  const sink = options.format === 'wav'
    ? await createWavSink(target, 2, options.sampleRate, plan.totalFrames, options.wavBitDepth ?? 24)
    : createMp3Sink(target, 2, options.sampleRate, options.mp3Kbps ?? 320);
  try {
    const run = await runExport(project, options.deps ?? makeMixdownDeps(), {
      sampleRate: options.sampleRate,
      range: options.range,
      mastering: options.mastering,
      onProgress: toExportProgress(options.onProgress),
      isCancelled: options.isCancelled,
    }, sink);
    options.onProgress?.({ stage: 'encoding', percent: 97, message: 'Finishing the file...' });
    const blob = await sink.close();
    reportSkipped(run.skippedPlugins);
    return { blob, run };
  } catch (err) {
    await sink.abort();
    throw err;
  }
}

/**
 * Mastering DSP Chain:
 * Presence Filter -> Multi-stage Compression -> Normalization -> Lookahead True Peak Limiter
 */
export async function applyLookaheadLimiterChannel(
  inData: Float32Array,
  outData: Float32Array,
  ceilingLinear: number,
  lookaheadSamples: number,
  releaseCoeff: number,
  onProgress?: (progress: ExportProgress) => void,
  progressBase = 0,
  progressSpan = 1
): Promise<void> {
  const length = inData.length;
  if (outData.length < length) throw new Error('Limiter output buffer is shorter than its input.');
  const limiter = new LookaheadLimiter(ceilingLinear, lookaheadSamples, releaseCoeff);
  const slice = 1_048_576;
  let written = 0;
  for (let start = 0; start < length; start += slice) {
    const out = limiter.process(inData.subarray(start, Math.min(length, start + slice)));
    outData.set(out, written);
    written += out.length;
    const completed = progressBase + (Math.min(length, start + slice) / Math.max(1, length)) * progressSpan;
    onProgress?.({
      stage: 'mastering',
      percent: Math.min(84, 75 + Math.floor(completed * 9)),
      message: `Applying lookahead limiter (${Math.round(completed * 100)}%)...`,
    });
    // Let the browser paint and process input during long limiter passes.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  outData.set(limiter.finish(), written);
}


/**
 * Encode an AudioBuffer to a 16-bit or 24-bit RIFF/WAVE Blob (same encoder as the streaming export).
 */
export function exportAudioBufferToWav(buffer: AudioBuffer, bitDepth: 16 | 24 = 16): Blob {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const header = wavHeaderBytes(buffer.numberOfChannels, buffer.sampleRate, buffer.length, bitDepth);
  return new Blob([header as BlobPart, encodePcmBlock(channels, 0, buffer.length, bitDepth) as BlobPart], { type: 'audio/wav' });
}

/**
 * Responsive WAV encoder: about one second of PCM at a time, yielding to the browser between blocks.
 */
export async function exportAudioBufferToWavAsync(
  buffer: AudioBuffer,
  bitDepth: 16 | 24 = 16,
  onProgress?: (progress: ExportProgress) => void
): Promise<Blob> {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  // Validates channel count, bit depth and the RIFF 4 GiB limit before any sample is read
  const sink = await createWavSink(memoryTarget(), channels, buffer.sampleRate, length, bitDepth);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  const framesPerChunk = Math.max(1, buffer.sampleRate);
  const totalChunks = Math.ceil(length / framesPerChunk);
  onProgress?.({ stage: 'encoding', percent: 80, message: `Encoding ${bitDepth}-bit PCM WAV in bounded blocks...` });
  for (let i = 0; i < totalChunks; i++) {
    const start = i * framesPerChunk;
    const n = Math.min(framesPerChunk, length - start);
    await sink.write(data.map((d) => d.subarray(start, start + n)), n);
    const ratio = (i + 1) / Math.max(1, totalChunks);
    onProgress?.({
      stage: 'encoding',
      percent: Math.min(94, Math.round(80 + ratio * 14)),
      message: `Encoding WAV blocks... ${Math.round(ratio * 100)}% (${i + 1}/${totalChunks})`,
    });
    // Let the browser paint progress and handle input between PCM blocks.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const blob = await sink.close();
  if (blob.size !== 44 + length * channels * (bitDepth / 8)) throw new Error('WAV encoder produced an unexpected file size.');
  return blob;
}

/**
 * Encode an AudioBuffer to an MP3 Blob with the local lamejs encoder (same encoder as the streaming export).
 */
export async function exportAudioBufferToMp3(
  buffer: AudioBuffer,
  kbps: 128 | 192 | 256 | 320 = 320,
  onProgress?: (progress: ExportProgress) => void
): Promise<Blob> {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const sink = createMp3Sink(memoryTarget(), numChannels, buffer.sampleRate, kbps);
  const data = Array.from({ length: numChannels }, (_, c) => buffer.getChannelData(c));
  const slice = 1152 * 20;
  onProgress?.({ stage: 'encoding', percent: 70, message: `Encoding MP3 locally (${kbps} kbps)...` });
  for (let i = 0; i < length; i += slice) {
    const n = Math.min(slice, length - i);
    await sink.write(data.map((d) => d.subarray(i, i + n)), n);
    if ((i / slice) % 10 === 0 || i + n >= length) {
      const ratio = Math.min(1, (i + n) / Math.max(1, length));
      onProgress?.({ stage: 'encoding', percent: Math.min(99, Math.round(70 + ratio * 29)), message: `Encoding MP3 locally... ${Math.round(ratio * 100)}%` });
      // Allow the browser to repaint progress during long encodes.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  const blob = await sink.close();
  onProgress?.({ stage: 'encoding', percent: 100, message: 'Local MP3 encoding completed.' });
  return blob;
}

/**
 * Acceptance Test Verification: Reads an exported file Blob back into an AudioBuffer
 * and verifies that:
 * 1. Integrated loudness is within 1 LU of target
 * 2. True peak is <= ceilingDbTP
 */
export async function verifyExportedBlob(
  blob: Blob,
  targetLufs: number,
  ceilingDbTP: number = -1.0,
  onProgress?: (progress: ExportProgress) => void
): Promise<{
  integratedLUFS: number;
  truePeakDbTP: number;
  passedLoudness: boolean;
  passedTruePeak: boolean;
  compliant: boolean;
}> {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = await audioEngine.init();
  const decodedBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

  const stats = await measureLoudnessAsync(
    decodedBuffer,
    (progress) => {
      onProgress?.({
        stage: 'verifying',
        percent: Math.min(99, 95 + Math.round(progress.percent / 100 * 4)),
        message: 'Verifying decoded export loudness and true peak...',
      });
    },
    0,
    100
  );
  const passedLoudness = Math.abs(stats.integratedLUFS - targetLufs) <= 1.0;
  const passedTruePeak = stats.truePeakDbTP <= (ceilingDbTP + 0.1);

  return {
    integratedLUFS: stats.integratedLUFS,
    truePeakDbTP: stats.truePeakDbTP,
    passedLoudness,
    passedTruePeak,
    compliant: passedLoudness && passedTruePeak,
  };
}

/**
 * Trigger file download directly in browser
 */
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
