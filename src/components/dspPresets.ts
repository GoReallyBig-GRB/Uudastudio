/**
 * Uuda Studio - factory presets for Compress, Denoise and Enhance. Each has at least four that differ clearly. The tests
 * check every value against the range its slider accepts.
 */
import type { CompressorParams } from '../types';

export interface CompressPreset { name: string; hint: string; params: CompressorParams }

export const COMPRESS_PRESETS: CompressPreset[] = [
  { name: 'Voice Leveling', hint: 'Evens out a talker who moves around the mic', params: { thresholdDb: -22, kneeDb: 8, ratio: 3, attackMs: 12, releaseMs: 160, makeupGainDb: 4 } },
  { name: 'Broadcast Punch', hint: 'Tight, forward and radio-loud', params: { thresholdDb: -18, kneeDb: 4, ratio: 5, attackMs: 6, releaseMs: 120, makeupGainDb: 5 } },
  { name: 'Gentle Glue', hint: 'Barely there: holds a voice together', params: { thresholdDb: -16, kneeDb: 12, ratio: 2, attackMs: 25, releaseMs: 250, makeupGainDb: 2 } },
  { name: 'Tame Loud Parts', hint: 'Catches shouts and laughs before they peak', params: { thresholdDb: -26, kneeDb: 6, ratio: 8, attackMs: 3, releaseMs: 90, makeupGainDb: 6 } },
  { name: 'Smooth Narration', hint: 'Audiobook feel: even and unhurried', params: { thresholdDb: -24, kneeDb: 10, ratio: 3.5, attackMs: 18, releaseMs: 220, makeupGainDb: 4 } },
];

export interface DenoisePreset {
  name: string;
  hint: string;
  /** Used with a noise sample */
  reductionDb: number;
  sensitivity: number;
  voiceProtection: number;
  /** dB above the noise floor below which the gaps between phrases are closed (0 = off) */
  gapCleanupDb: number;
  /** Rumble cut, Hz */
  highPassFreq: number;
  /** Used when there is no noise sample (the basic gate) */
  noiseFloorThresholdDb: number;
}

export const DENOISE_PRESETS: DenoisePreset[] = [
  { name: 'Steady Hiss & Hum', hint: 'Only the constant noise; gaps left alone', reductionDb: 14, sensitivity: 1.5, voiceProtection: 0.5, gapCleanupDb: 0, highPassFreq: 70, noiseFloorThresholdDb: -45 },
  { name: 'Podcast Clean-up', hint: 'Noise plus quiet gaps between phrases', reductionDb: 16, sensitivity: 1.6, voiceProtection: 0.5, gapCleanupDb: 24, highPassFreq: 80, noiseFloorThresholdDb: -38 },
  { name: 'Street & Pump Removal', hint: 'Strong: passing traffic, mic pump, breaths in pauses', reductionDb: 20, sensitivity: 2, voiceProtection: 0.6, gapCleanupDb: 30, highPassFreq: 100, noiseFloorThresholdDb: -34 },
  { name: 'Gentle, Voice First', hint: 'Light touch, keeps soft word endings', reductionDb: 10, sensitivity: 1.2, voiceProtection: 0.8, gapCleanupDb: 16, highPassFreq: 70, noiseFloorThresholdDb: -48 },
];

export interface EnhancePreset { name: string; hint: string; strength: number }

export const ENHANCE_PRESETS: EnhancePreset[] = [
  { name: 'Light Polish', hint: 'Small clean-up, stays natural', strength: 30 },
  { name: 'Balanced', hint: 'The default: clean, even and clear', strength: 60 },
  { name: 'Strong Fix', hint: 'For a poor mic or a boomy room', strength: 80 },
  { name: 'Maximum', hint: 'Everything on full: rescue work', strength: 100 },
];
