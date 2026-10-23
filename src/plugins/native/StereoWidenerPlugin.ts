/**
 * X-PRO AUDIO - Native Stereo Widener & Mono Maker Plugin
 * Mid/Side stereo imaging processor with bass mono-maker filter for broadcast translation.
 */

import { PluginDescriptor, PluginInstance } from '../types';

export const STEREO_WIDENER_DESCRIPTOR: PluginDescriptor = {
  id: 'uuda-native-widener',
  name: 'Stereo Widener & Mono Maker',
  vendor: 'Uuda Audio DSP',
  version: '1.2.0',
  type: 'native',
  category: 'utility',
  description: 'Mid/Side spatial expander with highpass side filter to ensure mono bass translation.',
  hasCustomGui: false,
  parameters: {
    width: { min: 0, max: 200, defaultValue: 125, step: 5, unit: '%', label: 'Stereo Width' },
    monoBelowHz: { min: 20, max: 400, defaultValue: 120, step: 10, unit: 'Hz', label: 'Mono Below' },
  },
};

export class NativeStereoWidenerPlugin {
  public static async createInstance(
    audioCtx: BaseAudioContext,
    trackId: string,
    initialState?: Record<string, unknown>
  ): Promise<PluginInstance> {
    const instanceId = `wid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const params: Record<string, number> = {
      width: 125,
      monoBelowHz: 120,
    };

    if (initialState) {
      for (const [k, v] of Object.entries(initialState)) {
        if (typeof v === 'number' && k in params) {
          params[k] = v;
        }
      }
    }

    const inputNode = audioCtx.createGain();
    const splitter = audioCtx.createChannelSplitter(2);
    const merger = audioCtx.createChannelMerger(2);
    const outputNode = audioCtx.createGain();

    // M/S Encoding:
    // Mid = (L + R) * 0.5
    // Side = (L - R) * 0.5
    const midSum = audioCtx.createGain();
    const sideDiff = audioCtx.createGain();
    const negR = audioCtx.createGain();
    negR.gain.setValueAtTime(-1.0, audioCtx.currentTime);

    inputNode.connect(splitter);

    // Mid path: L + R -> midSum
    splitter.connect(midSum, 0); // L
    splitter.connect(midSum, 1); // R
    midSum.gain.setValueAtTime(0.5, audioCtx.currentTime);

    // Side path: L - R -> sideDiff
    splitter.connect(sideDiff, 0); // L
    splitter.connect(negR, 1);     // R -> -R
    negR.connect(sideDiff);
    sideDiff.gain.setValueAtTime(0.5, audioCtx.currentTime);

    // Bass Mono-Maker highpass filter on Side channel
    const sideHpFilter = audioCtx.createBiquadFilter();
    sideHpFilter.type = 'highpass';
    sideHpFilter.frequency.setValueAtTime(params.monoBelowHz, audioCtx.currentTime);

    const sideWidthGain = audioCtx.createGain();
    sideWidthGain.gain.setValueAtTime(params.width / 100, audioCtx.currentTime);

    sideDiff.connect(sideHpFilter);
    sideHpFilter.connect(sideWidthGain);

    // M/S Decoding:
    // Out L = Mid + Side
    // Out R = Mid - Side
    const outL = audioCtx.createGain();
    const outR = audioCtx.createGain();
    const negSide = audioCtx.createGain();
    negSide.gain.setValueAtTime(-1.0, audioCtx.currentTime);

    midSum.connect(outL);
    sideWidthGain.connect(outL);

    midSum.connect(outR);
    sideWidthGain.connect(negSide);
    negSide.connect(outR);

    outL.connect(merger, 0, 0);
    outR.connect(merger, 0, 1);
    merger.connect(outputNode);

    let isBypassed = false;

    const setParameter = (paramId: string, value: number) => {
      params[paramId] = value;
      const t = audioCtx.currentTime;

      switch (paramId) {
        case 'width':
          if (!isBypassed) {
            sideWidthGain.gain.setTargetAtTime(value / 100, t, 0.02);
          }
          break;
        case 'monoBelowHz':
          sideHpFilter.frequency.setTargetAtTime(value, t, 0.02);
          break;
      }
    };

    const getParameter = (paramId: string) => params[paramId] ?? 0;

    const applyBypass = (bypassed: boolean) => {
      isBypassed = bypassed;
      const t = audioCtx.currentTime;
      if (bypassed) {
        sideWidthGain.gain.setTargetAtTime(1.0, t, 0.01);
        sideHpFilter.frequency.setTargetAtTime(20, t, 0.01);
      } else {
        sideWidthGain.gain.setTargetAtTime(params.width / 100, t, 0.01);
        sideHpFilter.frequency.setTargetAtTime(params.monoBelowHz, t, 0.01);
      }
    };

    const destroy = () => {
      try {
        inputNode.disconnect();
        splitter.disconnect();
        midSum.disconnect();
        negR.disconnect();
        sideDiff.disconnect();
        sideHpFilter.disconnect();
        sideWidthGain.disconnect();
        negSide.disconnect();
        outL.disconnect();
        outR.disconnect();
        merger.disconnect();
        outputNode.disconnect();
      } catch {}
    };

    const getState = async () => ({ ...params });

    return {
      instanceId,
      descriptor: STEREO_WIDENER_DESCRIPTOR,
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
