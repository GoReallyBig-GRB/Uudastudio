/**
 * Uuda Studio - the built-in starter templates: podcast, 30-second spot, station sweep.
 * Each is plain template data, so it goes through the same code as a template loaded from a file.
 * Plugin settings come from the plugins' own factory presets by name (a test checks every name exists).
 */

import { findPluginDescriptor } from '../plugins/registry';
import { getPluginPresets } from '../plugins/presets';
import { StoredPluginState } from '../plugins/types';
import { DEFAULT_DUCKING } from '../audio/ducking';
import { TEMPLATE_FORMAT, TEMPLATE_VERSION, TemplateDucking, TemplateTrack, UudaTemplate } from './template';

/** A plugin slot set to one of its factory presets */
function slot(pluginId: string, presetName: string, index: number): StoredPluginState {
  const descriptor = findPluginDescriptor(pluginId);
  if (!descriptor) throw new Error(`Built-in template names an unknown plugin: ${pluginId}`);
  const preset = getPluginPresets(descriptor).find((p) => p.name === presetName);
  if (!preset) throw new Error(`Built-in template names an unknown preset: ${pluginId} / ${presetName}`);
  const { dryWet = 1, ...parameters } = preset.params;
  return {
    instanceId: `starter-${pluginId}-${index}`,
    pluginId,
    isBypassed: false,
    dryWet,
    parameters: { ...parameters, ...(descriptor.parameters.dryWet ? { dryWet } : {}) },
    customState: { ...parameters },
  };
}

interface VoiceKit {
  enhancer: string;
  compressor: string;
  deesser: string;
}

function voiceChain(kit: VoiceKit): StoredPluginState[] {
  return [
    slot('uuda-native-voice-enhancer', kit.enhancer, 0),
    slot('uuda-native-compressor', kit.compressor, 1),
    slot('uuda-native-deesser', kit.deesser, 2),
  ];
}

function duck(sourceTrackIndexes: number[], over: Partial<TemplateDucking>): TemplateDucking {
  const { sourceTrackIds: _s, ...base } = DEFAULT_DUCKING;
  return { ...base, enabled: true, sourceTrackIndexes, ...over };
}

function voice(name: string, kit: VoiceKit): TemplateTrack {
  return { name, customName: true, role: 'voice', volume: 1, pan: 0, plugins: voiceChain(kit) };
}

const CREATED = Date.UTC(2026, 9, 23);

export const BUILT_IN_TEMPLATES: UudaTemplate[] = [
  {
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    id: 'starter-podcast',
    name: 'Podcast interview',
    description: 'Host and guest with voice processing, a music bed that ducks under both, and a sound effects track.',
    tags: ['podcast', 'interview'],
    builtIn: true,
    createdAt: CREATED,
    tracks: [
      voice('Host', { enhancer: 'Warm Narration', compressor: 'Tight Podcast', deesser: 'Male Voice' }),
      voice('Guest', { enhancer: 'Broadcast Voice', compressor: 'Tight Podcast', deesser: 'Gentle' }),
      {
        name: 'Music bed',
        customName: true,
        role: 'music',
        volume: 0.6,
        pan: 0,
        ducking: duck([0, 1], { thresholdDb: -42, amountDb: -14, attackMs: 80, holdMs: 300, releaseMs: 700 }),
      },
      { name: 'Sound effects', customName: true, role: 'sfx', volume: 0.9, pan: 0 },
    ],
  },
  {
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    id: 'starter-spot-30',
    name: '30-second spot',
    description: 'One voice with broadcast punch, a music bed that ducks under it, and a sound effects track.',
    tags: ['advert', 'spot', '30s'],
    builtIn: true,
    createdAt: CREATED,
    tracks: [
      voice('Voice', { enhancer: 'Broadcast Voice', compressor: 'Broadcast Punch', deesser: 'Gentle' }),
      {
        name: 'Music bed',
        customName: true,
        role: 'music',
        volume: 0.7,
        pan: 0,
        ducking: duck([0], { thresholdDb: -40, amountDb: -12, attackMs: 60, holdMs: 200, releaseMs: 500 }),
      },
      { name: 'Sound effects', customName: true, role: 'sfx', volume: 0.9, pan: 0 },
    ],
  },
  {
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    id: 'starter-station-sweep',
    name: 'Station sweep',
    description: 'A bright, punchy voice over a quick-ducking music bed, plus a stinger track for the sweep itself.',
    tags: ['radio', 'imaging', 'sweep'],
    builtIn: true,
    createdAt: CREATED,
    tracks: [
      voice('Voice', { enhancer: 'Bright and Airy', compressor: 'Broadcast Punch', deesser: 'Strong' }),
      {
        name: 'Music bed',
        customName: true,
        role: 'music',
        volume: 0.75,
        pan: 0,
        ducking: duck([0], { thresholdDb: -38, amountDb: -10, attackMs: 40, holdMs: 120, releaseMs: 300 }),
      },
      { name: 'Stinger', customName: true, role: 'sfx', volume: 1, pan: 0 },
    ],
  },
];
