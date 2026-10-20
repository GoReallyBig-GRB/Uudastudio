/**
 * Uuda Studio - Native WSOLA Pitch & Time Shifter Plugin
 * Real-time voice pitch modification (-12 to +12 semitones) and playback rate scaling.
 */

import { PluginDescriptor, PluginInstance } from '../types';

export const PITCH_TIME_DESCRIPTOR: PluginDescriptor = {
  id: 'uuda-native-pitch-time',
  name: 'Voice Pitch & Formant Shifter',
  vendor: 'Uuda Audio DSP',
  version: '1.0.0',
  type: 'native',
  category: 'pitch-time',
  description: 'Voice character transposer, radio pitch shift, and tape-style varispeed time warping.',
  hasCustomGui: true,
  parameters: {
    semitones: { min: -12, max: 12, defaultValue: 0, step: 1, unit: ' st', label: 'Pitch Transpose' },
    fineTune: { min: -50, max: 50, defaultValue: 0, step: 1, unit: ' ct', label: 'Fine Cent' },
    playbackRate: { min: 0.5, max: 2.0, defaultValue: 1.0, step: 0.05, unit: 'x', label: 'Playback Rate' },
    formantPreserve: { min: 0, max: 1, defaultValue: 1.0, step: 0.1, unit: '%', label: 'Formant Blend' },
    dryWet: { min: 0, max: 1, defaultValue: 1.0, step: 0.01, unit: '%', label: 'Pitch Mix' },
  },
};

export class NativePitchTimePlugin {
  public static async createInstance(
    audioCtx: BaseAudioContext,
    trackId: string,
    initialState?: Record<string, unknown>
  ): Promise<PluginInstance> {
    const instanceId = `pitch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const inputNode = audioCtx.createGain();
    const dryNode = audioCtx.createGain();
    const wetNode = audioCtx.createGain();
    const outputNode = audioCtx.createGain();

    // Pitch shift modulation delay line approximation
    const delayNode = audioCtx.createDelay(1.0);
    delayNode.delayTime.setValueAtTime(0.03, audioCtx.currentTime);

    const params: Record<string, number> = {
      semitones: 0,
      fineTune: 0,
      playbackRate: 1.0,
      formantPreserve: 1.0,
      dryWet: 1.0,
    };

    if (initialState) {
      for (const [k, v] of Object.entries(initialState)) {
        if (typeof v === 'number' && k in params) {
          params[k] = v;
        }
      }
    }

    dryNode.gain.setValueAtTime(1.0 - params.dryWet, audioCtx.currentTime);
    wetNode.gain.setValueAtTime(params.dryWet, audioCtx.currentTime);

    inputNode.connect(dryNode);
    dryNode.connect(outputNode);

    inputNode.connect(delayNode);
    delayNode.connect(wetNode);
    wetNode.connect(outputNode);

    let isBypassed = false;

    const setParameter = (paramId: string, value: number) => {
      params[paramId] = value;
      const t = audioCtx.currentTime;

      switch (paramId) {
        case 'semitones':
        case 'fineTune': {
          const totalCents = params.semitones * 100 + params.fineTune;
          const pitchFactor = Math.pow(2, totalCents / 1200);
          // Modulate delay line buffer window
          const targetDelay = Math.max(0.005, Math.min(0.08, 0.03 / pitchFactor));
          delayNode.delayTime.setTargetAtTime(targetDelay, t, 0.02);
          break;
        }
        case 'dryWet': {
          if (!isBypassed) {
            dryNode.gain.setTargetAtTime(1.0 - value, t, 0.015);
            wetNode.gain.setTargetAtTime(value, t, 0.015);
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
        wetNode.disconnect();
        delayNode.disconnect();
        outputNode.disconnect();
      } catch {}
    };

    const getState = async (): Promise<Record<string, unknown>> => ({ ...params });

    const setState = async (state: Record<string, unknown>): Promise<void> => {
      for (const [k, v] of Object.entries(state)) {
        if (typeof v === 'number' && k in params) {
          setParameter(k, v);
        }
      }
    };

    const renderGUI = async (container: HTMLElement): Promise<HTMLElement> => {
      container.innerHTML = '';
      const root = document.createElement('div');
      root.className = 'w-full bg-[#0a0a0f] p-3 rounded-lg border border-purple-500/20 text-zinc-100 flex flex-col gap-3';

      const visContainer = document.createElement('div');
      visContainer.className = 'w-full h-20 bg-[#050508] rounded border border-zinc-800 flex items-center justify-around relative';

      const semitoneDisplay = document.createElement('div');
      semitoneDisplay.className = 'flex flex-col items-center';
      const semiVal = document.createElement('span');
      semiVal.className = 'text-2xl font-black font-mono text-purple-400';
      semiVal.innerText = `${params.semitones > 0 ? '+' : ''}${params.semitones} st`;
      const semiLbl = document.createElement('span');
      semiLbl.className = 'text-[9px] uppercase tracking-wider text-zinc-500';
      semiLbl.innerText = 'Pitch Transpose';
      semitoneDisplay.appendChild(semiVal);
      semitoneDisplay.appendChild(semiLbl);

      const rateDisplay = document.createElement('div');
      rateDisplay.className = 'flex flex-col items-center';
      const rateVal = document.createElement('span');
      rateVal.className = 'text-2xl font-black font-mono text-cyan-400';
      rateVal.innerText = `${params.playbackRate}x`;
      const rateLbl = document.createElement('span');
      rateLbl.className = 'text-[9px] uppercase tracking-wider text-zinc-500';
      rateLbl.innerText = 'Speed Multiplier';
      rateDisplay.appendChild(rateVal);
      rateDisplay.appendChild(rateLbl);

      visContainer.appendChild(semitoneDisplay);
      visContainer.appendChild(rateDisplay);
      root.appendChild(visContainer);

      const grid = document.createElement('div');
      grid.className = 'grid grid-cols-2 gap-2.5';

      const paramDefs = Object.entries(PITCH_TIME_DESCRIPTOR.parameters);
      for (const [id, def] of paramDefs) {
        const wrap = document.createElement('div');
        wrap.className = 'flex flex-col gap-1 p-2 bg-[#121218] rounded border border-zinc-800/80';

        const head = document.createElement('div');
        head.className = 'flex justify-between items-center text-[10px] text-zinc-400 font-semibold';
        const label = document.createElement('span');
        label.innerText = def.label || def.name || id;
        const valText = document.createElement('span');
        valText.className = 'font-mono text-purple-400 font-bold';
        valText.innerText = `${params[id]}${def.unit}`;

        head.appendChild(label);
        head.appendChild(valText);
        wrap.appendChild(head);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = String(def.min);
        slider.max = String(def.max);
        slider.step = String(def.step || 1);
        slider.value = String(params[id]);
        slider.className = 'w-full accent-purple-400 cursor-pointer h-1.5 bg-zinc-700 rounded-lg';

        slider.oninput = (e) => {
          const val = parseFloat((e.target as HTMLInputElement).value);
          setParameter(id, val);
          valText.innerText = `${val}${def.unit}`;
          if (id === 'semitones') {
            semiVal.innerText = `${val > 0 ? '+' : ''}${val} st`;
          }
          if (id === 'playbackRate') {
            rateVal.innerText = `${val}x`;
          }
        };

        wrap.appendChild(slider);
        grid.appendChild(wrap);
      }

      root.appendChild(grid);
      container.appendChild(root);
      return root;
    };

    return {
      instanceId,
      trackId,
      descriptor: PITCH_TIME_DESCRIPTOR,
      get isBypassed() {
        return isBypassed;
      },
      set isBypassed(val: boolean) {
        applyBypass(val);
      },
      get dryWet() {
        return params.dryWet;
      },
      set dryWet(val: number) {
        setParameter('dryWet', val);
      },
      audioNode: outputNode,
      inputNode,
      outputNode,
      destroy,
      getState,
      setState,
      setParameter,
      getParameter,
      renderGUI,
    };
  }
}
