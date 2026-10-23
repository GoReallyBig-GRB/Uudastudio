/**
 * X-PRO AUDIO - Native De-Esser Plugin
 * Split-band precision vocal de-esser with sibilance auditioning and dynamic attenuation.
 */

import { PluginDescriptor, PluginInstance } from '../types';
import { makeNativeInstance } from './instance';

export const DE_ESSER_DESCRIPTOR: PluginDescriptor = {
  id: 'uuda-native-deesser',
  name: 'Precision Vocal De-Esser',
  vendor: 'Uuda Audio DSP',
  version: '1.2.0',
  type: 'native',
  category: 'dynamics',
  description: 'Split-band sibilance compression to tame harsh S and T vocal frequencies.',
  hasCustomGui: false,
  parameters: {
    frequency: { min: 4000, max: 9000, defaultValue: 6500, step: 50, unit: 'Hz', label: 'Frequency' },
    threshold: { min: -50, max: -5, defaultValue: -24, step: 0.5, unit: 'dB', label: 'Threshold' },
    reduction: { min: 1, max: 20, defaultValue: 8, step: 0.5, unit: 'dB', label: 'Reduction' },
    listenSibilance: { min: 0, max: 1, defaultValue: 0, step: 1, unit: 'bool', label: 'Listen Sibilance' },
  },
};

export class NativeDeEsserPlugin {
  public static async createInstance(
    audioCtx: BaseAudioContext,
    trackId: string,
    initialState?: Record<string, unknown>
  ): Promise<PluginInstance> {
    const instanceId = `des-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const params: Record<string, number> = {
      frequency: 6500,
      threshold: -24,
      reduction: 8,
      listenSibilance: 0,
    };

    if (initialState) {
      for (const [k, v] of Object.entries(initialState)) {
        if (typeof v === 'number' && k in params) {
          params[k] = v;
        }
      }
    }

    const inputNode = audioCtx.createGain();
    const outputNode = audioCtx.createGain();

    // 1. Main Path (Notch filter at sibilance band)
    const mainNotch = audioCtx.createBiquadFilter();
    mainNotch.type = 'notch';
    mainNotch.frequency.setValueAtTime(params.frequency, audioCtx.currentTime);
    mainNotch.Q.setValueAtTime(1.5, audioCtx.currentTime);

    const mainGain = audioCtx.createGain();
    inputNode.connect(mainNotch);
    mainNotch.connect(mainGain);
    mainGain.connect(outputNode);

    // 2. Sibilance Path (Bandpass filter -> Compressor)
    const sibilanceBand = audioCtx.createBiquadFilter();
    sibilanceBand.type = 'bandpass';
    sibilanceBand.frequency.setValueAtTime(params.frequency, audioCtx.currentTime);
    sibilanceBand.Q.setValueAtTime(1.5, audioCtx.currentTime);

    const sibilanceComp = audioCtx.createDynamicsCompressor();
    sibilanceComp.threshold.setValueAtTime(params.threshold, audioCtx.currentTime);
    sibilanceComp.ratio.setValueAtTime(Math.max(2, params.reduction), audioCtx.currentTime);
    sibilanceComp.attack.setValueAtTime(0.002, audioCtx.currentTime); // fast attack to catch sibilants
    sibilanceComp.release.setValueAtTime(0.05, audioCtx.currentTime);

    const sibilanceGain = audioCtx.createGain();
    inputNode.connect(sibilanceBand);
    sibilanceBand.connect(sibilanceComp);
    sibilanceComp.connect(sibilanceGain);
    sibilanceGain.connect(outputNode);

    const updateRouting = () => {
      const isListen = params.listenSibilance >= 0.5;
      const t = audioCtx.currentTime;
      if (isListen) {
        mainGain.gain.setTargetAtTime(0, t, 0.01);
        sibilanceGain.gain.setTargetAtTime(1.0, t, 0.01);
      } else {
        mainGain.gain.setTargetAtTime(1.0, t, 0.01);
        sibilanceGain.gain.setTargetAtTime(1.0, t, 0.01);
      }
    };

    updateRouting();

    let isBypassed = false;

    const setParameter = (paramId: string, value: number) => {
      params[paramId] = value;
      const t = audioCtx.currentTime;

      switch (paramId) {
        case 'frequency':
          mainNotch.frequency.setTargetAtTime(value, t, 0.02);
          sibilanceBand.frequency.setTargetAtTime(value, t, 0.02);
          break;
        case 'threshold':
          sibilanceComp.threshold.setTargetAtTime(value, t, 0.02);
          break;
        case 'reduction':
          sibilanceComp.ratio.setTargetAtTime(Math.max(1, value), t, 0.02);
          break;
        case 'listenSibilance':
          updateRouting();
          break;
      }
    };

    const getParameter = (paramId: string) => params[paramId] ?? 0;

    const applyBypass = (bypassed: boolean) => {
      isBypassed = bypassed;
      const t = audioCtx.currentTime;
      if (bypassed) {
        mainGain.gain.setTargetAtTime(1.0, t, 0.01);
        sibilanceGain.gain.setTargetAtTime(0.0, t, 0.01);
      } else {
        updateRouting();
      }
    };

    const destroy = () => {
      try {
        inputNode.disconnect();
        mainNotch.disconnect();
        mainGain.disconnect();
        sibilanceBand.disconnect();
        sibilanceComp.disconnect();
        sibilanceGain.disconnect();
        outputNode.disconnect();
      } catch {}
    };

    const getState = async () => ({ ...params });

    return makeNativeInstance({
      instanceId,
      trackId,
      descriptor: DE_ESSER_DESCRIPTOR,
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
