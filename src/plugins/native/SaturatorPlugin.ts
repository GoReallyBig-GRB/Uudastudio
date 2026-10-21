/**
 * X-PRO AUDIO - Native Analog Tape & Tube Saturator Plugin
 * WaveShaper harmonic saturation with drive, tone equalization, and output trim.
 */

import { PluginDescriptor, PluginInstance } from '../types';
import { makeNativeInstance } from './instance';

export const SATURATOR_DESCRIPTOR: PluginDescriptor = {
  id: 'uuda-native-saturator',
  name: 'Warm Analog Saturator',
  vendor: 'Uuda Audio DSP',
  version: '1.2.0',
  type: 'native',
  category: 'utility',
  description: 'Harmonic tube & tape saturation to add density, color, and analog punch.',
  hasCustomGui: false,
  parameters: {
    drive: { min: 1, max: 20, defaultValue: 4, step: 0.5, unit: 'x', label: 'Drive' },
    tone: { min: 500, max: 16000, defaultValue: 6000, step: 100, unit: 'Hz', label: 'Tone Filter' },
    outputTrim: { min: -18, max: 6, defaultValue: -3, step: 0.5, unit: 'dB', label: 'Output Trim' },
    dryWet: { min: 0, max: 1.0, defaultValue: 0.8, step: 0.01, unit: '%', label: 'Dry / Wet' },
  },
};

export class NativeSaturatorPlugin {
  public static async createInstance(
    audioCtx: BaseAudioContext,
    trackId: string,
    initialState?: Record<string, unknown>
  ): Promise<PluginInstance> {
    const instanceId = `sat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const params: Record<string, number> = {
      drive: 4,
      tone: 6000,
      outputTrim: -3,
      dryWet: 0.8,
    };

    if (initialState) {
      for (const [k, v] of Object.entries(initialState)) {
        if (typeof v === 'number' && k in params) {
          params[k] = v;
        }
      }
    }

    const inputNode = audioCtx.createGain();
    const dryNode = audioCtx.createGain();
    const wetNode = audioCtx.createGain();
    const driveGain = audioCtx.createGain();
    const waveShaper = audioCtx.createWaveShaper();
    const toneFilter = audioCtx.createBiquadFilter();
    const trimNode = audioCtx.createGain();
    const outputNode = audioCtx.createGain();

    // Generate soft-clipping tape saturation curve
    const updateCurve = (k: number) => {
      const n_samples = 4096;
      const curve = new Float32Array(n_samples);
      const deg = Math.PI / 180;
      for (let i = 0; i < n_samples; ++i) {
        const x = (i * 2) / n_samples - 1;
        // Arctangent / tanh style harmonic soft clipping
        curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
      }
      waveShaper.curve = curve;
    };

    updateCurve(params.drive);
    waveShaper.oversample = '2x';

    driveGain.gain.setValueAtTime(Math.max(1, params.drive / 2), audioCtx.currentTime);

    toneFilter.type = 'lowpass';
    toneFilter.frequency.setValueAtTime(params.tone, audioCtx.currentTime);

    const trimLin = Math.pow(10, params.outputTrim / 20);
    trimNode.gain.setValueAtTime(trimLin, audioCtx.currentTime);

    dryNode.gain.setValueAtTime(1.0 - params.dryWet, audioCtx.currentTime);
    wetNode.gain.setValueAtTime(params.dryWet, audioCtx.currentTime);

    // Audio Graph:
    // Input -> Dry -> Output
    // Input -> DriveGain -> WaveShaper -> ToneFilter -> Trim -> Wet -> Output
    inputNode.connect(dryNode);
    dryNode.connect(outputNode);

    inputNode.connect(driveGain);
    driveGain.connect(waveShaper);
    waveShaper.connect(toneFilter);
    toneFilter.connect(trimNode);
    trimNode.connect(wetNode);
    wetNode.connect(outputNode);

    let isBypassed = false;

    const setParameter = (paramId: string, value: number) => {
      params[paramId] = value;
      const t = audioCtx.currentTime;

      switch (paramId) {
        case 'drive':
          updateCurve(value);
          driveGain.gain.setTargetAtTime(Math.max(1, value / 2), t, 0.02);
          break;
        case 'tone':
          toneFilter.frequency.setTargetAtTime(value, t, 0.02);
          break;
        case 'outputTrim': {
          const lin = Math.pow(10, value / 20);
          trimNode.gain.setTargetAtTime(lin, t, 0.02);
          break;
        }
        case 'dryWet': {
          if (!isBypassed) {
            dryNode.gain.setTargetAtTime(1.0 - value, t, 0.02);
            wetNode.gain.setTargetAtTime(value, t, 0.02);
          }
          break;
        }
      }
    };

    const getParameter = (paramId: string) => params[paramId] ?? 0;

    const applyBypass = (bypassed: boolean) => {
      isBypassed = bypassed;
      const t = audioCtx.currentTime;
      if (bypassed) {
        dryNode.gain.setTargetAtTime(1.0, t, 0.01);
        wetNode.gain.setTargetAtTime(0.0, t, 0.01);
      } else {
        dryNode.gain.setTargetAtTime(1.0 - params.dryWet, t, 0.01);
        wetNode.gain.setTargetAtTime(params.dryWet, t, 0.01);
      }
    };

    const destroy = () => {
      try {
        inputNode.disconnect();
        dryNode.disconnect();
        driveGain.disconnect();
        waveShaper.disconnect();
        toneFilter.disconnect();
        trimNode.disconnect();
        wetNode.disconnect();
        outputNode.disconnect();
      } catch {}
    };

    const getState = async () => ({ ...params });

    return makeNativeInstance({
      instanceId,
      trackId,
      descriptor: SATURATOR_DESCRIPTOR,
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
