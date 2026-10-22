/**
 * Uuda Studio - Native plugin factory presets and parameter display helpers.
 *
 * Every plugin gets a "Default" preset built from its descriptor, plus the factory presets below.
 * A preset only lists the parameters it changes; anything missing keeps the descriptor default.
 * The plugin tests check that every preset id and value matches the plugin's real parameters and ranges.
 */

import { PluginDescriptor } from './types';

export interface PluginPreset {
  id: string;
  name: string;
  params: Record<string, number>;
}

type Factory = Record<string, Array<[name: string, params: Record<string, number>]>>;

const FACTORY: Factory = {
  'uuda-native-compressor': [
    ['Gentle Voice Leveling', { threshold: -20, ratio: 2.5, knee: 10, attack: 15, release: 200, makeupGain: 2, dryWet: 1 }],
    ['Broadcast Punch', { threshold: -22, ratio: 4, knee: 6, attack: 8, release: 120, makeupGain: 4, dryWet: 1 }],
    ['Tight Podcast', { threshold: -26, ratio: 6, knee: 4, attack: 5, release: 100, makeupGain: 5, dryWet: 1 }],
    ['Light Glue', { threshold: -14, ratio: 1.8, knee: 14, attack: 30, release: 250, makeupGain: 1, dryWet: 1 }],
    ['Parallel Smash', { threshold: -34, ratio: 10, knee: 6, attack: 3, release: 90, makeupGain: 8, dryWet: 0.4 }],
  ],
  'uuda-native-denoiser': [
    ['Light Clean', { highPassFreq: 70, threshold: -42, reduction: 9, attack: 10, release: 150, dryWet: 1 }],
    ['Room Noise Fix', { highPassFreq: 90, threshold: -34, reduction: 18, attack: 6, release: 120, dryWet: 1 }],
    ['Heavy Restoration', { highPassFreq: 110, threshold: -30, reduction: 26, attack: 5, release: 100, dryWet: 1 }],
    ['Gentle Blend', { highPassFreq: 80, threshold: -36, reduction: 15, attack: 8, release: 120, dryWet: 0.6 }],
  ],
  'uuda-native-eq': [
    ['Vocal Presence', { lowShelfGain: -2, mid1Gain: -2, mid1Freq: 300, mid2Gain: 3, mid2Freq: 3000, highShelfGain: 2 }],
    ['Warm Radio', { lowShelfGain: 3, mid1Gain: 1, mid1Freq: 400, mid2Gain: 1.5, mid2Freq: 2200, highShelfGain: -1 }],
    ['Podcast Clarity', { lowShelfGain: -3, mid1Gain: -2, mid1Freq: 250, mid2Gain: 2.5, mid2Freq: 2800, highShelfGain: 1.5 }],
    ['Bright Air', { lowShelfGain: 0, mid1Gain: 0, mid2Gain: 1, mid2Freq: 3500, highShelfGain: 4 }],
  ],
  'uuda-native-pitch-time': [
    ['Deeper Voice', { semitones: -3, fineTune: 0, playbackRate: 1, formantPreserve: 1, dryWet: 1 }],
    ['Brighter Voice', { semitones: 2, fineTune: 0, playbackRate: 1, formantPreserve: 1, dryWet: 1 }],
    ['Giant', { semitones: -8, fineTune: 0, playbackRate: 1, formantPreserve: 0.3, dryWet: 1 }],
    ['Chipmunk', { semitones: 9, fineTune: 0, playbackRate: 1, formantPreserve: 0, dryWet: 1 }],
    ['Tape Slow', { semitones: 0, fineTune: 0, playbackRate: 0.8, formantPreserve: 0, dryWet: 1 }],
  ],
  'uuda-native-reverb': [
    ['Studio Vocal Plate', { decayTime: 2.2, preDelay: 25, damping: 6500, roomSize: 1, dryWet: 0.35 }],
    ['Tight Booth', { decayTime: 0.5, preDelay: 3, damping: 7000, roomSize: 0.3, dryWet: 0.15 }],
    ['Small Room', { decayTime: 1, preDelay: 8, damping: 5500, roomSize: 0.6, dryWet: 0.2 }],
    ['Warm Hall', { decayTime: 3.8, preDelay: 35, damping: 5000, roomSize: 1.3, dryWet: 0.3 }],
    ['Cathedral', { decayTime: 7, preDelay: 60, damping: 4000, roomSize: 1.5, dryWet: 0.4 }],
  ],
  'uuda-native-autopan': [
    ['Slow Sweep', { rateHz: 0.4, depth: 60, mode: 0, shape: 0 }],
    ['Optical Tremolo', { rateHz: 5, depth: 55, mode: 1, shape: 0 }],
    ['Choppy Gate', { rateHz: 4, depth: 100, mode: 1, shape: 2 }],
    ['Wide Pan', { rateHz: 1, depth: 90, mode: 0, shape: 1 }],
  ],
  'uuda-native-chorus': [
    ['Subtle Thicken', { rateHz: 0.8, depthMs: 3, voices: 2, dryWet: 0.3 }],
    ['Lush Ensemble', { rateHz: 1.2, depthMs: 8, voices: 5, dryWet: 0.5 }],
    ['Wide Vocal Double', { rateHz: 0.6, depthMs: 12, voices: 4, dryWet: 0.4 }],
  ],
  'uuda-native-deesser': [
    ['Gentle', { frequency: 7000, threshold: -20, reduction: 5, listenSibilance: 0 }],
    ['Strong', { frequency: 6000, threshold: -30, reduction: 14, listenSibilance: 0 }],
    ['Male Voice', { frequency: 5500, threshold: -26, reduction: 8, listenSibilance: 0 }],
    ['Female Voice', { frequency: 7500, threshold: -26, reduction: 9, listenSibilance: 0 }],
  ],
  'uuda-native-delay': [
    ['Slapback', { timeMs: 110, feedback: 0.12, lowCutHz: 150, highCutHz: 6000, pingPong: 0, dryWet: 0.22 }],
    ['Ping-Pong Echo', { timeMs: 380, feedback: 0.5, lowCutHz: 120, highCutHz: 7000, pingPong: 1, dryWet: 0.3 }],
    ['Dub Echo', { timeMs: 500, feedback: 0.7, lowCutHz: 200, highCutHz: 4500, pingPong: 1, dryWet: 0.35 }],
    ['Short Doubler', { timeMs: 50, feedback: 0, lowCutHz: 100, highCutHz: 9000, pingPong: 0, dryWet: 0.3 }],
  ],
  'uuda-native-flanger': [
    ['Soft Jet', { rateHz: 0.2, depthMs: 2.5, delayMs: 3, feedback: 0.5, dryWet: 0.4 }],
    ['Metallic Sweep', { rateHz: 0.8, depthMs: 3.5, delayMs: 1.5, feedback: 0.8, dryWet: 0.55 }],
    ['Subtle Movement', { rateHz: 0.3, depthMs: 1, delayMs: 3, feedback: 0.3, dryWet: 0.3 }],
  ],
  'uuda-native-gain-pan': [
    ['Trim -6 dB', { gainDb: -6, pan: 0 }],
    ['Lift +6 dB', { gainDb: 6, pan: 0 }],
    ['Pan Left', { gainDb: 0, pan: -0.3 }],
    ['Pan Right', { gainDb: 0, pan: 0.3 }],
  ],
  'uuda-native-limiter': [
    ['Broadcast Safe', { ceiling: -1, inputGain: 3, release: 60 }],
    ['Loud Master', { ceiling: -0.5, inputGain: 8, release: 40 }],
    ['Transparent', { ceiling: -1.5, inputGain: 2, release: 100 }],
    ['Streaming Safe', { ceiling: -2, inputGain: 4, release: 80 }],
  ],
  'uuda-native-filter': [
    ['Rumble Cut', { filterType: 1, cutoffHz: 80, resonance: 0.7, slopeDb: 24, lfoRateHz: 0, lfoDepth: 0, outputTrim: 0, dryWet: 1 }],
    ['Telephone', { filterType: 2, cutoffHz: 1800, resonance: 2.5, slopeDb: 24, lfoRateHz: 0, lfoDepth: 0, outputTrim: 0, dryWet: 1 }],
    ['Behind a Wall', { filterType: 0, cutoffHz: 900, resonance: 0.8, slopeDb: 24, lfoRateHz: 0, lfoDepth: 0, outputTrim: 0, dryWet: 1 }],
    ['Auto-Wah', { filterType: 2, cutoffHz: 1200, resonance: 6, slopeDb: 12, lfoRateHz: 0.8, lfoDepth: 70, outputTrim: 0, dryWet: 1 }],
  ],
  'uuda-native-gate': [
    ['Light', { threshold: -48, attack: 3, hold: 60, release: 150, range: 24 }],
    ['Speech', { threshold: -40, attack: 2, hold: 50, release: 120, range: 40 }],
    ['Tight', { threshold: -36, attack: 1, hold: 30, release: 80, range: 60 }],
  ],
  'uuda-native-param-eq': [
    ['Voice Clarity', { lowGain: -3, lowMidGain: -2, midGain: 0, highMidGain: 3, highGain: 2, midQ: 1.2, outputTrim: 0 }],
    ['Warmth', { lowGain: 3, lowMidGain: 1, midGain: 0, highMidGain: -1, highGain: -2, midQ: 1.2, outputTrim: 0 }],
    ['Smile Curve', { lowGain: 3, lowMidGain: -1, midGain: -2, highMidGain: 1, highGain: 3, midQ: 1.2, outputTrim: 0 }],
    ['De-Mud', { lowGain: 0, lowMidGain: -4, midGain: 0, highMidGain: 1, highGain: 0, midQ: 1.2, outputTrim: 0 }],
  ],
  'uuda-native-phaser': [
    ['Slow Swirl', { rateHz: 0.2, depth: 0.8, centerFreqHz: 900, stages: 8, feedback: 0.5, dryWet: 0.5 }],
    ['Fast Jet', { rateHz: 2, depth: 0.9, centerFreqHz: 1800, stages: 6, feedback: 0.6, dryWet: 0.55 }],
    ['Subtle', { rateHz: 0.35, depth: 0.4, centerFreqHz: 1000, stages: 4, feedback: 0.2, dryWet: 0.3 }],
  ],
  'uuda-native-saturator': [
    ['Subtle Warmth', { drive: 2, tone: 8000, outputTrim: -1, dryWet: 0.5 }],
    ['Warm Tape', { drive: 3, tone: 5000, outputTrim: -2, dryWet: 0.7 }],
    ['Tube Glow', { drive: 6, tone: 7000, outputTrim: -4, dryWet: 0.6 }],
    ['Hard Drive', { drive: 14, tone: 4500, outputTrim: -8, dryWet: 0.8 }],
  ],
  'uuda-native-widener': [
    ['Mono', { width: 0, monoBelowHz: 120 }],
    ['Natural', { width: 100, monoBelowHz: 120 }],
    ['Wide', { width: 160, monoBelowHz: 150 }],
    ['Ultra Wide', { width: 190, monoBelowHz: 200 }],
  ],
  'uuda-native-voice-enhancer': [
    ['Broadcast Voice', { amount: 0.8, warmth: 0.6, clarity: 0.7, air: 0.3, excite: 0.3, lowCut: 80, outputTrim: -1, dryWet: 1 }],
    ['Warm Narration', { amount: 0.75, warmth: 0.8, clarity: 0.4, air: 0.3, excite: 0.2, lowCut: 60, outputTrim: -1, dryWet: 1 }],
    ['Bright and Airy', { amount: 0.7, warmth: 0.3, clarity: 0.7, air: 0.8, excite: 0.4, lowCut: 70, outputTrim: -2, dryWet: 1 }],
    ['Gentle Lift', { amount: 0.4, warmth: 0.4, clarity: 0.4, air: 0.3, excite: 0.1, lowCut: 60, outputTrim: 0, dryWet: 0.8 }],
  ],
};

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Descriptor defaults as a parameter map */
export function defaultParams(descriptor: PluginDescriptor): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, def] of Object.entries(descriptor.parameters)) out[id] = def.defaultValue;
  return out;
}

/** "Default" first, then the factory presets for this plugin. Presets are complete: missing values fall back to defaults. */
export function getPluginPresets(descriptor: PluginDescriptor): PluginPreset[] {
  const base = defaultParams(descriptor);
  const list: PluginPreset[] = [{ id: 'default', name: 'Default', params: base }];
  for (const [name, params] of FACTORY[descriptor.id] || []) {
    list.push({ id: slug(name), name, params: { ...base, ...params } });
  }
  return list;
}

/** Raw factory table, used by the tests to validate ids and ranges */
export const FACTORY_PRESET_TABLE = FACTORY;

// ---------------------------------------------------------------------------
// Parameter display
// ---------------------------------------------------------------------------

/** Named values for stepped parameters, keyed by parameter id */
const VALUE_NAMES: Record<string, string[]> = {
  filterType: ['Low-pass', 'High-pass', 'Band-pass', 'Notch', 'Low shelf', 'High shelf'],
  mode: ['Pan', 'Tremolo'],
  shape: ['Sine', 'Triangle', 'Square'],
  pingPong: ['Off', 'On'],
  listenSibilance: ['Off', 'On'],
};

/** Short labels where the descriptor label is long or explains the numbers inline */
const SHORT_LABELS: Record<string, string> = {
  filterType: 'Type',
  mode: 'Mode',
  shape: 'Wave',
  slopeDb: 'Slope',
  lfoRateHz: 'LFO Rate',
  amount: 'Amount',
};

export function paramLabel(id: string, label?: string, name?: string): string {
  if (SHORT_LABELS[id]) return SHORT_LABELS[id];
  const raw = label || name || id;
  // Drop explanatory brackets such as "(0=Pan, 1=Trem)" but keep ones that carry a frequency, e.g. "(80Hz)"
  return raw.replace(/\s*\([^)]*[=,][^)]*\)/g, '').trim();
}

export function formatParamValue(
  id: string,
  value: number,
  def: { min: number; max: number; unit?: string }
): string {
  const names = VALUE_NAMES[id];
  if (names) return names[Math.round(value)] ?? String(value);
  const unit = def.unit || '';
  // 0..1 values shown as percent
  if (unit === '%' && def.max <= 1) return `${Math.round(value * 100)}%`;
  if (unit === 'bool') return value >= 0.5 ? 'On' : 'Off';
  const decimals = Math.abs(value) < 10 && !Number.isInteger(value) ? 2 : Number.isInteger(value) ? 0 : 1;
  const text = Number(value.toFixed(decimals)).toString();
  const tidy = unit === 'mode' || unit === 'type' ? '' : unit;
  return `${text}${tidy.startsWith(' ') || tidy === '' || tidy.startsWith(':') || tidy === 'x' || tidy === '%' ? '' : ' '}${tidy}`;
}
