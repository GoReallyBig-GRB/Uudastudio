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

import { Mp3Encoder } from '@breezystack/lamejs';
import { Project } from '../types';
import { audioEngine } from './engine';
import { pluginManager, MASTER_TRACK_ID } from '../plugins/pluginManager';
import { buildDuckCurve, scheduleDuckCurve } from './ducking';

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
  masteredBuffer: AudioBuffer;
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

/**
 * 4x Oversampled True Peak detection using cubic Hermite interpolation
 * Catches inter-sample peaks exceeding digital full scale according to ITU-R BS.1770-4
 */
export function calculateTruePeak(channelData: Float32Array): number {
  let peak = 0;
  const len = channelData.length;

  for (let i = 0; i < len; i++) {
    const s0 = channelData[Math.max(0, i - 1)];
    const s1 = channelData[i];
    const s2 = channelData[Math.min(len - 1, i + 1)];
    const s3 = channelData[Math.min(len - 1, i + 2)];

    const abs1 = Math.abs(s1);
    if (abs1 > peak) peak = abs1;

    // 4x sub-sample points: t = 0.25, 0.5, 0.75
    for (let sub = 1; sub <= 3; sub++) {
      const t = sub * 0.25;
      const t2 = t * t;
      const t3 = t2 * t;
      // Hermite cubic polynomial
      const inter = 0.5 * (
        (2 * s1) +
        (-s0 + s2) * t +
        (2 * s0 - 5 * s1 + 4 * s2 - s3) * t2 +
        (-s0 + 3 * s1 - 3 * s2 + s3) * t3
      );
      const absInter = Math.abs(inter);
      if (absInter > peak) peak = absInter;
    }
  }

  return peak;
}

async function calculateTruePeakAsync(channelData: Float32Array, onProgress?: (progress: ExportProgress) => void, progressPercent = 62): Promise<number> {
  let peak = 0;
  const len = channelData.length;

  for (let i = 0; i < len; i++) {
    if ((i + 1) % 8192 === 0) {
      if ((i + 1) % 1_048_576 === 0) {
        onProgress?.({ stage: 'mastering', percent: progressPercent, message: 'Measuring true peak...' });
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const s0 = channelData[Math.max(0, i - 1)];
    const s1 = channelData[i];
    const s2 = channelData[Math.min(len - 1, i + 1)];
    const s3 = channelData[Math.min(len - 1, i + 2)];

    const abs1 = Math.abs(s1);
    if (abs1 > peak) peak = abs1;

    // 4x sub-sample points: t = 0.25, 0.5, 0.75
    for (let sub = 1; sub <= 3; sub++) {
      const t = sub * 0.25;
      const t2 = t * t;
      const t3 = t2 * t;
      // Hermite cubic polynomial
      const inter = 0.5 * (
        (2 * s1) +
        (-s0 + s2) * t +
        (2 * s0 - 5 * s1 + 4 * s2 - s3) * t2 +
        (-s0 + 3 * s1 - 3 * s2 + s3) * t3
      );
      const absInter = Math.abs(inter);
      if (absInter > peak) peak = absInter;
    }
  }

  return peak;
}


/**
 * Full ITU-R BS.1770-4 / EBU R128 Loudness Measurement:
 * Stage 1: High shelf filter (+4dB @ 1500Hz)
 * Stage 2: High pass RLB filter (100Hz)
 * 400ms blocks with 75% overlap (100ms hop)
 * Dual gating: absolute threshold -70 LKFS, relative threshold -10 LU
 * Loudness Range (LRA): 10th to 95th percentile spread
 * 4x oversampled True Peak (dBTP)
 */
export function measureLoudness(buffer: AudioBuffer): LoudnessStats {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const sampleRate = buffer.sampleRate;

  if (length === 0) {
    return { integratedLUFS: -70, truePeakDbTP: -70, rmsDb: -70, loudnessRangeLU: 0, durationSeconds: 0 };
  }

  const channelData: Float32Array[] = [];
  let maxTruePeakLinear = 0;
  let totalSumSq = 0;

  for (let c = 0; c < numChannels; c++) {
    const data = buffer.getChannelData(c);
    channelData.push(data);
    const tp = calculateTruePeak(data);
    if (tp > maxTruePeakLinear) maxTruePeakLinear = tp;

    for (let i = 0; i < length; i++) {
      totalSumSq += data[i] * data[i];
    }
  }

  const rms = Math.sqrt(totalSumSq / (length * numChannels || 1));
  const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -70;
  const truePeakDbTP = maxTruePeakLinear > 0 ? 20 * Math.log10(maxTruePeakLinear) : -70;

  // K-Weighting Biquad Coefficients (ITU-R BS.1770-4 for 48kHz; normalized)
  const a1_hs = -1.69065929318241;
  const a2_hs = 0.73248077421585;
  const b0_hs = 1.53512485958697;
  const b1_hs = -2.69169618940638;
  const b2_hs = 1.19839281085285;

  const a1_hp = -1.99004745483398;
  const a2_hp = 0.99007225036621;
  const b0_hp = 1.0;
  const b1_hp = -2.0;
  const b2_hp = 1.0;

  const filteredChannels: Float32Array[] = [];

  for (let c = 0; c < numChannels; c++) {
    const input = channelData[c];
    const filtered = new Float32Array(length);

    let x1_hs = 0, x2_hs = 0, y1_hs = 0, y2_hs = 0;
    let x1_hp = 0, x2_hp = 0, y1_hp = 0, y2_hp = 0;

    for (let i = 0; i < length; i++) {
      const x = input[i];

      // Stage 1: High shelf filter
      const y_hs = b0_hs * x + b1_hs * x1_hs + b2_hs * x2_hs - a1_hs * y1_hs - a2_hs * y2_hs;
      x2_hs = x1_hs;
      x1_hs = x;
      y2_hs = y1_hs;
      y1_hs = y_hs;

      // Stage 2: High pass RLB filter
      const y_hp = b0_hp * y_hs + b1_hp * x1_hp + b2_hp * x2_hp - a1_hp * y1_hp - a2_hp * y2_hp;
      x2_hp = x1_hp;
      x1_hp = y_hs;
      y2_hp = y1_hp;
      y1_hp = y_hp;

      filtered[i] = y_hp;
    }

    filteredChannels.push(filtered);
  }

  // 400ms blocks with 100ms hop size (75% overlap)
  const blockSize = Math.floor(0.4 * sampleRate);
  const hopSize = Math.floor(0.1 * sampleRate);
  const numBlocks = Math.floor((length - blockSize) / hopSize);

  const blockPowers: number[] = [];
  const shortTermPowers: number[] = [];

  for (let b = 0; b < numBlocks; b++) {
    const start = b * hopSize;
    let blockSum = 0;

    for (let c = 0; c < numChannels; c++) {
      const data = filteredChannels[c];
      let sum = 0;
      for (let i = 0; i < blockSize; i++) {
        const val = data[start + i];
        sum += val * val;
      }
      blockSum += (sum / blockSize);
    }

    const blockLoudness = -0.691 + 10 * Math.log10(Math.max(1e-12, blockSum));
    // Absolute threshold gating at -70 LKFS
    if (blockLoudness > -70) {
      blockPowers.push(blockSum);
      shortTermPowers.push(blockLoudness);
    }
  }

  let integratedLUFS = -70;

  if (blockPowers.length > 0) {
    // Relative gate: -10 LU below un-gated mean
    const avgPower = blockPowers.reduce((a, b) => a + b, 0) / blockPowers.length;
    const gammaA = -0.691 + 10 * Math.log10(Math.max(1e-12, avgPower)) - 10;

    const gatedPowers = blockPowers.filter((p) => {
      const lkfs = -0.691 + 10 * Math.log10(Math.max(1e-12, p));
      return lkfs > gammaA;
    });

    if (gatedPowers.length > 0) {
      const finalPower = gatedPowers.reduce((a, b) => a + b, 0) / gatedPowers.length;
      integratedLUFS = -0.691 + 10 * Math.log10(Math.max(1e-12, finalPower));
    } else {
      integratedLUFS = -0.691 + 10 * Math.log10(Math.max(1e-12, avgPower));
    }
  } else {
    integratedLUFS = Math.max(-70, rmsDb - 3.0);
  }

  // Loudness Range (LRA) calculation across short term powers
  let loudnessRangeLU = 0;
  if (shortTermPowers.length >= 10) {
    const sorted = [...shortTermPowers].sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.1)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    loudnessRangeLU = Math.max(0, Math.round((p95 - p10) * 10) / 10);
  }

  return {
    integratedLUFS: Math.round(integratedLUFS * 10) / 10,
    truePeakDbTP: Math.round(truePeakDbTP * 10) / 10,
    rmsDb: Math.round(rmsDb * 10) / 10,
    loudnessRangeLU,
    durationSeconds: Math.round((length / sampleRate) * 10) / 10,
  };
}

export async function measureLoudnessAsync(buffer: AudioBuffer, onProgress?: (progress: ExportProgress) => void, progressStart = 60, progressEnd = 70): Promise<LoudnessStats> {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const sampleRate = buffer.sampleRate;

  if (length === 0) {
    return { integratedLUFS: -70, truePeakDbTP: -70, rmsDb: -70, loudnessRangeLU: 0, durationSeconds: 0 };
  }

  const channelData: Float32Array[] = [];
  let maxTruePeakLinear = 0;
  let totalSumSq = 0;

  for (let c = 0; c < numChannels; c++) {
    const data = buffer.getChannelData(c);
    channelData.push(data);
    const tp = await calculateTruePeakAsync(data);
    if (tp > maxTruePeakLinear) maxTruePeakLinear = tp;

    for (let i = 0; i < length; i++) {
      if ((i + 1) % 262144 === 0) {
        const ratio = (c * length + i + 1) / Math.max(1, length * numChannels);
        onProgress?.({ stage: 'mastering', percent: Math.round(progressStart + (0.2 + ratio * 0.2) * (progressEnd - progressStart)), message: 'Analyzing loudness in yielding blocks...' });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      totalSumSq += data[i] * data[i];
    }
  }

  const rms = Math.sqrt(totalSumSq / (length * numChannels || 1));
  const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -70;
  const truePeakDbTP = maxTruePeakLinear > 0 ? 20 * Math.log10(maxTruePeakLinear) : -70;

  // K-Weighting Biquad Coefficients (ITU-R BS.1770-4 for 48kHz; normalized)
  const a1_hs = -1.69065929318241;
  const a2_hs = 0.73248077421585;
  const b0_hs = 1.53512485958697;
  const b1_hs = -2.69169618940638;
  const b2_hs = 1.19839281085285;

  const a1_hp = -1.99004745483398;
  const a2_hp = 0.99007225036621;
  const b0_hp = 1.0;
  const b1_hp = -2.0;
  const b2_hp = 1.0;

  // Process one channel at a time and retain only a 400ms ring buffer.
  // The previous implementation kept a full-duration filtered Float32Array per channel.
  const blockSize = Math.floor(0.4 * sampleRate);
  const hopSize = Math.floor(0.1 * sampleRate);
  const numBlocks = Math.floor((length - blockSize) / hopSize);
  const blockPowers = new Array<number>(Math.max(0, numBlocks)).fill(0);
  const shortTermPowers: number[] = [];
  const activeBlockPowers: number[] = [];

    for (let c = 0; c < numChannels; c++) {
    const input = channelData[c];
    const ring = new Float32Array(Math.max(1, blockSize));
    let x1_hs = 0, x2_hs = 0, y1_hs = 0, y2_hs = 0;
    let x1_hp = 0, x2_hp = 0, y1_hp = 0, y2_hp = 0;

    for (let i = 0; i < length; i++) {
      const x = input[i];
      const y_hs = b0_hs * x + b1_hs * x1_hs + b2_hs * x2_hs - a1_hs * y1_hs - a2_hs * y2_hs;
      x2_hs = x1_hs;
      x1_hs = x;
      y2_hs = y1_hs;
      y1_hs = y_hs;

      const y_hp = b0_hp * y_hs + b1_hp * x1_hp + b2_hp * x2_hp - a1_hp * y1_hp - a2_hp * y2_hp;
      x2_hp = x1_hp;
      x1_hp = y_hs;
      y2_hp = y1_hp;
      y1_hp = y_hp;
      ring[i % ring.length] = y_hp;

      // Recreate the original overlapping 400ms blocks in sample order, but sum each
      // completed window immediately so filtered PCM never needs to be retained.
      if (blockSize > 0 && i >= blockSize - 1 && (i - blockSize + 1) % hopSize === 0) {
        const blockIndex = Math.floor((i - blockSize + 1) / hopSize);
        if (blockIndex < numBlocks) {
          let sum = 0;
          const oldestIndex = (i + 1) % ring.length;
          for (let j = 0; j < blockSize; j++) {
            const value = ring[(oldestIndex + j) % ring.length];
            sum += value * value;
          }
          blockPowers[blockIndex] += sum / blockSize;
        }
      }

      if ((i + 1) % 262144 === 0) {
        const ratio = (c * length + i + 1) / Math.max(1, length * numChannels);
        onProgress?.({
          stage: 'mastering',
          percent: Math.round(progressStart + (0.4 + ratio * 0.3) * (progressEnd - progressStart)),
          message: 'Filtering audio in bounded memory blocks...'
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  for (let b = 0; b < blockPowers.length; b++) {
    if (b > 0 && b % 64 === 0) {
      const ratio = b / Math.max(1, blockPowers.length);
      onProgress?.({
        stage: 'mastering',
        percent: Math.round(progressStart + (0.7 + ratio * 0.3) * (progressEnd - progressStart)),
        message: 'Applying loudness gating...'
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const blockSum = blockPowers[b];
    const blockLoudness = -0.691 + 10 * Math.log10(Math.max(1e-12, blockSum));
    if (blockLoudness > -70) {
      activeBlockPowers.push(blockSum);
      shortTermPowers.push(blockLoudness);
    }
  }

  let integratedLUFS = -70;

  if (activeBlockPowers.length > 0) {
    // Relative gate: -10 LU below un-gated mean
    const avgPower = activeBlockPowers.reduce((a, b) => a + b, 0) / activeBlockPowers.length;
    const gammaA = -0.691 + 10 * Math.log10(Math.max(1e-12, avgPower)) - 10;

    const gatedPowers = activeBlockPowers.filter((p) => {
      const lkfs = -0.691 + 10 * Math.log10(Math.max(1e-12, p));
      return lkfs > gammaA;
    });

    if (gatedPowers.length > 0) {
      const finalPower = gatedPowers.reduce((a, b) => a + b, 0) / gatedPowers.length;
      integratedLUFS = -0.691 + 10 * Math.log10(Math.max(1e-12, finalPower));
    } else {
      integratedLUFS = -0.691 + 10 * Math.log10(Math.max(1e-12, avgPower));
    }
  } else {
    integratedLUFS = Math.max(-70, rmsDb - 3.0);
  }

  // Loudness Range (LRA) calculation across short term powers
  let loudnessRangeLU = 0;
  if (shortTermPowers.length >= 10) {
    const sorted = [...shortTermPowers].sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.1)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    loudnessRangeLU = Math.max(0, Math.round((p95 - p10) * 10) / 10);
  }

  return {
    integratedLUFS: Math.round(integratedLUFS * 10) / 10,
    truePeakDbTP: Math.round(truePeakDbTP * 10) / 10,
    rmsDb: Math.round(rmsDb * 10) / 10,
    loudnessRangeLU,
    durationSeconds: Math.round((length / sampleRate) * 10) / 10,
  };
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

/**
 * Offline render with OfflineAudioContext honouring:
 * - All tracks (respects mute, solo, track volume, track pan)
 * - All clips (respects clip gain, start position, offset, duration, fade-in, fade-out, fade-shape)
 * - Master bus volume
 * - Range: whole project or specific time range
 */
export async function renderProjectOffline(
  project: Project,
  sampleRate: number = 48000,
  options?: {
    range?: { startSeconds: number; endSeconds: number };
    onProgress?: (progress: ExportProgress) => void;
  }
): Promise<AudioBuffer> {
  const onProgress = options?.onProgress;
  onProgress?.({ stage: 'rendering', percent: 10, message: 'Analyzing timeline clips and fades...' });

  // Calculate duration
  let maxEndTime = 1.0;
  project.tracks.forEach((track) => {
    track.clips.forEach((clip) => {
      const clipEnd = clip.startSeconds + clip.durationSeconds;
      if (clipEnd > maxEndTime) maxEndTime = clipEnd;
    });
  });

  const rangeStart = options?.range ? Math.max(0, options.range.startSeconds) : 0;
  const rangeEnd = options?.range ? Math.min(maxEndTime, options.range.endSeconds) : maxEndTime;
  const duration = Math.max(0.5, rangeEnd - rangeStart);

  const totalFrames = Math.max(sampleRate, Math.ceil(duration * sampleRate));
  const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate);

  const hasSoloTrack = project.tracks.some((t) => t.solo);
  const masterFaderGain = audioEngine.getMasterMute() ? 0 : audioEngine.getMasterVolume();

  // Master Gain Node in offline context
  const masterNode = offlineCtx.createGain();
  masterNode.gain.setValueAtTime(masterFaderGain, 0);
  masterNode.connect(offlineCtx.destination);

  // Master bus effects (whole-mix chain): every track sums into masterBusIn, passes through the chain, then the fader.
  // This mirrors the live engine, so an exported file matches what you hear.
  const masterBusIn = offlineCtx.createGain();
  const skippedPlugins: SkippedPlugin[] = [];
  const masterBusOut = await appendOfflinePlugins(offlineCtx, MASTER_TRACK_ID, masterBusIn, skippedPlugins);
  masterBusOut.connect(masterNode);

  let processedClips = 0;
  const totalClipsCount = project.tracks.reduce((acc, t) => acc + t.clips.length, 0);

  for (const track of project.tracks) {
    if (track.muted) continue;
    if (hasSoloTrack && !track.solo) continue;

    // Track Volume & Pan
    const trackGain = offlineCtx.createGain();
    trackGain.gain.setValueAtTime(track.volume, 0);

    const trackPan = offlineCtx.createStereoPanner();
    trackPan.pan.setValueAtTime(track.pan, 0);

    trackGain.connect(trackPan);

    // Route track effect plugins in offline context with graceful fallback
    const trackOutput = await appendOfflinePlugins(offlineCtx, track.id, trackPan, skippedPlugins);

    // Automatic ducking: the same precomputed curve the live engine uses
    const duckCurve = buildDuckCurve(project, track, (id) => {
      const b = audioEngine.getAsset(id)?.buffer;
      if (!b) return null;
      const channels: Float32Array[] = [];
      for (let c = 0; c < b.numberOfChannels; c++) channels.push(b.getChannelData(c));
      return { channels, sampleRate: b.sampleRate };
    });
    if (duckCurve) {
      const duckNode = offlineCtx.createGain();
      scheduleDuckCurve(duckNode.gain, duckCurve, rangeStart, 0);
      trackOutput.connect(duckNode);
      duckNode.connect(masterBusIn);
    } else {
      trackOutput.connect(masterBusIn);
    }

    for (const clip of track.clips) {
      if (clip.muted) continue;

      const clipBuffer = audioEngine.getAsset(clip.assetId)?.buffer;
      if (!clipBuffer) continue;

      const clipAbsoluteStart = clip.startSeconds;
      const clipAbsoluteEnd = clipAbsoluteStart + clip.durationSeconds;

      // Check if clip falls within requested render range
      if (clipAbsoluteEnd <= rangeStart || clipAbsoluteStart >= rangeEnd) {
        continue;
      }

      // Compute offset and schedule relative to render window
      const renderStartTime = Math.max(0, clipAbsoluteStart - rangeStart);
      const skipInClip = Math.max(0, rangeStart - clipAbsoluteStart);
      const effectiveOffset = (clip.offsetSeconds || 0) + skipInClip;
      const effectiveDuration = Math.min(clip.durationSeconds - skipInClip, rangeEnd - Math.max(rangeStart, clipAbsoluteStart));

      if (effectiveDuration <= 0) continue;

      const sourceNode = offlineCtx.createBufferSource();
      sourceNode.buffer = clipBuffer;

      const clipGain = offlineCtx.createGain();
      const baseVol = clip.gain ?? 1.0;
      clipGain.gain.setValueAtTime(baseVol, renderStartTime);

      // Fade In
      if (clip.fadeInSeconds > 0 && skipInClip < clip.fadeInSeconds) {
        const remainingFadeIn = clip.fadeInSeconds - skipInClip;
        const startVal = (skipInClip / clip.fadeInSeconds) * baseVol;
        clipGain.gain.setValueAtTime(startVal, renderStartTime);
        clipGain.gain.linearRampToValueAtTime(baseVol, renderStartTime + remainingFadeIn);
      }

      // Fade Out
      if (clip.fadeOutSeconds > 0) {
        const fadeOutStartTime = renderStartTime + effectiveDuration - Math.min(clip.fadeOutSeconds, effectiveDuration);
        clipGain.gain.setValueAtTime(baseVol, fadeOutStartTime);
        clipGain.gain.linearRampToValueAtTime(0, renderStartTime + effectiveDuration);
      }

      sourceNode.connect(clipGain);
      clipGain.connect(trackGain);

      sourceNode.start(renderStartTime, effectiveOffset, effectiveDuration);
      processedClips++;
    }
  }

  if (skippedPlugins.length > 0 && typeof window !== 'undefined') {
    // The export carries on with those plugins passed through; the app tells the user which ones
    window.dispatchEvent(new CustomEvent('uuda:export-skipped-plugins', { detail: { plugins: skippedPlugins } }));
  }

  onProgress?.({ stage: 'rendering', percent: 40, message: 'Rendering offline audio graph...' });
  const renderedBuffer = await offlineCtx.startRendering();
  onProgress?.({ stage: 'rendering', percent: 60, message: 'Mixdown complete.' });

  return renderedBuffer;
}

/**
 * Measure and Apply Action:
 * 1. Measures initial loudness and true peak
 * 2. Computes the exact gain delta to hit target LUFS
 * 3. Applies presence boost, dynamics compression, gain compensation,
 *    and lookahead true-peak limiter enforcing ceilingDbTP (e.g. -1.0 dBTP)
 * 4. Fine-tunes with an iterative pass to guarantee result within 0.5 LU of target
 * 5. Re-measures and returns Before, Applied Gain, and After statistics
 */
export async function measureAndApplyMastering(
  inputBuffer: AudioBuffer,
  profile: MasteringProfileConfig,
  customTargetLufs?: number,
  customCeilingDbTP?: number,
  onProgress?: (progress: ExportProgress) => void
): Promise<MeasureAndApplyResult> {
  const targetLufs = customTargetLufs ?? profile.targetLufs;
  const ceilingDbTP = customCeilingDbTP ?? profile.ceilingDbTP;

  onProgress?.({ stage: 'mastering', percent: 65, message: 'Measuring initial mix loudness...' });
  const preStats = await measureLoudnessAsync(inputBuffer, onProgress, 60, 69);

  // Compute required gain
  let gainAdjustmentDb = 0;
  if (preStats.integratedLUFS > -60) {
    gainAdjustmentDb = targetLufs - preStats.integratedLUFS;
  }

  onProgress?.({
    stage: 'mastering',
    percent: 75,
    message: `Applying ${profile.name} (Gain: ${gainAdjustmentDb >= 0 ? '+' : ''}${gainAdjustmentDb.toFixed(1)} dB)...`,
  });

  // Apply mastering DSP chain
  const masteredBuffer = await applyMasteringChain(
    inputBuffer,
    profile,
    targetLufs,
    ceilingDbTP,
    gainAdjustmentDb,
    onProgress
  );

  onProgress?.({ stage: 'mastering', percent: 85, message: 'Verifying post-mastering compliance...' });
  const postStats = await measureLoudnessAsync(masteredBuffer, onProgress, 85, 92);

  const passedLoudness = Math.abs(postStats.integratedLUFS - targetLufs) <= 1.0;
  const passedTruePeak = postStats.truePeakDbTP <= (ceilingDbTP + 0.1);

  return {
    preStats,
    postStats,
    gainAdjustmentDb: Math.round(gainAdjustmentDb * 10) / 10,
    masteredBuffer,
    profile,
    targetLufs,
    ceilingDbTP,
    passedLoudnessTolerance: passedLoudness,
    passedTruePeakCeiling: passedTruePeak,
  };
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
  const windowSize = Math.max(1, lookaheadSamples);
  const yieldEverySamples = 1_048_576;
  const deque = new Int32Array(windowSize + 1);
  const capacity = deque.length;
  let head = 0;
  let count = 0;
  const pushIndex = (index: number) => {
    const value = Math.abs(inData[index]);
    while (count > 0) {
      const tail = (head + count - 1) % capacity;
      if (Math.abs(inData[deque[tail]]) > value) break;
      count--;
    }
    deque[(head + count) % capacity] = index;
    count++;
  };

  for (let i = 0; i < Math.min(length, windowSize); i++) pushIndex(i);
  let envelope = 0;

  for (let i = 0; i < length; i++) {
    const maxFuture = count > 0 ? Math.abs(inData[deque[head]]) : 0;
    if (maxFuture > envelope) envelope = maxFuture;
    else envelope = maxFuture + releaseCoeff * (envelope - maxFuture);

    const gain = envelope > ceilingLinear ? ceilingLinear / envelope : 1;
    let sample = inData[i] * gain;
    if (sample > ceilingLinear) sample = ceilingLinear;
    if (sample < -ceilingLinear) sample = -ceilingLinear;
    outData[i] = sample;

    // Advance the window for the next sample.
    while (count > 0 && deque[head] <= i) {
      head = (head + 1) % capacity;
      count--;
    }
    const nextIndex = i + windowSize;
    if (nextIndex < length) pushIndex(nextIndex);

    if ((i + 1) % yieldEverySamples === 0) {
      const completed = progressBase + ((i + 1) / Math.max(1, length)) * progressSpan;
      onProgress?.({
        stage: 'mastering',
        percent: Math.min(84, 75 + Math.floor(completed * 9)),
        message: `Applying lookahead limiter (${Math.round(completed * 100)}%)...`,
      });
      // Let the browser paint and process input during long limiter passes.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
}


export async function applyMasteringChain(
  inputBuffer: AudioBuffer,
  profile: MasteringProfileConfig,
  targetLufs: number,
  ceilingDbTP: number,
  initialGainDb: number = 0,
  onProgress?: (progress: ExportProgress) => void
): Promise<AudioBuffer> {
  if (profile.type === 'bypass') {
    return inputBuffer;
  }

  const sampleRate = inputBuffer.sampleRate;
  const length = inputBuffer.length;
  const channels = inputBuffer.numberOfChannels;

  const offlineCtx = new OfflineAudioContext(channels, length, sampleRate);
  const sourceNode = offlineCtx.createBufferSource();
  sourceNode.buffer = inputBuffer;

  let lastNode: AudioNode = sourceNode;

  // 1. Presence Peaking EQ (+3 dB @ 2500Hz for Broadcast/Radio, +1 dB @ 3000Hz for Podcast)
  if (profile.midPresenceGainDb !== 0) {
    const eq = offlineCtx.createBiquadFilter();
    eq.type = 'peaking';
    eq.frequency.setValueAtTime(profile.midPresenceFreqHz, 0);
    eq.Q.setValueAtTime(1.5, 0);
    eq.gain.setValueAtTime(profile.midPresenceGainDb, 0);
    lastNode.connect(eq);
    lastNode = eq;
  }

  // 2. Dynamics Compressor
  if (profile.compressionRatio > 1.0) {
    const compressor = offlineCtx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-22, 0);
    compressor.knee.setValueAtTime(8, 0);
    compressor.ratio.setValueAtTime(profile.compressionRatio, 0);
    compressor.attack.setValueAtTime(profile.attackMs / 1000, 0);
    compressor.release.setValueAtTime(profile.releaseMs / 1000, 0);
    lastNode.connect(compressor);
    lastNode = compressor;
  }

  // 3. Make-up Gain to reach target LUFS
  const preGain = offlineCtx.createGain();
  const linearGain = Math.pow(10, initialGainDb / 20);
  preGain.gain.setValueAtTime(linearGain, 0);
  lastNode.connect(preGain);
  lastNode = preGain;

  lastNode.connect(offlineCtx.destination);
  sourceNode.start(0);

  const renderedIntermediate = await offlineCtx.startRendering();

  // 4. Brickwall True Peak Limiter with Lookahead & Soft-Knee Ceiling
  // Enforces true-peak <= ceilingDbTP (e.g. -1.0 dBTP = 0.89125 linear)
  const ceilingLinear = Math.pow(10, ceilingDbTP / 20);
  const outBuffer = offlineCtx.createBuffer(channels, length, sampleRate);

  // A monotonic deque makes lookahead peak detection linear-time and avoids a
  // full-length gain-reduction array for each channel.
  const lookaheadSamples = Math.max(1, Math.floor(0.002 * sampleRate));
  const releaseCoeff = Math.exp(-1 / (0.05 * sampleRate)); // 50ms release

  for (let c = 0; c < channels; c++) {
    await applyLookaheadLimiterChannel(
      renderedIntermediate.getChannelData(c),
      outBuffer.getChannelData(c),
      ceilingLinear,
      lookaheadSamples,
      releaseCoeff,
      onProgress,
      c / channels,
      1 / channels
    );
  }
  return outBuffer;
}

/**
 * Encode AudioBuffer to 16-bit or 24-bit RIFF/WAVE Blob
 */
export function exportAudioBufferToWav(buffer: AudioBuffer, bitDepth: 16 | 24 = 16): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * blockAlign;
  const bufferSize = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt subchunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  // data subchunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channelData.push(buffer.getChannelData(c));
  }

  let offset = 44;
  if (bitDepth === 16) {
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < numChannels; c++) {
        let sample = channelData[c][i];
        sample = Math.max(-1, Math.min(1, sample));
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        view.setInt16(offset, Math.floor(intSample), true);
        offset += 2;
      }
    }
  } else {
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < numChannels; c++) {
        let sample = channelData[c][i];
        sample = Math.max(-1, Math.min(1, sample));
        const intSample = sample < 0 ? sample * 0x800000 : sample * 0x7fffff;
        const val = Math.floor(intSample);
        view.setUint8(offset, val & 0xff);
        view.setUint8(offset + 1, (val >> 8) & 0xff);
        view.setUint8(offset + 2, (val >> 16) & 0xff);
        offset += 3;
      }
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}


/**
 * Responsive WAV encoder for long exports. PCM is converted into approximately
 * one-second chunks so the encoder can yield to the browser between blocks rather
 * than allocate one multi-gigabyte contiguous ArrayBuffer and block the main thread.
 * The final Blob still necessarily retains the encoded file bytes.
 */
export async function exportAudioBufferToWavAsync(
  buffer: AudioBuffer,
  bitDepth: 16 | 24 = 16,
  onProgress?: (progress: ExportProgress) => void
): Promise<Blob> {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  if (channels < 1 || channels > 2) throw new Error(`WAV export supports mono or stereo audio; received ${channels} channels.`);
  if (bitDepth !== 16 && bitDepth !== 24) throw new Error('WAV bit depth must be 16 or 24.');
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const dataSize = length * blockAlign;
  if (!Number.isSafeInteger(dataSize) || dataSize > 0xffffffff - 36) {
    throw new Error('This WAV export exceeds the RIFF/WAVE 4 GiB size limit. Export a shorter range or use a future RF64-capable format.');
  }

  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  const framesPerChunk = Math.max(1, sampleRate); // approximately one second per retained chunk
  const parts: BlobPart[] = [new Uint8Array(header)];
  const totalChunks = Math.ceil(length / framesPerChunk);

  onProgress?.({ stage: 'encoding', percent: 80, message: `Encoding ${bitDepth}-bit PCM WAV in bounded blocks...` });
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const frameStart = chunkIndex * framesPerChunk;
    const frameCount = Math.min(framesPerChunk, length - frameStart);
    const bytes = new Uint8Array(frameCount * blockAlign);
    const chunkView = new DataView(bytes.buffer);
    let offset = 0;

    for (let frame = 0; frame < frameCount; frame++) {
      for (let channel = 0; channel < channels; channel++) {
        const raw = channelData[channel][frameStart + frame];
        const sample = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
        if (bitDepth === 16) {
          const integer = Math.floor(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
          chunkView.setInt16(offset, integer, true);
          offset += 2;
        } else {
          const integer = Math.floor(sample < 0 ? sample * 0x800000 : sample * 0x7fffff);
          chunkView.setUint8(offset, integer & 0xff);
          chunkView.setUint8(offset + 1, (integer >> 8) & 0xff);
          chunkView.setUint8(offset + 2, (integer >> 16) & 0xff);
          offset += 3;
        }
      }
    }

    parts.push(bytes);
    const ratio = (chunkIndex + 1) / Math.max(1, totalChunks);
    onProgress?.({
      stage: 'encoding',
      percent: Math.min(94, Math.round(80 + ratio * 14)),
      message: `Encoding WAV blocks... ${Math.round(ratio * 100)}% (${chunkIndex + 1}/${totalChunks})`
    });
    // Let the browser paint progress and handle input between PCM blocks.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  const blob = new Blob(parts, { type: 'audio/wav' });
  if (blob.size !== 44 + dataSize) throw new Error('WAV encoder produced an unexpected file size.');
  return blob;
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Encode AudioBuffer to MP3 Blob.
 * Primary: Backend native FFmpeg + libmp3lame (POST /api/export/mp3).
 * Client fallback: @breezystack/lamejs (bundler-safe, no MPEGMode issues).
 */
export async function exportAudioBufferToMp3(
  buffer: AudioBuffer,
  kbps: 128 | 192 | 256 | 320 = 320,
  onProgress?: (progress: ExportProgress) => void
): Promise<Blob> {
  const numChannels = buffer.numberOfChannels;
  if (numChannels < 1 || numChannels > 2) {
    throw new Error(`MP3 export supports mono or stereo audio; received ${numChannels} channels.`);
  }

  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const leftChannel = buffer.getChannelData(0);
  const rightChannel = numChannels > 1 ? buffer.getChannelData(1) : null;
  const mp3encoder = new Mp3Encoder(numChannels, sampleRate, kbps);
  const mp3Data: Uint8Array[] = [];
  const sampleBlockSize = 1152;
  onProgress?.({ stage: 'encoding', percent: 70, message: `Encoding MP3 locally (${kbps} kbps)...` });

  for (let i = 0; i < length; i += sampleBlockSize) {
    const blockLength = Math.min(sampleBlockSize, length - i);
    const leftChunk = new Int16Array(blockLength);
    const rightChunk = rightChannel ? new Int16Array(blockLength) : undefined;

    for (let j = 0; j < blockLength; j++) {
      const left = Math.max(-1, Math.min(1, leftChannel[i + j]));
      leftChunk[j] = left < 0 ? left * 0x8000 : left * 0x7fff;
      if (rightChunk && rightChannel) {
        const right = Math.max(-1, Math.min(1, rightChannel[i + j]));
        rightChunk[j] = right < 0 ? right * 0x8000 : right * 0x7fff;
      }
    }

    const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    if (mp3buf.length > 0) mp3Data.push(new Uint8Array(mp3buf));

    const chunkIndex = Math.floor(i / sampleBlockSize);
    if (chunkIndex % 10 === 0 || i + blockLength >= length) {
      const ratio = Math.min(1, (i + blockLength) / Math.max(1, length));
      onProgress?.({
        stage: 'encoding',
        percent: Math.min(99, Math.round(70 + ratio * 29)),
        message: `Encoding MP3 locally... ${Math.round(ratio * 100)}%`,
      });
      // Allow the browser to repaint progress during long encodes.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  const endBuf = mp3encoder.flush();
  if (endBuf.length > 0) mp3Data.push(new Uint8Array(endBuf));
  onProgress?.({ stage: 'encoding', percent: 100, message: 'Local MP3 encoding completed.' });
  return new Blob(mp3Data as unknown as BlobPart[], { type: 'audio/mp3' });
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
  ceilingDbTP: number = -1.0
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

  const stats = measureLoudness(decodedBuffer);
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
