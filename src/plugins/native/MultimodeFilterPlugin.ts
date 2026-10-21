/**
 * X-PRO AUDIO - Native Multimode Filter & Auto-Filter Plugin
 * Multimode filter (LP, HP, BP, Notch, LowShelf, HighShelf) with 12/24/48 dB slopes,
 * resonant peak Q, LFO frequency sweep, output trim, and Low/High Cut vocal presets.
 */

import { PluginDescriptor, PluginInstance } from '../types';
import { makeNativeInstance } from './instance';

export const MULTIMODE_FILTER_DESCRIPTOR: PluginDescriptor = {
  id: 'uuda-native-filter',
  name: 'Multimode Resonant Filter & Auto-Filter',
  vendor: 'Uuda Audio DSP',
  version: '1.2.0',
  type: 'native',
  category: 'eq',
  description: 'Versatile multimode filter with 12 to 48 dB/oct slopes, resonance, and LFO frequency sweep.',
  hasCustomGui: false,
  parameters: {
    filterType: { min: 0, max: 5, defaultValue: 0, step: 1, unit: 'type', label: 'Type (0=LP,1=HP,2=BP,3=Notch,4=LS,5=HS)' },
    cutoffHz: { min: 20, max: 20000, defaultValue: 2500, step: 20, unit: 'Hz', label: 'Cutoff Frequency' },
    resonance: { min: 0.1, max: 15.0, defaultValue: 1.0, step: 0.1, unit: 'Q', label: 'Resonance (Q)' },
    slopeDb: { min: 12, max: 48, defaultValue: 24, step: 12, unit: 'dB/oct', label: 'Slope (12, 24, 48)' },
    lfoRateHz: { min: 0, max: 10.0, defaultValue: 0, step: 0.1, unit: 'Hz', label: 'LFO Rate (0=off)' },
    lfoDepth: { min: 0, max: 100, defaultValue: 0, step: 5, unit: '%', label: 'LFO Sweep Depth' },
    outputTrim: { min: -12, max: 12, defaultValue: 0, step: 0.5, unit: 'dB', label: 'Output Trim' },
    dryWet: { min: 0, max: 1.0, defaultValue: 1.0, step: 0.01, unit: '%', label: 'Dry / Wet' },
  },
};

export class NativeMultimodeFilterPlugin {
  public static async createInstance(
    audioCtx: BaseAudioContext,
    trackId: string,
    initialState?: Record<string, unknown>
  ): Promise<PluginInstance> {
    const instanceId = `flt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const params: Record<string, number> = {
      filterType: 0,
      cutoffHz: 2500,
      resonance: 1.0,
      slopeDb: 24,
      lfoRateHz: 0,
      lfoDepth: 0,
      outputTrim: 0,
      dryWet: 1.0,
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
    const trimNode = audioCtx.createGain();
    const outputNode = audioCtx.createGain();

    inputNode.connect(dryNode);
    dryNode.connect(outputNode);

    // 4 cascaded BiquadFilterNodes (giving up to 48 dB/oct: 12, 24, 36, 48)
    const filters: BiquadFilterNode[] = [
      audioCtx.createBiquadFilter(),
      audioCtx.createBiquadFilter(),
      audioCtx.createBiquadFilter(),
      audioCtx.createBiquadFilter(),
    ];

    const lfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(Math.max(0.01, params.lfoRateHz), audioCtx.currentTime);
    lfo.connect(lfoGain);

    const getFilterTypeString = (typeIdx: number): BiquadFilterType => {
      switch (Math.round(typeIdx)) {
        case 1: return 'highpass';
        case 2: return 'bandpass';
        case 3: return 'notch';
        case 4: return 'lowshelf';
        case 5: return 'highshelf';
        case 0:
        default:
          return 'lowpass';
      }
    };

    const updateFilterChain = () => {
      const typeStr = getFilterTypeString(params.filterType);
      const stages = params.slopeDb <= 12 ? 1 : params.slopeDb <= 24 ? 2 : 4;
      const t = audioCtx.currentTime;

      // Disconnect all
      try {
        inputNode.disconnect(filters[0]);
        for (let i = 0; i < filters.length - 1; i++) {
          filters[i].disconnect();
        }
        filters[filters.length - 1].disconnect();
        lfoGain.disconnect();
      } catch {}

      for (let i = 0; i < filters.length; i++) {
        filters[i].type = typeStr;
        filters[i].frequency.setValueAtTime(params.cutoffHz, t);
        // Only first stage gets full Q to avoid runaway self-oscillation
        filters[i].Q.setValueAtTime(i === 0 ? params.resonance : 0.707, t);
      }

      // Re-connect requested number of stages
      let head: AudioNode = inputNode;
      for (let i = 0; i < stages; i++) {
        head.connect(filters[i]);
        head = filters[i];

        if (params.lfoRateHz > 0 && params.lfoDepth > 0) {
          lfoGain.connect(filters[i].frequency);
        }
      }
      head.connect(trimNode);
      trimNode.connect(wetNode);
      wetNode.connect(outputNode);

      // Update LFO sweep
      if (params.lfoRateHz > 0 && params.lfoDepth > 0) {
        lfo.frequency.setTargetAtTime(params.lfoRateHz, t, 0.02);
        lfoGain.gain.setTargetAtTime(params.cutoffHz * (params.lfoDepth / 100) * 0.8, t, 0.02);
      } else {
        lfoGain.gain.setTargetAtTime(0, t, 0.02);
      }

      const trimLin = Math.pow(10, params.outputTrim / 20);
      trimNode.gain.setValueAtTime(trimLin, t);

      dryNode.gain.setValueAtTime(1.0 - params.dryWet, t);
      wetNode.gain.setValueAtTime(params.dryWet, t);
    };

    updateFilterChain();
    lfo.start();

    let isBypassed = false;

    const setParameter = (paramId: string, value: number) => {
      params[paramId] = value;
      const t = audioCtx.currentTime;

      if (paramId === 'cutoffHz') {
        for (const f of filters) {
          f.frequency.setTargetAtTime(value, t, 0.02);
        }
        if (params.lfoRateHz > 0 && params.lfoDepth > 0) {
          lfoGain.gain.setTargetAtTime(value * (params.lfoDepth / 100) * 0.8, t, 0.02);
        }
      } else if (paramId === 'resonance') {
        filters[0].Q.setTargetAtTime(value, t, 0.02);
      } else if (paramId === 'outputTrim') {
        const lin = Math.pow(10, value / 20);
        trimNode.gain.setTargetAtTime(lin, t, 0.02);
      } else if (paramId === 'dryWet') {
        if (!isBypassed) {
          dryNode.gain.setTargetAtTime(1.0 - value, t, 0.02);
          wetNode.gain.setTargetAtTime(value, t, 0.02);
        }
      } else {
        updateFilterChain();
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
        lfo.stop();
        lfo.disconnect();
        lfoGain.disconnect();
        inputNode.disconnect();
        for (const f of filters) f.disconnect();
        trimNode.disconnect();
        wetNode.disconnect();
        outputNode.disconnect();
      } catch {}
    };

    const getState = async () => ({ ...params });

    return makeNativeInstance({
      instanceId,
      trackId,
      descriptor: MULTIMODE_FILTER_DESCRIPTOR,
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
