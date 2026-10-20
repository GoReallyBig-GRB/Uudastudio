/**
 * Uuda Studio - Native Algorithmic Studio Reverb Plugin
 * Smooth multi-tap diffusion network with damping and decay RT60 controls.
 */

import { PluginDescriptor, PluginInstance } from '../types';

export const REVERB_DESCRIPTOR: PluginDescriptor = {
  id: 'uuda-native-reverb',
  name: 'Studio Chamber Reverb',
  vendor: 'Uuda Audio DSP',
  version: '1.2.0',
  type: 'native',
  category: 'spatial',
  description: 'Rich broadcast plate and hall acoustics with adjustable pre-delay and high damping.',
  hasCustomGui: true,
  parameters: {
    decayTime: { min: 0.3, max: 8.0, defaultValue: 2.2, step: 0.1, unit: 's', label: 'Decay Time (RT60)' },
    preDelay: { min: 0, max: 150, defaultValue: 25, step: 1, unit: 'ms', label: 'Pre-Delay' },
    damping: { min: 1000, max: 16000, defaultValue: 6500, step: 100, unit: 'Hz', label: 'High Damping' },
    roomSize: { min: 0.2, max: 1.5, defaultValue: 1.0, step: 0.05, unit: 'x', label: 'Chamber Size' },
    dryWet: { min: 0, max: 1, defaultValue: 0.25, step: 0.01, unit: '%', label: 'Reverb Mix' },
  },
};

export class NativeReverbPlugin {
  public static async createInstance(
    audioCtx: BaseAudioContext,
    trackId: string,
    initialState?: Record<string, unknown>
  ): Promise<PluginInstance> {
    const instanceId = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const inputNode = audioCtx.createGain();
    const dryNode = audioCtx.createGain();
    const wetNode = audioCtx.createGain();
    const outputNode = audioCtx.createGain();

    const preDelayNode = audioCtx.createDelay(0.5);
    preDelayNode.delayTime.setValueAtTime(0.025, audioCtx.currentTime);

    const convolver = audioCtx.createConvolver();
    const dampFilter = audioCtx.createBiquadFilter();
    dampFilter.type = 'lowpass';
    dampFilter.frequency.setValueAtTime(6500, audioCtx.currentTime);

    const params: Record<string, number> = {
      decayTime: 2.2,
      preDelay: 25,
      damping: 6500,
      roomSize: 1.0,
      dryWet: 0.25,
    };

    if (initialState) {
      for (const [k, v] of Object.entries(initialState)) {
        if (typeof v === 'number' && k in params) {
          params[k] = v;
        }
      }
    }

    // Generate algorithmic impulse response
    const generateImpulse = (decaySec: number, size: number) => {
      const sampleRate = audioCtx.sampleRate || 48000;
      const length = Math.max(1, Math.round(sampleRate * Math.min(8.0, decaySec * size)));
      const impulse = audioCtx.createBuffer(2, length, sampleRate);
      const left = impulse.getChannelData(0);
      const right = impulse.getChannelData(1);

      const decayFactor = -Math.log(1000) / length;

      for (let i = 0; i < length; i++) {
        const envelope = Math.exp(decayFactor * i);
        // Stereo diffused noise burst with early reflections
        const noiseL = (Math.random() * 2 - 1) * envelope;
        const noiseR = (Math.random() * 2 - 1) * envelope;
        left[i] = noiseL;
        right[i] = noiseR;
      }

      convolver.buffer = impulse;
    };

    generateImpulse(params.decayTime, params.roomSize);

    preDelayNode.delayTime.setValueAtTime(params.preDelay / 1000, audioCtx.currentTime);
    dampFilter.frequency.setValueAtTime(params.damping, audioCtx.currentTime);

    dryNode.gain.setValueAtTime(1.0 - params.dryWet, audioCtx.currentTime);
    wetNode.gain.setValueAtTime(params.dryWet, audioCtx.currentTime);

    // Audio Graph:
    // Input -> Dry -> Output
    // Input -> PreDelay -> Convolver -> DampFilter -> Wet -> Output
    inputNode.connect(dryNode);
    dryNode.connect(outputNode);

    inputNode.connect(preDelayNode);
    preDelayNode.connect(convolver);
    convolver.connect(dampFilter);
    dampFilter.connect(wetNode);
    wetNode.connect(outputNode);

    let isBypassed = false;

    const setParameter = (paramId: string, value: number) => {
      params[paramId] = value;
      const t = audioCtx.currentTime;

      switch (paramId) {
        case 'preDelay':
          preDelayNode.delayTime.setTargetAtTime(Math.max(0, value / 1000), t, 0.02);
          break;
        case 'damping':
          dampFilter.frequency.setTargetAtTime(value, t, 0.02);
          break;
        case 'decayTime':
        case 'roomSize':
          // Recompute synthetic impulse response
          generateImpulse(params.decayTime, params.roomSize);
          break;
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
        preDelayNode.disconnect();
        convolver.disconnect();
        dampFilter.disconnect();
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
      root.className = 'w-full bg-[#0a0a0f] p-3 rounded-lg border border-pink-500/20 text-zinc-100 flex flex-col gap-3';

      const visContainer = document.createElement('div');
      visContainer.className = 'w-full h-20 bg-[#050508] rounded border border-zinc-800 flex items-center justify-around relative';

      const decayDisplay = document.createElement('div');
      decayDisplay.className = 'flex flex-col items-center';
      const decayVal = document.createElement('span');
      decayVal.className = 'text-2xl font-black font-mono text-pink-400';
      decayVal.innerText = `${params.decayTime}s`;
      const decayLbl = document.createElement('span');
      decayLbl.className = 'text-[9px] uppercase tracking-wider text-zinc-500';
      decayLbl.innerText = 'Decay Time';
      decayDisplay.appendChild(decayVal);
      decayDisplay.appendChild(decayLbl);

      const mixDisplay = document.createElement('div');
      mixDisplay.className = 'flex flex-col items-center';
      const mixVal = document.createElement('span');
      mixVal.className = 'text-2xl font-black font-mono text-cyan-400';
      mixVal.innerText = `${Math.round(params.dryWet * 100)}%`;
      const mixLbl = document.createElement('span');
      mixLbl.className = 'text-[9px] uppercase tracking-wider text-zinc-500';
      mixLbl.innerText = 'Space Mix';
      mixDisplay.appendChild(mixVal);
      mixDisplay.appendChild(mixLbl);

      visContainer.appendChild(decayDisplay);
      visContainer.appendChild(mixDisplay);
      root.appendChild(visContainer);

      const grid = document.createElement('div');
      grid.className = 'grid grid-cols-2 gap-2.5';

      const paramDefs = Object.entries(REVERB_DESCRIPTOR.parameters);
      for (const [id, def] of paramDefs) {
        const wrap = document.createElement('div');
        wrap.className = 'flex flex-col gap-1 p-2 bg-[#121218] rounded border border-zinc-800/80';

        const head = document.createElement('div');
        head.className = 'flex justify-between items-center text-[10px] text-zinc-400 font-semibold';
        const label = document.createElement('span');
        label.innerText = def.label || def.name || id;
        const valText = document.createElement('span');
        valText.className = 'font-mono text-pink-400 font-bold';
        valText.innerText = `${params[id]}${def.unit}`;

        head.appendChild(label);
        head.appendChild(valText);
        wrap.appendChild(head);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = String(def.min);
        slider.max = String(def.max);
        slider.step = String(def.step || 0.1);
        slider.value = String(params[id]);
        slider.className = 'w-full accent-pink-400 cursor-pointer h-1.5 bg-zinc-700 rounded-lg';

        slider.oninput = (e) => {
          const val = parseFloat((e.target as HTMLInputElement).value);
          setParameter(id, val);
          valText.innerText = `${val}${def.unit}`;
          if (id === 'decayTime') decayVal.innerText = `${val}s`;
          if (id === 'dryWet') mixVal.innerText = `${Math.round(val * 100)}%`;
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
      descriptor: REVERB_DESCRIPTOR,
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
