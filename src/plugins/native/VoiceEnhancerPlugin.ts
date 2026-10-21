/**
 * Uuda Studio - Native Voice Enhancer
 * One-stop polish for spoken word: low cut, warmth, clarity, air and a gentle high-band exciter.
 * "Amount" scales Warmth, Clarity, Air and Excite together. Total boost stays under about 6 dB at full settings.
 */

import { PluginDescriptor, PluginInstance } from '../types';
import { makeNativeInstance } from './instance';

export const VOICE_ENHANCER_DESCRIPTOR: PluginDescriptor = {
  id: 'uuda-native-voice-enhancer',
  name: 'Voice Enhancer',
  vendor: 'Uuda Audio DSP',
  version: '1.0.0',
  type: 'native',
  category: 'utility',
  description: 'Warmth, clarity, air and subtle harmonic sparkle for voiceover, with a low cut to remove rumble.',
  hasCustomGui: false,
  parameters: {
    amount: { min: 0, max: 1, defaultValue: 0.7, step: 0.01, unit: '%', label: 'Amount (scales the four below)' },
    warmth: { min: 0, max: 1, defaultValue: 0.5, step: 0.01, unit: '%', label: 'Warmth (150 Hz)' },
    clarity: { min: 0, max: 1, defaultValue: 0.6, step: 0.01, unit: '%', label: 'Clarity (3.5 kHz)' },
    air: { min: 0, max: 1, defaultValue: 0.4, step: 0.01, unit: '%', label: 'Air (11 kHz)' },
    excite: { min: 0, max: 1, defaultValue: 0.3, step: 0.01, unit: '%', label: 'Harmonic Excite' },
    lowCut: { min: 20, max: 120, defaultValue: 70, step: 1, unit: 'Hz', label: 'Low Cut' },
    outputTrim: { min: -12, max: 6, defaultValue: -1, step: 0.5, unit: 'dB', label: 'Output Trim' },
    dryWet: { min: 0, max: 1, defaultValue: 1, step: 0.01, unit: '%', label: 'Dry / Wet' },
  },
};

const MAX_WARMTH_DB = 4.5;
const MAX_CLARITY_DB = 4;
const MAX_AIR_DB = 4;
const MAX_EXCITE_GAIN = 0.25;

export class NativeVoiceEnhancerPlugin {
  public static async createInstance(
    audioCtx: BaseAudioContext,
    trackId: string,
    initialState?: Record<string, unknown>
  ): Promise<PluginInstance> {
    const instanceId = `venh-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const params: Record<string, number> = {};
    for (const [key, def] of Object.entries(VOICE_ENHANCER_DESCRIPTOR.parameters)) {
      params[key] = def.defaultValue;
    }
    if (initialState) {
      for (const [k, v] of Object.entries(initialState)) {
        if (typeof v === 'number' && Number.isFinite(v) && k in params) params[k] = v;
      }
    }

    const inputNode = audioCtx.createGain();
    const outputNode = audioCtx.createGain();
    const dryNode = audioCtx.createGain();
    const wetNode = audioCtx.createGain();

    const lowCut = audioCtx.createBiquadFilter();
    lowCut.type = 'highpass';
    lowCut.Q.value = 0.707;

    const warmth = audioCtx.createBiquadFilter();
    warmth.type = 'lowshelf';
    warmth.frequency.value = 150;

    const clarity = audioCtx.createBiquadFilter();
    clarity.type = 'peaking';
    clarity.frequency.value = 3500;
    clarity.Q.value = 0.9;

    const air = audioCtx.createBiquadFilter();
    air.type = 'highshelf';
    air.frequency.value = 11000;

    // Exciter: only the high band is saturated, then blended back in underneath
    const exciteHigh = audioCtx.createBiquadFilter();
    exciteHigh.type = 'highpass';
    exciteHigh.frequency.value = 3000;
    const exciteShaper = audioCtx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i * 2) / (curve.length - 1) - 1;
      curve[i] = Math.tanh(3 * x) / Math.tanh(3);
    }
    exciteShaper.curve = curve;
    exciteShaper.oversample = '2x';
    const exciteGain = audioCtx.createGain();

    const trim = audioCtx.createGain();

    // input -> dry -> output
    inputNode.connect(dryNode);
    dryNode.connect(outputNode);
    // input -> low cut -> warmth -> clarity -> air -> (+ exciter) -> trim -> wet -> output
    inputNode.connect(lowCut);
    lowCut.connect(warmth);
    warmth.connect(clarity);
    clarity.connect(air);
    air.connect(trim);
    air.connect(exciteHigh);
    exciteHigh.connect(exciteShaper);
    exciteShaper.connect(exciteGain);
    exciteGain.connect(trim);
    trim.connect(wetNode);
    wetNode.connect(outputNode);

    let isBypassed = false;

    const apply = (immediate = false) => {
      const t = audioCtx.currentTime;
      const tc = immediate ? 0.001 : 0.02;
      const a = Math.max(0, Math.min(1, params.amount));
      lowCut.frequency.setTargetAtTime(params.lowCut, t, tc);
      warmth.gain.setTargetAtTime(params.warmth * a * MAX_WARMTH_DB, t, tc);
      clarity.gain.setTargetAtTime(params.clarity * a * MAX_CLARITY_DB, t, tc);
      air.gain.setTargetAtTime(params.air * a * MAX_AIR_DB, t, tc);
      exciteGain.gain.setTargetAtTime(params.excite * a * MAX_EXCITE_GAIN, t, tc);
      trim.gain.setTargetAtTime(Math.pow(10, params.outputTrim / 20), t, tc);
      dryNode.gain.setTargetAtTime(isBypassed ? 1 : 1 - params.dryWet, t, tc);
      wetNode.gain.setTargetAtTime(isBypassed ? 0 : params.dryWet, t, tc);
    };
    apply(true);

    const setParameter = (paramId: string, value: number) => {
      if (!(paramId in params) || !Number.isFinite(value)) return;
      params[paramId] = value;
      apply();
    };
    const getParameter = (paramId: string) => params[paramId] ?? 0;
    const applyBypass = (bypassed: boolean) => {
      isBypassed = bypassed;
      apply();
    };
    const destroy = () => {
      try {
        [inputNode, outputNode, dryNode, wetNode, lowCut, warmth, clarity, air, exciteHigh, exciteShaper, exciteGain, trim].forEach(
          (n) => n.disconnect()
        );
      } catch {
        /* already disconnected */
      }
    };
    const getState = async () => ({ ...params });

    return makeNativeInstance({
      instanceId,
      trackId,
      descriptor: VOICE_ENHANCER_DESCRIPTOR,
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
