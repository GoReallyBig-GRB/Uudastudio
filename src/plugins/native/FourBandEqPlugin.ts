/**
 * Uuda Studio - Native 4-Band Broadcast EQ Plugin
 * 4-band precision parametric/shelf equalizer with live frequency response curve plotting.
 */

import { PluginDescriptor, PluginInstance } from '../types';

export const EQ_DESCRIPTOR: PluginDescriptor = {
  id: 'uuda-native-eq',
  name: '4-Band Broadcast EQ',
  vendor: 'Uuda Audio DSP',
  version: '1.3.0',
  type: 'native',
  category: 'eq',
  description: 'Broadcast voice and instrument equalizer with low shelf, dual parametric peaking, and air shelf.',
  hasCustomGui: true,
  parameters: {
    lowShelfGain: { min: -18, max: 18, defaultValue: 0, step: 0.5, unit: 'dB', label: 'Low Shelf (80Hz)' },
    mid1Gain: { min: -18, max: 18, defaultValue: 0, step: 0.5, unit: 'dB', label: 'Low Mid (400Hz)' },
    mid2Gain: { min: -18, max: 18, defaultValue: 1.5, step: 0.5, unit: 'dB', label: 'Presence (2.5kHz)' },
    highShelfGain: { min: -18, max: 18, defaultValue: 1.0, step: 0.5, unit: 'dB', label: 'High Air (8kHz)' },
    mid1Freq: { min: 100, max: 1200, defaultValue: 400, step: 10, unit: 'Hz', label: 'Mid 1 Freq' },
    mid2Freq: { min: 1000, max: 8000, defaultValue: 2500, step: 50, unit: 'Hz', label: 'Mid 2 Freq' },
    dryWet: { min: 0, max: 1, defaultValue: 1.0, step: 0.01, unit: '%', label: 'EQ Mix' },
  },
};

export class NativeFourBandEqPlugin {
  public static async createInstance(
    audioCtx: BaseAudioContext,
    trackId: string,
    initialState?: Record<string, unknown>
  ): Promise<PluginInstance> {
    const instanceId = `eq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const inputNode = audioCtx.createGain();
    const dryNode = audioCtx.createGain();
    const wetNode = audioCtx.createGain();
    const outputNode = audioCtx.createGain();

    // 4 Biquad Filter Nodes in Series
    const lowShelf = audioCtx.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.setValueAtTime(80, audioCtx.currentTime);

    const mid1 = audioCtx.createBiquadFilter();
    mid1.type = 'peaking';
    mid1.frequency.setValueAtTime(400, audioCtx.currentTime);
    mid1.Q.setValueAtTime(1.2, audioCtx.currentTime);

    const mid2 = audioCtx.createBiquadFilter();
    mid2.type = 'peaking';
    mid2.frequency.setValueAtTime(2500, audioCtx.currentTime);
    mid2.Q.setValueAtTime(1.5, audioCtx.currentTime);

    const highShelf = audioCtx.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.setValueAtTime(8000, audioCtx.currentTime);

    const params: Record<string, number> = {
      lowShelfGain: 0,
      mid1Gain: 0,
      mid2Gain: 1.5,
      highShelfGain: 1.0,
      mid1Freq: 400,
      mid2Freq: 2500,
      dryWet: 1.0,
    };

    if (initialState) {
      for (const [k, v] of Object.entries(initialState)) {
        if (typeof v === 'number' && k in params) {
          params[k] = v;
        }
      }
    }

    lowShelf.gain.setValueAtTime(params.lowShelfGain, audioCtx.currentTime);
    mid1.gain.setValueAtTime(params.mid1Gain, audioCtx.currentTime);
    mid1.frequency.setValueAtTime(params.mid1Freq, audioCtx.currentTime);
    mid2.gain.setValueAtTime(params.mid2Gain, audioCtx.currentTime);
    mid2.frequency.setValueAtTime(params.mid2Freq, audioCtx.currentTime);
    highShelf.gain.setValueAtTime(params.highShelfGain, audioCtx.currentTime);

    dryNode.gain.setValueAtTime(1.0 - params.dryWet, audioCtx.currentTime);
    wetNode.gain.setValueAtTime(params.dryWet, audioCtx.currentTime);

    // Audio Graph: Input -> LowShelf -> Mid1 -> Mid2 -> HighShelf -> Wet -> Output
    inputNode.connect(dryNode);
    dryNode.connect(outputNode);

    inputNode.connect(lowShelf);
    lowShelf.connect(mid1);
    mid1.connect(mid2);
    mid2.connect(highShelf);
    highShelf.connect(wetNode);
    wetNode.connect(outputNode);

    let isBypassed = false;

    const setParameter = (paramId: string, value: number) => {
      params[paramId] = value;
      const t = audioCtx.currentTime;

      switch (paramId) {
        case 'lowShelfGain':
          lowShelf.gain.setTargetAtTime(value, t, 0.015);
          break;
        case 'mid1Gain':
          mid1.gain.setTargetAtTime(value, t, 0.015);
          break;
        case 'mid1Freq':
          mid1.frequency.setTargetAtTime(value, t, 0.015);
          break;
        case 'mid2Gain':
          mid2.gain.setTargetAtTime(value, t, 0.015);
          break;
        case 'mid2Freq':
          mid2.frequency.setTargetAtTime(value, t, 0.015);
          break;
        case 'highShelfGain':
          highShelf.gain.setTargetAtTime(value, t, 0.015);
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
        lowShelf.disconnect();
        mid1.disconnect();
        mid2.disconnect();
        highShelf.disconnect();
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
      root.className = 'w-full bg-[#0a0a0f] p-3 rounded-lg border border-indigo-500/20 text-zinc-100 flex flex-col gap-3';

      const visContainer = document.createElement('div');
      visContainer.className = 'w-full h-24 bg-[#050508] rounded border border-zinc-800 flex items-center justify-center relative overflow-hidden';
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 96;
      canvas.className = 'w-full h-full';
      visContainer.appendChild(canvas);

      const ctx = canvas.getContext('2d');
      const drawEqCurve = () => {
        if (!ctx) return;
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        ctx.fillStyle = '#08080d';
        ctx.fillRect(0, 0, w, h);

        // Center 0dB Line
        ctx.strokeStyle = '#27273a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        // Calculate frequency response curve
        const numPoints = 128;
        const freqs = new Float32Array(numPoints);
        for (let i = 0; i < numPoints; i++) {
          // Logarithmic scale 20Hz to 20000Hz
          freqs[i] = 20 * Math.pow(1000, i / (numPoints - 1));
        }

        const magLow = new Float32Array(numPoints);
        const phaseLow = new Float32Array(numPoints);
        const magMid1 = new Float32Array(numPoints);
        const phaseMid1 = new Float32Array(numPoints);
        const magMid2 = new Float32Array(numPoints);
        const phaseMid2 = new Float32Array(numPoints);
        const magHigh = new Float32Array(numPoints);
        const phaseHigh = new Float32Array(numPoints);

        try {
          lowShelf.getFrequencyResponse(freqs, magLow, phaseLow);
          mid1.getFrequencyResponse(freqs, magMid1, phaseMid1);
          mid2.getFrequencyResponse(freqs, magMid2, phaseMid2);
          highShelf.getFrequencyResponse(freqs, magHigh, phaseHigh);
        } catch {}

        ctx.strokeStyle = '#818cf8';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#818cf8';
        ctx.shadowBlur = 6;
        ctx.beginPath();

        for (let i = 0; i < numPoints; i++) {
          const totalMag = magLow[i] * magMid1[i] * magMid2[i] * magHigh[i];
          const db = 20 * Math.log10(Math.max(0.0001, totalMag));
          const x = (i / (numPoints - 1)) * w;
          const y = h / 2 - (db / 24) * (h / 2);

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }

        ctx.stroke();
        ctx.shadowBlur = 0;
      };

      drawEqCurve();
      root.appendChild(visContainer);

      const grid = document.createElement('div');
      grid.className = 'grid grid-cols-3 gap-2.5';

      const paramDefs = Object.entries(EQ_DESCRIPTOR.parameters);
      for (const [id, def] of paramDefs) {
        const wrap = document.createElement('div');
        wrap.className = 'flex flex-col gap-1 p-2 bg-[#121218] rounded border border-zinc-800/80';

        const head = document.createElement('div');
        head.className = 'flex justify-between items-center text-[10px] text-zinc-400 font-semibold';
        const label = document.createElement('span');
        label.innerText = def.label || def.name || id;
        const valText = document.createElement('span');
        valText.className = 'font-mono text-indigo-400 font-bold';
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
        slider.className = 'w-full accent-indigo-400 cursor-pointer h-1.5 bg-zinc-700 rounded-lg';

        slider.oninput = (e) => {
          const val = parseFloat((e.target as HTMLInputElement).value);
          setParameter(id, val);
          valText.innerText = `${val}${def.unit}`;
          drawEqCurve();
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
      descriptor: EQ_DESCRIPTOR,
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
