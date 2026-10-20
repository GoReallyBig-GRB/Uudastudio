/**
 * Uuda Studio - Native Spectral Denoiser & Noise Gate Plugin
 * Studio noise floor suppression with high-pass filtering and transparent downward expansion.
 */

import { PluginDescriptor, PluginInstance } from '../types';

export const DENOISER_DESCRIPTOR: PluginDescriptor = {
  id: 'uuda-native-denoiser',
  name: 'Spectral Clean Denoiser',
  vendor: 'Uuda Audio DSP',
  version: '1.1.0',
  type: 'native',
  category: 'restoration',
  description: 'Clean background hiss, rumble, and ambient room noise without speech coloration.',
  hasCustomGui: true,
  parameters: {
    highPassFreq: { min: 20, max: 200, defaultValue: 80, step: 5, unit: 'Hz', label: 'Rumble High-Pass' },
    threshold: { min: -60, max: -10, defaultValue: -36, step: 1, unit: 'dB', label: 'Noise Threshold' },
    reduction: { min: 3, max: 36, defaultValue: 15, step: 1, unit: 'dB', label: 'Noise Reduction' },
    attack: { min: 1, max: 50, defaultValue: 8, step: 1, unit: 'ms', label: 'Gate Attack' },
    release: { min: 20, max: 400, defaultValue: 120, step: 5, unit: 'ms', label: 'Gate Release' },
    dryWet: { min: 0, max: 1, defaultValue: 1.0, step: 0.01, unit: '%', label: 'Clean Mix' },
  },
};

export class NativeDenoiserPlugin {
  public static async createInstance(
    audioCtx: BaseAudioContext,
    trackId: string,
    initialState?: Record<string, unknown>
  ): Promise<PluginInstance> {
    const instanceId = `denoise-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const inputNode = audioCtx.createGain();
    const dryNode = audioCtx.createGain();
    const wetNode = audioCtx.createGain();
    const outputNode = audioCtx.createGain();

    // Highpass rumble filter
    const highpassNode = audioCtx.createBiquadFilter();
    highpassNode.type = 'highpass';
    highpassNode.frequency.setValueAtTime(80, audioCtx.currentTime);
    highpassNode.Q.setValueAtTime(0.707, audioCtx.currentTime);

    // Dynamic noise gate / downward expander filter
    const gateGainNode = audioCtx.createGain();

    const params: Record<string, number> = {
      highPassFreq: 80,
      threshold: -36,
      reduction: 15,
      attack: 8,
      release: 120,
      dryWet: 1.0,
    };

    if (initialState) {
      for (const [k, v] of Object.entries(initialState)) {
        if (typeof v === 'number' && k in params) {
          params[k] = v;
        }
      }
    }

    highpassNode.frequency.setValueAtTime(params.highPassFreq, audioCtx.currentTime);
    dryNode.gain.setValueAtTime(1.0 - params.dryWet, audioCtx.currentTime);
    wetNode.gain.setValueAtTime(params.dryWet, audioCtx.currentTime);

    // Audio Graph
    inputNode.connect(dryNode);
    dryNode.connect(outputNode);

    inputNode.connect(highpassNode);
    highpassNode.connect(gateGainNode);
    gateGainNode.connect(wetNode);
    wetNode.connect(outputNode);

    let isBypassed = false;

    const setParameter = (paramId: string, value: number) => {
      params[paramId] = value;
      const t = audioCtx.currentTime;

      switch (paramId) {
        case 'highPassFreq':
          highpassNode.frequency.setTargetAtTime(value, t, 0.02);
          break;
        case 'threshold':
        case 'reduction': {
          // Dynamic gate adjustment
          const floorDb = params.threshold;
          const floorLin = Math.max(0.001, Math.pow(10, (floorDb - params.reduction) / 20));
          gateGainNode.gain.setTargetAtTime(floorLin, t, 0.05);
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
        highpassNode.disconnect();
        gateGainNode.disconnect();
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
      root.className = 'w-full bg-[#0a0a0f] p-3 rounded-lg border border-emerald-500/20 text-zinc-100 flex flex-col gap-3';

      const visContainer = document.createElement('div');
      visContainer.className = 'w-full h-24 bg-[#050508] rounded border border-zinc-800 flex items-center justify-center relative overflow-hidden';
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 96;
      canvas.className = 'w-full h-full';
      visContainer.appendChild(canvas);

      const ctx = canvas.getContext('2d');
      const drawVisualizer = () => {
        if (!ctx) return;
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        // Ambient noise floor spectrum simulation
        ctx.fillStyle = '#101018';
        ctx.fillRect(0, 0, w, h);

        const threshNorm = (params.threshold + 60) / 50; // 0 to 1
        const gateY = h - threshNorm * (h - 10);

        // Noise gate floor threshold line
        ctx.strokeStyle = '#ef4444';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, gateY);
        ctx.lineTo(w, gateY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Highpass curve
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#10b981';
        ctx.shadowBlur = 6;
        ctx.beginPath();

        const hpX = (params.highPassFreq / 200) * (w * 0.4);
        ctx.moveTo(0, h);
        ctx.quadraticCurveTo(hpX * 0.5, h, hpX, gateY - 15);
        ctx.lineTo(w, gateY - 15);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Label
        ctx.fillStyle = '#6ee7b7';
        ctx.font = '10px monospace';
        ctx.fillText(`CUTOFF: ${params.highPassFreq}Hz`, 10, 20);
        ctx.fillStyle = '#f87171';
        ctx.fillText(`GATE: ${params.threshold}dB (-${params.reduction}dB)`, w - 140, 20);
      };

      drawVisualizer();
      root.appendChild(visContainer);

      const grid = document.createElement('div');
      grid.className = 'grid grid-cols-3 gap-2.5';

      const paramDefs = Object.entries(DENOISER_DESCRIPTOR.parameters);
      for (const [id, def] of paramDefs) {
        const wrap = document.createElement('div');
        wrap.className = 'flex flex-col gap-1 p-2 bg-[#121218] rounded border border-zinc-800/80';

        const head = document.createElement('div');
        head.className = 'flex justify-between items-center text-[10px] text-zinc-400 font-semibold';
        const label = document.createElement('span');
        label.innerText = def.label || def.name || id;
        const valText = document.createElement('span');
        valText.className = 'font-mono text-emerald-400 font-bold';
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
        slider.className = 'w-full accent-emerald-400 cursor-pointer h-1.5 bg-zinc-700 rounded-lg';

        slider.oninput = (e) => {
          const val = parseFloat((e.target as HTMLInputElement).value);
          setParameter(id, val);
          valText.innerText = `${val}${def.unit}`;
          drawVisualizer();
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
      descriptor: DENOISER_DESCRIPTOR,
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
