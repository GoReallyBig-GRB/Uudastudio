/**
 * X-PRO AUDIO - Native Noise Gate Plugin
 * Precision downward expander/gate implemented with standard Web Audio nodes
 * to guarantee identical bit-accurate rendering in both live playback and OfflineAudioContext export.
 */

import { PluginDescriptor, PluginInstance } from '../types';

export const NOISE_GATE_DESCRIPTOR: PluginDescriptor = {
  id: 'uuda-native-gate',
  name: 'Studio Noise Gate',
  vendor: 'Uuda Audio DSP',
  version: '1.2.0',
  type: 'native',
  category: 'dynamics',
  description: 'Clean downward expander gate to mute studio bleed and room room tone between phrases.',
  hasCustomGui: false,
  parameters: {
    threshold: { min: -70, max: -10, defaultValue: -42, step: 1, unit: 'dB', label: 'Threshold' },
    attack: { min: 0.5, max: 50, defaultValue: 2, step: 0.5, unit: 'ms', label: 'Attack' },
    hold: { min: 5, max: 200, defaultValue: 40, step: 5, unit: 'ms', label: 'Hold' },
    release: { min: 10, max: 500, defaultValue: 100, step: 5, unit: 'ms', label: 'Release' },
    range: { min: 12, max: 80, defaultValue: 48, step: 1, unit: 'dB', label: 'Range' },
  },
};

export class NativeNoiseGatePlugin {
  public static async createInstance(
    audioCtx: BaseAudioContext,
    trackId: string,
    initialState?: Record<string, unknown>
  ): Promise<PluginInstance> {
    const instanceId = `gat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const params: Record<string, number> = {
      threshold: -42,
      attack: 2,
      hold: 40,
      release: 100,
      range: 48,
    };

    if (initialState) {
      for (const [k, v] of Object.entries(initialState)) {
        if (typeof v === 'number' && k in params) {
          params[k] = v;
        }
      }
    }

    const inputNode = audioCtx.createGain();
    const gateGainNode = audioCtx.createGain();
    const outputNode = audioCtx.createGain();

    // Sidechain detector chain:
    // Input -> Rectifier (abs) -> Envelope Lowpass -> Gate Transfer Curve -> gateGainNode.gain
    const rectifier = audioCtx.createWaveShaper();
    const rectSamples = 1024;
    const rectCurve = new Float32Array(rectSamples);
    for (let i = 0; i < rectSamples; i++) {
      const x = (i / (rectSamples - 1)) * 2 - 1;
      rectCurve[i] = Math.abs(x);
    }
    rectifier.curve = rectCurve;

    const envFilter = audioCtx.createBiquadFilter();
    envFilter.type = 'lowpass';
    const updateEnvFilter = () => {
      const attackSec = Math.max(0.0005, params.attack / 1000);
      const cutoff = Math.min(2000, 1 / (2 * Math.PI * attackSec));
      envFilter.frequency.setValueAtTime(cutoff, audioCtx.currentTime);
    };
    updateEnvFilter();

    const transferShaper = audioCtx.createWaveShaper();
    const updateTransferCurve = () => {
      const samples = 2048;
      const curve = new Float32Array(samples);
      const threshLin = Math.pow(10, params.threshold / 20);
      const minGain = Math.pow(10, -params.range / 20);

      for (let i = 0; i < samples; i++) {
        const level = i / (samples - 1); // 0 to 1
        if (level < threshLin * 0.7) {
          curve[i] = minGain;
        } else if (level >= threshLin) {
          curve[i] = 1.0;
        } else {
          // Smooth knee between 0.7*thresh and thresh
          const ratio = (level - threshLin * 0.7) / (threshLin * 0.3);
          curve[i] = minGain + (1.0 - minGain) * Math.sin((ratio * Math.PI) / 2);
        }
      }
      transferShaper.curve = curve;
    };
    updateTransferCurve();

    inputNode.connect(rectifier);
    rectifier.connect(envFilter);
    envFilter.connect(transferShaper);
    transferShaper.connect(gateGainNode.gain);

    inputNode.connect(gateGainNode);
    gateGainNode.connect(outputNode);

    let isBypassed = false;

    const setParameter = (paramId: string, value: number) => {
      params[paramId] = value;
      if (paramId === 'attack' || paramId === 'release') {
        updateEnvFilter();
      } else {
        updateTransferCurve();
      }
    };

    const getParameter = (paramId: string) => params[paramId] ?? 0;

    const applyBypass = (bypassed: boolean) => {
      isBypassed = bypassed;
      if (bypassed) {
        gateGainNode.gain.cancelScheduledValues(audioCtx.currentTime);
        gateGainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
        try {
          transferShaper.disconnect(gateGainNode.gain);
        } catch {}
      } else {
        updateTransferCurve();
        try {
          transferShaper.connect(gateGainNode.gain);
        } catch {}
      }
    };

    const destroy = () => {
      try {
        inputNode.disconnect();
        rectifier.disconnect();
        envFilter.disconnect();
        transferShaper.disconnect();
        gateGainNode.disconnect();
        outputNode.disconnect();
      } catch {}
    };

    const getState = async () => ({ ...params });

    return {
      instanceId,
      descriptor: NOISE_GATE_DESCRIPTOR,
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
