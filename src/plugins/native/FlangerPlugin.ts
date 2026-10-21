/**
 * X-PRO AUDIO - Native Flanger Plugin
 * Short delay modulation with through-zero feel and feedback resonance.
 */

import { PluginDescriptor, PluginInstance } from '../types';
import { makeNativeInstance } from './instance';
import { buildFlangerNode } from '../../audio/effects/dspChain';
import { FlangerParams } from '../../types';

export const FLANGER_DESCRIPTOR: PluginDescriptor = {
  id: 'uuda-native-flanger',
  name: 'Studio Tape Flanger',
  vendor: 'Uuda Audio DSP',
  version: '1.2.0',
  type: 'native',
  category: 'modulation',
  description: 'Classic tape comb-filtering flanger with bidirectional feedback and jet sweeps.',
  hasCustomGui: false,
  parameters: {
    rateHz: { min: 0.05, max: 5.0, defaultValue: 0.4, step: 0.05, unit: 'Hz', label: 'Sweep Rate' },
    depthMs: { min: 0.1, max: 5.0, defaultValue: 1.8, step: 0.1, unit: 'ms', label: 'Sweep Depth' },
    delayMs: { min: 0.5, max: 10.0, defaultValue: 2.5, step: 0.1, unit: 'ms', label: 'Base Delay' },
    feedback: { min: -0.9, max: 0.9, defaultValue: 0.6, step: 0.05, unit: '%', label: 'Feedback' },
    dryWet: { min: 0, max: 1.0, defaultValue: 0.5, step: 0.01, unit: '%', label: 'Dry / Wet' },
  },
};

export class NativeFlangerPlugin {
  public static async createInstance(
    audioCtx: BaseAudioContext,
    trackId: string,
    initialState?: Record<string, unknown>
  ): Promise<PluginInstance> {
    const instanceId = `fla-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const params: Record<string, number> = {
      rateHz: 0.4,
      depthMs: 1.8,
      delayMs: 2.5,
      feedback: 0.6,
      dryWet: 0.5,
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

    let activeNode: { input: AudioNode; output: AudioNode; stop?: () => void } | null = null;

    const rebuildGraph = () => {
      if (activeNode) {
        try {
          inputNode.disconnect(activeNode.input);
          activeNode.output.disconnect(wetNode);
          activeNode.stop?.();
        } catch {}
      }

      const cfg: FlangerParams = {
        rateHz: params.rateHz,
        depthMs: params.depthMs,
        delayMs: params.delayMs,
        feedback: params.feedback,
        stereoPhaseDeg: 90,
        dryWet: 1.0,
      };

      activeNode = buildFlangerNode(audioCtx, cfg);
      inputNode.connect(activeNode.input);
      activeNode.output.connect(wetNode);
      wetNode.connect(outputNode);
    };

    rebuildGraph();

    dryNode.gain.setValueAtTime(1.0 - params.dryWet, audioCtx.currentTime);
    wetNode.gain.setValueAtTime(params.dryWet, audioCtx.currentTime);

    let isBypassed = false;
    let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

    const setParameter = (paramId: string, value: number) => {
      params[paramId] = value;
      const t = audioCtx.currentTime;

      if (paramId === 'dryWet') {
        if (!isBypassed) {
          dryNode.gain.setTargetAtTime(1.0 - value, t, 0.02);
          wetNode.gain.setTargetAtTime(value, t, 0.02);
        }
      } else {
        // Rebuilding on every slider tick would click and waste CPU; wait for the value to settle
        if (rebuildTimer) clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(rebuildGraph, 120);
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
      if (rebuildTimer) clearTimeout(rebuildTimer);
      try {
        inputNode.disconnect();
        dryNode.disconnect();
        wetNode.disconnect();
        outputNode.disconnect();
        if (activeNode) {
          activeNode.stop?.();
          activeNode.input.disconnect();
          activeNode.output.disconnect();
        }
      } catch {}
    };

    const getState = async () => ({ ...params });

    return makeNativeInstance({
      instanceId,
      trackId,
      descriptor: FLANGER_DESCRIPTOR,
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
