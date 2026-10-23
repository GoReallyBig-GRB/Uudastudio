/**
 * X-PRO AUDIO - Native Auto-Pan & Tremolo Plugin
 * Modulated spatial auto-pan and optical amplitude tremolo with selectable wave shapes.
 */

import { PluginDescriptor, PluginInstance } from '../types';
import { makeNativeInstance } from './instance';

export const AUTO_PAN_DESCRIPTOR: PluginDescriptor = {
  id: 'uuda-native-autopan',
  name: 'Auto-Pan & Optical Tremolo',
  vendor: 'Uuda Audio DSP',
  version: '1.2.0',
  type: 'native',
  category: 'modulation',
  description: 'Rhythmic stereo auto-panner and vintage amplitude tremolo with sine, triangle, and square waveforms.',
  hasCustomGui: false,
  parameters: {
    rateHz: { min: 0.1, max: 15.0, defaultValue: 2.0, step: 0.1, unit: 'Hz', label: 'Rate' },
    depth: { min: 0, max: 100, defaultValue: 70, step: 5, unit: '%', label: 'Depth' },
    mode: { min: 0, max: 1, defaultValue: 0, step: 1, unit: 'mode', label: 'Mode (0=Pan, 1=Trem)' },
    shape: { min: 0, max: 2, defaultValue: 0, step: 1, unit: 'type', label: 'Wave (0=Sin,1=Tri,2=Sqr)' },
  },
};

export class NativeAutoPanPlugin {
  public static async createInstance(
    audioCtx: BaseAudioContext,
    trackId: string,
    initialState?: Record<string, unknown>
  ): Promise<PluginInstance> {
    const instanceId = `pan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const params: Record<string, number> = {
      rateHz: 2.0,
      depth: 70,
      mode: 0,
      shape: 0,
    };

    if (initialState) {
      for (const [k, v] of Object.entries(initialState)) {
        if (typeof v === 'number' && k in params) {
          params[k] = v;
        }
      }
    }

    const inputNode = audioCtx.createGain();
    const tremoloGain = audioCtx.createGain();
    const pannerNode = audioCtx.createStereoPanner ? audioCtx.createStereoPanner() : null;
    const outputNode = audioCtx.createGain();

    const lfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();

    const updateWaveShape = () => {
      if (params.shape === 0) lfo.type = 'sine';
      else if (params.shape === 1) lfo.type = 'triangle';
      else lfo.type = 'square';
    };
    updateWaveShape();

    lfo.frequency.setValueAtTime(params.rateHz, audioCtx.currentTime);

    const updateModulationTarget = () => {
      const isTremolo = params.mode >= 0.5;
      const depthVal = params.depth / 100;
      const t = audioCtx.currentTime;

      try {
        lfo.disconnect();
      } catch {}

      if (isTremolo) {
        // Tremolo mode: LFO modulates tremoloGain around (1 - depth/2)
        tremoloGain.gain.setValueAtTime(1.0 - depthVal * 0.5, t);
        lfoGain.gain.setValueAtTime(depthVal * 0.5, t);
        lfo.connect(lfoGain);
        lfoGain.connect(tremoloGain.gain);
        if (pannerNode) pannerNode.pan.setValueAtTime(0, t);
      } else {
        // Auto-Pan mode: LFO modulates stereo panner
        tremoloGain.gain.setValueAtTime(1.0, t);
        if (pannerNode) {
          lfoGain.gain.setValueAtTime(depthVal, t);
          lfo.connect(lfoGain);
          lfoGain.connect(pannerNode.pan);
        }
      }
    };

    updateModulationTarget();

    inputNode.connect(tremoloGain);
    if (pannerNode) {
      tremoloGain.connect(pannerNode);
      pannerNode.connect(outputNode);
    } else {
      tremoloGain.connect(outputNode);
    }

    lfo.start();

    let isBypassed = false;

    const setParameter = (paramId: string, value: number) => {
      params[paramId] = value;
      const t = audioCtx.currentTime;

      switch (paramId) {
        case 'rateHz':
          lfo.frequency.setTargetAtTime(value, t, 0.02);
          break;
        case 'shape':
          updateWaveShape();
          break;
        case 'depth':
        case 'mode':
          updateModulationTarget();
          break;
      }
    };

    const getParameter = (paramId: string) => params[paramId] ?? 0;

    const applyBypass = (bypassed: boolean) => {
      isBypassed = bypassed;
      const t = audioCtx.currentTime;
      if (bypassed) {
        tremoloGain.gain.setTargetAtTime(1.0, t, 0.01);
        if (pannerNode) pannerNode.pan.setTargetAtTime(0, t, 0.01);
      } else {
        updateModulationTarget();
      }
    };

    const destroy = () => {
      try {
        lfo.stop();
        lfo.disconnect();
        lfoGain.disconnect();
        inputNode.disconnect();
        tremoloGain.disconnect();
        if (pannerNode) pannerNode.disconnect();
        outputNode.disconnect();
      } catch {}
    };

    const getState = async () => ({ ...params });

    return makeNativeInstance({
      instanceId,
      trackId,
      descriptor: AUTO_PAN_DESCRIPTOR,
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
