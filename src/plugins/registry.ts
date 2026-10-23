/**
 * Uuda Studio - Plugin Registry & Security Whitelist
 * Registry of verified Native Stems and third-party Web Audio Modules (WAM 2.0).
 * Implements origin whitelisting, verification badges, and token isolation.
 */

import { PluginDescriptor } from './types';
import { COMPRESSOR_DESCRIPTOR } from './native/CompressorPlugin';
import { DENOISER_DESCRIPTOR } from './native/DenoiserPlugin';
import { EQ_DESCRIPTOR } from './native/FourBandEqPlugin';
import { PITCH_TIME_DESCRIPTOR } from './native/PitchTimePlugin';
import { REVERB_DESCRIPTOR } from './native/ReverbPlugin';
import { AUTO_PAN_DESCRIPTOR } from './native/AutoPanPlugin';
import { CHORUS_DESCRIPTOR } from './native/ChorusPlugin';
import { DE_ESSER_DESCRIPTOR } from './native/DeEsserPlugin';
import { DELAY_DESCRIPTOR } from './native/DelayPlugin';
import { FLANGER_DESCRIPTOR } from './native/FlangerPlugin';
import { GAIN_PAN_DESCRIPTOR } from './native/GainPanPlugin';
import { LIMITER_DESCRIPTOR } from './native/LimiterPlugin';
import { MULTIMODE_FILTER_DESCRIPTOR } from './native/MultimodeFilterPlugin';
import { NOISE_GATE_DESCRIPTOR } from './native/NoiseGatePlugin';
import { PARAMETRIC_EQ_DESCRIPTOR } from './native/ParametricEqPlugin';
import { PHASER_DESCRIPTOR } from './native/PhaserPlugin';
import { SATURATOR_DESCRIPTOR } from './native/SaturatorPlugin';
import { STEREO_WIDENER_DESCRIPTOR } from './native/StereoWidenerPlugin';
import { VOICE_ENHANCER_DESCRIPTOR } from './native/VoiceEnhancerPlugin';

// 1. Native Stems (Built-in DSP Plugins). Every entry needs a factory in nativeFactories.ts (a test checks this).
export const NATIVE_STEM_PLUGINS: PluginDescriptor[] = [
  // Dynamics
  COMPRESSOR_DESCRIPTOR,
  DE_ESSER_DESCRIPTOR,
  NOISE_GATE_DESCRIPTOR,
  LIMITER_DESCRIPTOR,
  // EQ and filters
  EQ_DESCRIPTOR,
  PARAMETRIC_EQ_DESCRIPTOR,
  MULTIMODE_FILTER_DESCRIPTOR,
  // Spatial
  REVERB_DESCRIPTOR,
  DELAY_DESCRIPTOR,
  // Modulation
  CHORUS_DESCRIPTOR,
  FLANGER_DESCRIPTOR,
  PHASER_DESCRIPTOR,
  AUTO_PAN_DESCRIPTOR,
  // Restoration and pitch
  DENOISER_DESCRIPTOR,
  PITCH_TIME_DESCRIPTOR,
  // Utility
  VOICE_ENHANCER_DESCRIPTOR,
  SATURATOR_DESCRIPTOR,
  STEREO_WIDENER_DESCRIPTOR,
  GAIN_PAN_DESCRIPTOR,
];

// 2. Verified Third-Party Web Audio Modules (WAM 2.0)
// Curated list of tested, secure WAM 2.0 modules from recognized audio developers
export const VERIFIED_THIRD_PARTY_PLUGINS: PluginDescriptor[] = [
  {
    id: 'wam-pingpong-delay',
    name: 'WAM Ping-Pong Stereo Delay',
    vendor: 'WebAudioModules Community',
    version: '2.0.1',
    type: 'third-party-wam',
    category: 'spatial',
    description: 'Tempo-synced stereo ping-pong bounce delay with high-damping tape filters.',
    hasCustomGui: true,
    verified: true,
    moduleUrl: 'https://webaudiomodules.org/community/plugins/pingpong-delay/index.js',
    parameters: {
      feedback: { min: 0, max: 0.95, defaultValue: 0.45, step: 0.01, unit: '%', label: 'Feedback' },
      delayTimeLeft: { min: 0.01, max: 1.0, defaultValue: 0.25, step: 0.01, unit: 's', label: 'Time L' },
      delayTimeRight: { min: 0.01, max: 1.0, defaultValue: 0.375, step: 0.01, unit: 's', label: 'Time R' },
      damping: { min: 500, max: 12000, defaultValue: 4500, step: 100, unit: 'Hz', label: 'Damp Freq' },
      stereoSpread: { min: 0, max: 1.0, defaultValue: 0.8, step: 0.05, unit: '%', label: 'Stereo Width' },
      dryWet: { min: 0, max: 1.0, defaultValue: 0.35, step: 0.01, unit: '%', label: 'Mix' },
    },
  },
  {
    id: 'wam-quadrafuzz',
    name: 'WAM QuadraFuzz Multiband Distortion',
    vendor: 'Craig Anderton & WAM Team',
    version: '2.1.0',
    type: 'third-party-wam',
    category: 'dynamics',
    description: 'Legendary 4-band analog tube overdrive, warmth saturator, and fuzz exciter.',
    hasCustomGui: true,
    verified: true,
    moduleUrl: 'https://webaudiomodules.org/community/plugins/quadrafuzz/index.js',
    parameters: {
      lowDrive: { min: 0, max: 10, defaultValue: 2.0, step: 0.1, unit: 'x', label: 'Low Drive' },
      midLowDrive: { min: 0, max: 10, defaultValue: 3.5, step: 0.1, unit: 'x', label: 'Mid-Low Drive' },
      midHighDrive: { min: 0, max: 10, defaultValue: 4.0, step: 0.1, unit: 'x', label: 'Mid-High Drive' },
      highDrive: { min: 0, max: 10, defaultValue: 2.5, step: 0.1, unit: 'x', label: 'High Drive' },
      outputLevel: { min: -12, max: 12, defaultValue: 0, step: 0.5, unit: 'dB', label: 'Master Out' },
      dryWet: { min: 0, max: 1.0, defaultValue: 0.5, step: 0.01, unit: '%', label: 'Mix' },
    },
  },
  {
    id: 'wam-state-filter',
    name: 'WAM Resonant State Variable Filter',
    vendor: 'Stéphane Letz (Inria / Grame)',
    version: '2.0.0',
    type: 'third-party-wam',
    category: 'eq',
    description: 'Analog-modeled 12dB/octave multi-mode filter with liquid resonance and envelope follower.',
    hasCustomGui: true,
    verified: true,
    moduleUrl: 'https://webaudiomodules.org/community/plugins/simple-filter/index.js',
    parameters: {
      cutoff: { min: 20, max: 18000, defaultValue: 1200, step: 10, unit: 'Hz', label: 'Cutoff Freq' },
      resonance: { min: 0.5, max: 20, defaultValue: 2.5, step: 0.1, unit: 'Q', label: 'Resonance' },
      filterMode: { min: 0, max: 3, defaultValue: 0, step: 1, unit: '', label: 'Mode (LP/HP/BP)' },
      drive: { min: 0, max: 24, defaultValue: 0, step: 0.5, unit: 'dB', label: 'Input Saturation' },
      dryWet: { min: 0, max: 1.0, defaultValue: 1.0, step: 0.01, unit: '%', label: 'Filter Mix' },
    },
  },
  {
    id: 'wam-stereo-chorus',
    name: 'WAM Dimension Stereo Chorus',
    vendor: 'Burnson Audio WAM Lab',
    version: '1.4.2',
    type: 'third-party-wam',
    category: 'modulation',
    description: 'Thick vintage multi-voice bucket-brigade chorus with stereo cross-panning.',
    hasCustomGui: true,
    verified: true,
    moduleUrl: 'https://webaudiomodules.org/community/plugins/stereo-chorus/index.js',
    parameters: {
      rate: { min: 0.1, max: 6.0, defaultValue: 0.8, step: 0.05, unit: 'Hz', label: 'Mod Rate' },
      depth: { min: 0, max: 1.0, defaultValue: 0.65, step: 0.01, unit: '%', label: 'Mod Depth' },
      delay: { min: 2, max: 25, defaultValue: 12, step: 0.5, unit: 'ms', label: 'BBD Delay' },
      feedback: { min: 0, max: 0.75, defaultValue: 0.25, step: 0.01, unit: '%', label: 'Feedback' },
      dryWet: { min: 0, max: 1.0, defaultValue: 0.5, step: 0.01, unit: '%', label: 'Chorus Mix' },
    },
  },
  {
    id: 'wam-graphic-eq',
    name: 'WAM 10-Band Broadcast Console EQ',
    vendor: 'WebAudioModules Community',
    version: '2.0.0',
    type: 'third-party-wam',
    category: 'eq',
    description: 'ISO 1-octave graphic equalizer with +/-12dB constant-Q sliders.',
    hasCustomGui: true,
    verified: true,
    moduleUrl: 'https://webaudiomodules.org/community/plugins/graphic-eq/index.js',
    parameters: {
      band31: { min: -12, max: 12, defaultValue: 0, step: 0.5, unit: 'dB', label: '31 Hz' },
      band63: { min: -12, max: 12, defaultValue: 0, step: 0.5, unit: 'dB', label: '63 Hz' },
      band125: { min: -12, max: 12, defaultValue: 0, step: 0.5, unit: 'dB', label: '125 Hz' },
      band250: { min: -12, max: 12, defaultValue: 0, step: 0.5, unit: 'dB', label: '250 Hz' },
      band500: { min: -12, max: 12, defaultValue: 0, step: 0.5, unit: 'dB', label: '500 Hz' },
      band1k: { min: -12, max: 12, defaultValue: 0, step: 0.5, unit: 'dB', label: '1 kHz' },
      band2k: { min: -12, max: 12, defaultValue: 1.0, step: 0.5, unit: 'dB', label: '2 kHz' },
      band4k: { min: -12, max: 12, defaultValue: 1.5, step: 0.5, unit: 'dB', label: '4 kHz' },
      band8k: { min: -12, max: 12, defaultValue: 1.0, step: 0.5, unit: 'dB', label: '8 kHz' },
      band16k: { min: -12, max: 12, defaultValue: 0, step: 0.5, unit: 'dB', label: '16 kHz' },
      dryWet: { min: 0, max: 1.0, defaultValue: 1.0, step: 0.01, unit: '%', label: 'EQ Mix' },
    },
  },
];

// Approved Origin Domains for Content Security Policy compliance
// SECURITY TODO (release blocker for third-party plugins): trusting whole hosts is unsafe, because anyone can publish
// to these. Replace with a hash-pinned, admin-approved catalogue. See docs/PLUGIN-HARDENING.md (PRD PL-3).
export const APPROVED_WAM_ORIGINS = [
  'https://webaudiomodules.org',
  'https://cdn.jsdelivr.net',
  'https://unpkg.com',
  'https://esm.sh',
  'https://raw.githubusercontent.com',
];

/**
 * Checks if a given module URL originates from an admin-approved, verified host
 */
export function isVerifiedWamUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return APPROVED_WAM_ORIGINS.some((origin) => {
      const allowedOrigin = new URL(origin).origin;
      return parsed.origin === allowedOrigin;
    });
  } catch {
    return false;
  }
}

export const isModuleOriginWhitelisted = isVerifiedWamUrl;

/**
 * Registry Lookup by Plugin ID
 */
export function findPluginDescriptor(pluginId: string): PluginDescriptor | undefined {
  const native = NATIVE_STEM_PLUGINS.find((p) => p.id === pluginId);
  if (native) return native;
  return VERIFIED_THIRD_PARTY_PLUGINS.find((p) => p.id === pluginId);
}
