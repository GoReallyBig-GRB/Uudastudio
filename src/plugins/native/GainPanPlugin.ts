/**
 * X-PRO AUDIO - Native Gain & Pan Trim Plugin
 * Transparent utility trim for channel calibration and stereo positioning.
 */

import { PluginDescriptor, PluginInstance } from '../types';

export const GAIN_PAN_DESCRIPTOR: PluginDescriptor = {
  id: 'uuda-native-gain-pan',
  name: 'Gain & Pan Trim',
  vendor: 'Uuda Audio DSP',
  version: '1.2.0',
  type: 'native',
  category: 'utility',
  description: 'Clean stage gain calibration in dB and stereo pan positioning.',
  hasCustomGui: false,
  parameters: {
    gainDb: { min: -36, max: 24, defaultValue: 0, step: 0.5, unit: 'dB', label: 'Gain' },
    pan: { min: -1.0, max: 1.0, defaultValue: 0, step: 0.02, unit: '', label: 'Pan' },
  },
};

export class NativeGainPanPlugin {
  public static async createInstance(
    audioCtx: BaseAudioContext,
    trackId: string,
    initialState?: Record<string, unknown>
  ): Promise<PluginInstance> {
    const instanceId = `gp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const params: Record<string, number> = {
      gainDb: 0,
      pan: 0,
    };

    if (initialState) {
      for (const [k, v] of Object.entries(initialState)) {
        if (typeof v === 'number' && k in params) {
          params[k] = v;
        }
      }
    }

    const inputNode = audioCtx.createGain();
    const gainNode = audioCtx.createGain();
    const panNode = audioCtx.createStereoPanner ? audioCtx.createStereoPanner() : null;
    const outputNode = audioCtx.createGain();

    const gainLin = Math.pow(10, params.gainDb / 20);
    gainNode.gain.setValueAtTime(gainLin, audioCtx.currentTime);

    inputNode.connect(gainNode);
    if (panNode) {
      panNode.pan.setValueAtTime(params.pan, audioCtx.currentTime);
      gainNode.connect(panNode);
      panNode.connect(outputNode);
    } else {
      gainNode.connect(outputNode);
    }

    let isBypassed = false;

    const setParameter = (paramId: string, value: number) => {
      params[paramId] = value;
      const t = audioCtx.currentTime;

      if (paramId === 'gainDb') {
        const lin = Math.pow(10, value / 20);
        gainNode.gain.setTargetAtTime(lin, t, 0.02);
      } else if (paramId === 'pan' && panNode) {
        panNode.pan.setTargetAtTime(Math.max(-1, Math.min(1, value)), t, 0.02);
      }
    };

    const getParameter = (paramId: string) => params[paramId] ?? 0;

    const applyBypass = (bypassed: boolean) => {
      isBypassed = bypassed;
      const t = audioCtx.currentTime;
      if (bypassed) {
        gainNode.gain.setTargetAtTime(1.0, t, 0.01);
        if (panNode) panNode.pan.setTargetAtTime(0, t, 0.01);
      } else {
        gainNode.gain.setTargetAtTime(Math.pow(10, params.gainDb / 20), t, 0.01);
        if (panNode) panNode.pan.setTargetAtTime(params.pan, t, 0.01);
      }
    };

    const destroy = () => {
      try {
        inputNode.disconnect();
        gainNode.disconnect();
        if (panNode) panNode.disconnect();
        outputNode.disconnect();
      } catch {}
    };

    const getState = async () => ({ ...params });

    return {
      instanceId,
      descriptor: GAIN_PAN_DESCRIPTOR,
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
