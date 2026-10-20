/**
 * X-PRO AUDIO - Native Stereo & Ping-Pong Delay Plugin
 * High-damping stereo delay line with ping-pong bounce and tone shaping.
 */

import { PluginDescriptor, PluginInstance } from '../types';
import { buildDelayNode } from '../../audio/effects/dspChain';
import { DelayParams } from '../../types';

export const DELAY_DESCRIPTOR: PluginDescriptor = {
  id: 'uuda-native-delay',
  name: 'Stereo Ping-Pong Delay',
  vendor: 'Uuda Audio DSP',
  version: '1.2.0',
  type: 'native',
  category: 'spatial',
  description: 'Synchronized stereo delay with ping-pong feedback path and tone filters.',
  hasCustomGui: false,
  parameters: {
    timeMs: { min: 10, max: 1500, defaultValue: 350, step: 10, unit: 'ms', label: 'Delay Time' },
    feedback: { min: 0, max: 0.95, defaultValue: 0.45, step: 0.01, unit: '%', label: 'Feedback' },
    lowCutHz: { min: 20, max: 1000, defaultValue: 100, step: 10, unit: 'Hz', label: 'Low Cut' },
    highCutHz: { min: 1000, max: 18000, defaultValue: 7500, step: 100, unit: 'Hz', label: 'High Cut' },
    pingPong: { min: 0, max: 1, defaultValue: 1, step: 1, unit: 'bool', label: 'Ping-Pong' },
    dryWet: { min: 0, max: 1, defaultValue: 0.3, step: 0.01, unit: '%', label: 'Dry / Wet' },
  },
};

export class NativeDelayPlugin {
  public static async createInstance(
    audioCtx: BaseAudioContext,
    trackId: string,
    initialState?: Record<string, unknown>
  ): Promise<PluginInstance> {
    const instanceId = `del-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const params: Record<string, number> = {
      timeMs: 350,
      feedback: 0.45,
      lowCutHz: 100,
      highCutHz: 7500,
      pingPong: 1,
      dryWet: 0.3,
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

    let activeEffectNode: { input: AudioNode; output: AudioNode } | null = null;

    const rebuildGraph = () => {
      if (activeEffectNode) {
        try {
          inputNode.disconnect(activeEffectNode.input);
          activeEffectNode.output.disconnect(wetNode);
        } catch {}
      }

      const delayConfig: DelayParams = {
        timeMs: params.timeMs,
        feedback: params.feedback,
        lowCutHz: params.lowCutHz,
        highCutHz: params.highCutHz,
        pingPong: params.pingPong >= 0.5,
        dryWet: 1.0, // handled by outer wetNode
      };

      activeEffectNode = buildDelayNode(audioCtx, delayConfig);
      inputNode.connect(activeEffectNode.input);
      activeEffectNode.output.connect(wetNode);
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
        if (activeEffectNode) {
          activeEffectNode.input.disconnect();
          activeEffectNode.output.disconnect();
        }
      } catch {}
    };

    const getState = async () => ({ ...params });

    return {
      instanceId,
      descriptor: DELAY_DESCRIPTOR,
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
