/**
 * X-PRO AUDIO - Native Brickwall Peak Limiter Plugin
 * Precision broadcast limiter with fast lookahead-style peak catching and ceiling safety.
 */

import { PluginDescriptor, PluginInstance } from '../types';
import { makeNativeInstance } from './instance';

export const LIMITER_DESCRIPTOR: PluginDescriptor = {
  id: 'uuda-native-limiter',
  name: 'Broadcast Peak Limiter',
  vendor: 'Uuda Audio DSP',
  version: '1.2.0',
  type: 'native',
  category: 'dynamics',
  description: 'True peak ceiling brickwall limiter to prevent clipping and maximize loudness.',
  hasCustomGui: false,
  parameters: {
    ceiling: { min: -12, max: -0.1, defaultValue: -1.0, step: 0.1, unit: 'dB', label: 'Ceiling' },
    inputGain: { min: 0, max: 24, defaultValue: 4.0, step: 0.5, unit: 'dB', label: 'Input Gain' },
    release: { min: 5, max: 500, defaultValue: 50, step: 5, unit: 'ms', label: 'Release' },
  },
};

export class NativeLimiterPlugin {
  public static async createInstance(
    audioCtx: BaseAudioContext,
    trackId: string,
    initialState?: Record<string, unknown>
  ): Promise<PluginInstance> {
    const instanceId = `lim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const params: Record<string, number> = {
      ceiling: -1.0,
      inputGain: 4.0,
      release: 50,
    };

    if (initialState) {
      for (const [k, v] of Object.entries(initialState)) {
        if (typeof v === 'number' && k in params) {
          params[k] = v;
        }
      }
    }

    const inputNode = audioCtx.createGain();
    const preGainNode = audioCtx.createGain();
    const limiterNode = audioCtx.createDynamicsCompressor();
    const ceilingGainNode = audioCtx.createGain();
    const outputNode = audioCtx.createGain();

    // Limiter settings: extreme ratio, zero knee, ultra-fast attack
    limiterNode.threshold.setValueAtTime(params.ceiling, audioCtx.currentTime);
    limiterNode.ratio.setValueAtTime(20, audioCtx.currentTime);
    limiterNode.knee.setValueAtTime(0, audioCtx.currentTime);
    limiterNode.attack.setValueAtTime(0.001, audioCtx.currentTime);
    limiterNode.release.setValueAtTime(params.release / 1000, audioCtx.currentTime);

    const inputLin = Math.pow(10, params.inputGain / 20);
    preGainNode.gain.setValueAtTime(inputLin, audioCtx.currentTime);

    const ceilingLin = Math.pow(10, params.ceiling / 20);
    ceilingGainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);

    // Input -> PreGain -> Limiter -> CeilingTrim -> Output
    inputNode.connect(preGainNode);
    preGainNode.connect(limiterNode);
    limiterNode.connect(ceilingGainNode);
    ceilingGainNode.connect(outputNode);

    let isBypassed = false;

    const setParameter = (paramId: string, value: number) => {
      params[paramId] = value;
      const t = audioCtx.currentTime;

      switch (paramId) {
        case 'inputGain': {
          const lin = Math.pow(10, value / 20);
          preGainNode.gain.setTargetAtTime(lin, t, 0.02);
          break;
        }
        case 'ceiling': {
          limiterNode.threshold.setTargetAtTime(value, t, 0.02);
          break;
        }
        case 'release': {
          limiterNode.release.setTargetAtTime(Math.max(0.005, value / 1000), t, 0.02);
          break;
        }
      }
    };

    const getParameter = (paramId: string) => params[paramId] ?? 0;

    const applyBypass = (bypassed: boolean) => {
      isBypassed = bypassed;
      const t = audioCtx.currentTime;
      if (bypassed) {
        preGainNode.gain.setTargetAtTime(1.0, t, 0.01);
        limiterNode.threshold.setTargetAtTime(0, t, 0.01);
      } else {
        preGainNode.gain.setTargetAtTime(Math.pow(10, params.inputGain / 20), t, 0.01);
        limiterNode.threshold.setTargetAtTime(params.ceiling, t, 0.01);
      }
    };

    const destroy = () => {
      try {
        inputNode.disconnect();
        preGainNode.disconnect();
        limiterNode.disconnect();
        ceilingGainNode.disconnect();
        outputNode.disconnect();
      } catch {}
    };

    // Only settings are saved; the live gain reduction is a meter, not a setting
    const getState = async () => ({ ...params });

    return makeNativeInstance({
      instanceId,
      trackId,
      descriptor: LIMITER_DESCRIPTOR,
      inputNode,
      outputNode,
      params,
      setParameter,
      getParameter,
      applyBypass,
      destroy,
      getState,
    });
  }
}
