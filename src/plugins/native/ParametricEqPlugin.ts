/**
 * X-PRO AUDIO - Native Parametric Equalizer Plugin
 * 5-Band studio precision parametric equalizer with frequency, gain, and Q control.
 */

import { PluginDescriptor, PluginInstance } from '../types';
import { buildEqualizerNode } from '../../audio/effects/dspChain';
import { EqualizerParams } from '../../types';

export const PARAMETRIC_EQ_DESCRIPTOR: PluginDescriptor = {
  id: 'uuda-native-param-eq',
  name: 'Parametric Equalizer Pro',
  vendor: 'Uuda Audio DSP',
  version: '1.2.0',
  type: 'native',
  category: 'eq',
  description: 'Multi-band parametric equalizer with surgical resonance and broadcast curve shaping.',
  hasCustomGui: false,
  parameters: {
    lowGain: { min: -18, max: 18, defaultValue: 0, step: 0.5, unit: 'dB', label: 'Low (100 Hz)' },
    lowMidGain: { min: -18, max: 18, defaultValue: 0, step: 0.5, unit: 'dB', label: 'Low-Mid (400 Hz)' },
    midGain: { min: -18, max: 18, defaultValue: 0, step: 0.5, unit: 'dB', label: 'Mid (1.2 kHz)' },
    highMidGain: { min: -18, max: 18, defaultValue: 0, step: 0.5, unit: 'dB', label: 'High-Mid (3.5 kHz)' },
    highGain: { min: -18, max: 18, defaultValue: 0, step: 0.5, unit: 'dB', label: 'High (10 kHz)' },
    midQ: { min: 0.2, max: 8.0, defaultValue: 1.2, step: 0.1, unit: 'Q', label: 'Mid Q Factor' },
    outputTrim: { min: -12, max: 12, defaultValue: 0, step: 0.5, unit: 'dB', label: 'Output Trim' },
  },
};

export class NativeParametricEqPlugin {
  public static async createInstance(
    audioCtx: BaseAudioContext,
    trackId: string,
    initialState?: Record<string, unknown>
  ): Promise<PluginInstance> {
    const instanceId = `peq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const params: Record<string, number> = {
      lowGain: 0,
      lowMidGain: 0,
      midGain: 0,
      highMidGain: 0,
      highGain: 0,
      midQ: 1.2,
      outputTrim: 0,
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
    const trimNode = audioCtx.createGain();

    const lowFilter = audioCtx.createBiquadFilter();
    lowFilter.type = 'lowshelf';
    lowFilter.frequency.setValueAtTime(100, audioCtx.currentTime);

    const lowMidFilter = audioCtx.createBiquadFilter();
    lowMidFilter.type = 'peaking';
    lowMidFilter.frequency.setValueAtTime(400, audioCtx.currentTime);
    lowMidFilter.Q.setValueAtTime(1.0, audioCtx.currentTime);

    const midFilter = audioCtx.createBiquadFilter();
    midFilter.type = 'peaking';
    midFilter.frequency.setValueAtTime(1200, audioCtx.currentTime);
    midFilter.Q.setValueAtTime(params.midQ, audioCtx.currentTime);

    const highMidFilter = audioCtx.createBiquadFilter();
    highMidFilter.type = 'peaking';
    highMidFilter.frequency.setValueAtTime(3500, audioCtx.currentTime);
    highMidFilter.Q.setValueAtTime(1.2, audioCtx.currentTime);

    const highFilter = audioCtx.createBiquadFilter();
    highFilter.type = 'highshelf';
    highFilter.frequency.setValueAtTime(10000, audioCtx.currentTime);

    // Apply initial gains
    lowFilter.gain.setValueAtTime(params.lowGain, audioCtx.currentTime);
    lowMidFilter.gain.setValueAtTime(params.lowMidGain, audioCtx.currentTime);
    midFilter.gain.setValueAtTime(params.midGain, audioCtx.currentTime);
    highMidFilter.gain.setValueAtTime(params.highMidGain, audioCtx.currentTime);
    highFilter.gain.setValueAtTime(params.highGain, audioCtx.currentTime);

    const trimLin = Math.pow(10, params.outputTrim / 20);
    trimNode.gain.setValueAtTime(trimLin, audioCtx.currentTime);

    // Connect chain:
    // Input -> Low -> LowMid -> Mid -> HighMid -> High -> Trim -> Output
    inputNode.connect(lowFilter);
    lowFilter.connect(lowMidFilter);
    lowMidFilter.connect(midFilter);
    midFilter.connect(highMidFilter);
    highMidFilter.connect(highFilter);
    highFilter.connect(trimNode);
    trimNode.connect(outputNode);

    let isBypassed = false;

    const setParameter = (paramId: string, value: number) => {
      params[paramId] = value;
      const t = audioCtx.currentTime;

      switch (paramId) {
        case 'lowGain':
          lowFilter.gain.setTargetAtTime(value, t, 0.02);
          break;
        case 'lowMidGain':
          lowMidFilter.gain.setTargetAtTime(value, t, 0.02);
          break;
        case 'midGain':
          midFilter.gain.setTargetAtTime(value, t, 0.02);
          break;
        case 'highMidGain':
          highMidFilter.gain.setTargetAtTime(value, t, 0.02);
          break;
        case 'highGain':
          highFilter.gain.setTargetAtTime(value, t, 0.02);
          break;
        case 'midQ':
          midFilter.Q.setTargetAtTime(Math.max(0.1, value), t, 0.02);
          break;
        case 'outputTrim': {
          const lin = Math.pow(10, value / 20);
          trimNode.gain.setTargetAtTime(lin, t, 0.02);
          break;
        }
      }
    };

    const getParameter = (paramId: string) => params[paramId] ?? 0;

    const applyBypass = (bypassed: boolean) => {
      isBypassed = bypassed;
      const t = audioCtx.currentTime;
      if (bypassed) {
        lowFilter.gain.setTargetAtTime(0, t, 0.01);
        lowMidFilter.gain.setTargetAtTime(0, t, 0.01);
        midFilter.gain.setTargetAtTime(0, t, 0.01);
        highMidFilter.gain.setTargetAtTime(0, t, 0.01);
        highFilter.gain.setTargetAtTime(0, t, 0.01);
        trimNode.gain.setTargetAtTime(1.0, t, 0.01);
      } else {
        lowFilter.gain.setTargetAtTime(params.lowGain, t, 0.01);
        lowMidFilter.gain.setTargetAtTime(params.lowMidGain, t, 0.01);
        midFilter.gain.setTargetAtTime(params.midGain, t, 0.01);
        highMidFilter.gain.setTargetAtTime(params.highMidGain, t, 0.01);
        highFilter.gain.setTargetAtTime(params.highGain, t, 0.01);
        trimNode.gain.setTargetAtTime(Math.pow(10, params.outputTrim / 20), t, 0.01);
      }
    };

    const destroy = () => {
      try {
        inputNode.disconnect();
        lowFilter.disconnect();
        lowMidFilter.disconnect();
        midFilter.disconnect();
        highMidFilter.disconnect();
        highFilter.disconnect();
        trimNode.disconnect();
        outputNode.disconnect();
      } catch {}
    };

    const getState = async () => ({ ...params });

    return {
      instanceId,
      descriptor: PARAMETRIC_EQ_DESCRIPTOR,
      inputNode,
      outputNode,
      isBypassed: false,
      dryWet: 1.0,
      setParameter,
      getParameter,
      applyBypass,
      destroy,
      getState,
    };
  }
}
