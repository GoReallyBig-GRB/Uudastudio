/**
 * Uuda Studio - Native plugin factories
 * One place that knows how to build every native plugin. A native plugin id with no factory is an error,
 * never a silent substitute.
 */

import { PluginInstance } from './types';
import { NativeCompressorPlugin } from './native/CompressorPlugin';
import { NativeDenoiserPlugin } from './native/DenoiserPlugin';
import { NativeFourBandEqPlugin } from './native/FourBandEqPlugin';
import { NativePitchTimePlugin } from './native/PitchTimePlugin';
import { NativeReverbPlugin } from './native/ReverbPlugin';
import { NativeAutoPanPlugin } from './native/AutoPanPlugin';
import { NativeChorusPlugin } from './native/ChorusPlugin';
import { NativeDeEsserPlugin } from './native/DeEsserPlugin';
import { NativeDelayPlugin } from './native/DelayPlugin';
import { NativeFlangerPlugin } from './native/FlangerPlugin';
import { NativeGainPanPlugin } from './native/GainPanPlugin';
import { NativeLimiterPlugin } from './native/LimiterPlugin';
import { NativeMultimodeFilterPlugin } from './native/MultimodeFilterPlugin';
import { NativeNoiseGatePlugin } from './native/NoiseGatePlugin';
import { NativeParametricEqPlugin } from './native/ParametricEqPlugin';
import { NativePhaserPlugin } from './native/PhaserPlugin';
import { NativeSaturatorPlugin } from './native/SaturatorPlugin';
import { NativeStereoWidenerPlugin } from './native/StereoWidenerPlugin';
import { NativeVoiceEnhancerPlugin } from './native/VoiceEnhancerPlugin';

export type NativeFactory = (
  audioCtx: BaseAudioContext,
  trackId: string,
  initialState?: Record<string, unknown>
) => Promise<PluginInstance>;

export const NATIVE_FACTORIES: Record<string, NativeFactory> = {
  'uuda-native-compressor': NativeCompressorPlugin.createInstance,
  'uuda-native-denoiser': NativeDenoiserPlugin.createInstance,
  'uuda-native-eq': NativeFourBandEqPlugin.createInstance,
  'uuda-native-pitch-time': NativePitchTimePlugin.createInstance,
  'uuda-native-reverb': NativeReverbPlugin.createInstance,
  'uuda-native-autopan': NativeAutoPanPlugin.createInstance,
  'uuda-native-chorus': NativeChorusPlugin.createInstance,
  'uuda-native-deesser': NativeDeEsserPlugin.createInstance,
  'uuda-native-delay': NativeDelayPlugin.createInstance,
  'uuda-native-flanger': NativeFlangerPlugin.createInstance,
  'uuda-native-gain-pan': NativeGainPanPlugin.createInstance,
  'uuda-native-limiter': NativeLimiterPlugin.createInstance,
  'uuda-native-filter': NativeMultimodeFilterPlugin.createInstance,
  'uuda-native-gate': NativeNoiseGatePlugin.createInstance,
  'uuda-native-param-eq': NativeParametricEqPlugin.createInstance,
  'uuda-native-phaser': NativePhaserPlugin.createInstance,
  'uuda-native-saturator': NativeSaturatorPlugin.createInstance,
  'uuda-native-widener': NativeStereoWidenerPlugin.createInstance,
  'uuda-native-voice-enhancer': NativeVoiceEnhancerPlugin.createInstance,
};

export async function createNativePlugin(
  id: string,
  audioCtx: BaseAudioContext,
  trackId: string,
  initialState?: Record<string, unknown>
): Promise<PluginInstance> {
  const factory = NATIVE_FACTORIES[id];
  if (!factory) throw new Error(`Unknown native plugin: ${id}`);
  return await factory(audioCtx, trackId, initialState);
}
