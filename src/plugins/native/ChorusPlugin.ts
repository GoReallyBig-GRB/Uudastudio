/**
 * X-PRO AUDIO - Native Chorus Plugin
 * Multi-voice stereo chorus with detuned LFOs and stereo dimension.
 */

import { PluginDescriptor, PluginInstance } from '../types';
import { buildChorusNode } from '../../audio/effects/dspChain';
import { ChorusParams } from '../../types';

export const CHORUS_DESCRIPTOR: PluginDescriptor = {
  id: 'uuda-native-chorus',
  name: 'Multi-Voice Chorus Ensemble',
  vendor: 'Uuda Audio DSP',
  version: '1.2.0',
  type: 'native',
  category: 'modulation',
  description: 'Warm analog multi-voice chorus with stereo widening and independent detuning.',
  hasCustomGui: false,
  parameters: {
    rateHz: { min: 0.1, max: 8.0, defaultValue: 1.5, step: 0.1, unit: 'Hz', label: 'Modulation Rate' },
    depthMs: { min: 1, max: 20, defaultValue: 6, step: 0.5, unit: 'ms', label: 'Modulation Depth' },
    voices: { min: 2, max: 6, defaultValue: 3, step: 1, unit: 'x', label: 'Voices' },
    dryWet: { min: 0, max: 1.0, defaultValue: 0.45, step: 0.01, unit: '%', label: 'Dry / Wet' },
  },
};

export class NativeChorusPlugin {
  public static async createInstance(
    audioCtx: BaseAudioContext,
    trackId: string,
    initialState?: Record<string, unknown>
  ): Promise<PluginInstance> {
    const instanceId = `cho-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const params: Record<string, number> = {
      rateHz: 1.5,
      depthMs: 6,
      voices: 3,
      dryWet: 0.45,
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
    const dryNode = audioCtx.createGain();
    const wetNode = audioCtx.createGain();

    inputNode.connect(dryNode);
    dryNode.connect(outputNode);

    let activeNode: { input: AudioNode; output: AudioNode } | null = null;

    const rebuildGraph = () => {
      if (activeNode) {
        try {
          inputNode.disconnect(activeNode.input);
          activeNode.output.disconnect(wetNode);
        } catch {}
      }

      const cfg: ChorusParams = {
        rateHz: params.rateHz,
        depthMs: params.depthMs,
        voices: params.voices,
        dryWet: 1.0,
      };

      activeNode = buildChorusNode(audioCtx, cfg);
      inputNode.connect(activeNode.input);
      activeNode.output.connect(wetNode);
      wetNode.connect(outputNode);
    };

    rebuildGraph();

    dryNode.gain.setValueAtTime(1.0 - params.dryWet, audioCtx.currentTime);
    wetNode.gain.setValueAtTime(params.dryWet, audioCtx.currentTime);

    let isBypassed = false;

    const setParameter = (paramId: string, value: number) => {
      params[paramId] = value;
      const t = audioCtx.currentTime;

      if (paramId === 'dryWet') {
        if (!isBypassed) {
          dryNode.gain.setTargetAtTime(1.0 - value, t, 0.02);
          wetNode.gain.setTargetAtTime(value, t, 0.02);
        }
      } else {
        rebuildGraph();
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
        wetNode.disconnect();
        outputNode.disconnect();
        if (activeNode) {
          activeNode.input.disconnect();
          activeNode.output.disconnect();
        }
      } catch {}
    };

    const getState = async () => ({ ...params });

    return {
      instanceId,
      descriptor: CHORUS_DESCRIPTOR,
      inputNode,
      outputNode,
      isBypassed: false,
      dryWet: params.dryWet,
      setParameter,
      getParameter,
      applyBypass,
      destroy,
      getState,
    };
  }
}
