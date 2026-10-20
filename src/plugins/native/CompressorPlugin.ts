/**
 * Uuda Studio - Native Broadcast Compressor Plugin
 * Studio VCA/Opto dynamic range compressor with makeup gain, knee curvature, and live GR metering.
 */

import { PluginDescriptor, PluginInstance } from '../types';

export const COMPRESSOR_DESCRIPTOR: PluginDescriptor = {
  id: 'uuda-native-compressor',
  name: 'Studio Pro Compressor',
  vendor: 'Uuda Audio DSP',
  version: '1.2.0',
  type: 'native',
  category: 'dynamics',
  description: 'Precision studio compressor with smooth knee curvature, fast peak catching, and makeup gain.',
  hasCustomGui: true,
  parameters: {
    threshold: { min: -60, max: 0, defaultValue: -18, step: 0.5, unit: 'dB', label: 'Threshold' },
    ratio: { min: 1, max: 20, defaultValue: 4, step: 0.1, unit: ':1', label: 'Ratio' },
    knee: { min: 0, max: 40, defaultValue: 6, step: 1, unit: 'dB', label: 'Knee' },
    attack: { min: 1, max: 200, defaultValue: 10, step: 1, unit: 'ms', label: 'Attack' },
    release: { min: 20, max: 1000, defaultValue: 150, step: 5, unit: 'ms', label: 'Release' },
    makeupGain: { min: 0, max: 24, defaultValue: 3, step: 0.5, unit: 'dB', label: 'Makeup Gain' },
    dryWet: { min: 0, max: 1, defaultValue: 1.0, step: 0.01, unit: '%', label: 'Dry / Wet' },
  },
};

export class NativeCompressorPlugin {
  public static async createInstance(
    audioCtx: BaseAudioContext,
    trackId: string,
    initialState?: Record<string, unknown>
  ): Promise<PluginInstance> {
    const instanceId = `comp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Audio Graph Nodes
    const inputNode = audioCtx.createGain();
    const dryNode = audioCtx.createGain();
    const wetNode = audioCtx.createGain();
    const compressorNode = audioCtx.createDynamicsCompressor();
    const makeupGainNode = audioCtx.createGain();
    const outputNode = audioCtx.createGain();

    // Default parameter values
    const params: Record<string, number> = {
      threshold: -18,
      ratio: 4,
      knee: 6,
      attack: 10,
      release: 150,
      makeupGain: 3,
      dryWet: 1.0,
    };

    if (initialState) {
      for (const [k, v] of Object.entries(initialState)) {
        if (typeof v === 'number' && k in params) {
          params[k] = v;
        }
      }
    }

    // Apply initial params
    compressorNode.threshold.setValueAtTime(params.threshold, audioCtx.currentTime);
    compressorNode.ratio.setValueAtTime(params.ratio, audioCtx.currentTime);
    compressorNode.knee.setValueAtTime(params.knee, audioCtx.currentTime);
    compressorNode.attack.setValueAtTime(params.attack / 1000, audioCtx.currentTime);
    compressorNode.release.setValueAtTime(params.release / 1000, audioCtx.currentTime);

    const makeupLin = Math.pow(10, params.makeupGain / 20);
    makeupGainNode.gain.setValueAtTime(makeupLin, audioCtx.currentTime);

    dryNode.gain.setValueAtTime(1.0 - params.dryWet, audioCtx.currentTime);
    wetNode.gain.setValueAtTime(params.dryWet, audioCtx.currentTime);

    // Node Routing:
    // Input -> Dry -> Output
    // Input -> Compressor -> Makeup -> Wet -> Output
    inputNode.connect(dryNode);
    dryNode.connect(outputNode);

    inputNode.connect(compressorNode);
    compressorNode.connect(makeupGainNode);
    makeupGainNode.connect(wetNode);
    wetNode.connect(outputNode);

    let isBypassed = false;

    const setParameter = (paramId: string, value: number) => {
      params[paramId] = value;
      const t = audioCtx.currentTime;

      switch (paramId) {
        case 'threshold':
          compressorNode.threshold.setTargetAtTime(value, t, 0.015);
          break;
        case 'ratio':
          compressorNode.ratio.setTargetAtTime(value, t, 0.015);
          break;
        case 'knee':
          compressorNode.knee.setTargetAtTime(value, t, 0.015);
          break;
        case 'attack':
          compressorNode.attack.setTargetAtTime(Math.max(0.001, value / 1000), t, 0.015);
          break;
        case 'release':
          compressorNode.release.setTargetAtTime(Math.max(0.01, value / 1000), t, 0.015);
          break;
        case 'makeupGain': {
          const lin = Math.pow(10, value / 20);
          makeupGainNode.gain.setTargetAtTime(lin, t, 0.015);
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
        compressorNode.disconnect();
        makeupGainNode.disconnect();
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

    // Dedicated custom GUI renderer
    const renderGUI = async (container: HTMLElement): Promise<HTMLElement> => {
      container.innerHTML = '';
      const root = document.createElement('div');
      root.className = 'w-full bg-[#0a0a0f] p-3 rounded-lg border border-cyan-500/20 text-zinc-100 flex flex-col gap-3';

      // Metering & Transfer Visualizer
      const visContainer = document.createElement('div');
      visContainer.className = 'w-full h-24 bg-[#050508] rounded border border-zinc-800 flex items-center justify-center relative overflow-hidden';
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 96;
      canvas.className = 'w-full h-full';
      visContainer.appendChild(canvas);

      // Draw transfer curve
      const ctx = canvas.getContext('2d');
      const drawCurve = () => {
        if (!ctx) return;
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        // Grid lines
        ctx.strokeStyle = '#1a1a24';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
          ctx.beginPath();
          ctx.moveTo(0, (h / 4) * i);
          ctx.lineTo(w, (h / 4) * i);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo((w / 4) * i, 0);
          ctx.lineTo((w / 4) * i, h);
          ctx.stroke();
        }

        // 1:1 diagonal guide
        ctx.strokeStyle = '#27273a';
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.lineTo(w, 0);
        ctx.stroke();

        // Compression Transfer Curve
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 6;
        ctx.beginPath();

        const threshX = ((params.threshold + 60) / 60) * w;
        const threshY = h - ((params.threshold + 60) / 60) * h;

        ctx.moveTo(0, h);
        ctx.lineTo(threshX, threshY);

        // Above threshold compressed slope
        const slope = 1 / params.ratio;
        const endX = w;
        const deltaX = endX - threshX;
        const deltaY = deltaX * slope;
        const endY = threshY - deltaY;

        ctx.lineTo(endX, Math.max(0, endY));
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Threshold indicator marker
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(threshX, threshY, 4, 0, Math.PI * 2);
        ctx.fill();
      };

      drawCurve();
      root.appendChild(visContainer);

      // Direct Automation Knobs / Sliders
      const grid = document.createElement('div');
      grid.className = 'grid grid-cols-3 gap-2.5';

      const paramDefs = Object.entries(COMPRESSOR_DESCRIPTOR.parameters);
      for (const [id, def] of paramDefs) {
        const wrap = document.createElement('div');
        wrap.className = 'flex flex-col gap-1 p-2 bg-[#121218] rounded border border-zinc-800/80';

        const head = document.createElement('div');
        head.className = 'flex justify-between items-center text-[10px] text-zinc-400 font-semibold';
        const label = document.createElement('span');
        label.innerText = def.label || def.name || id;
        const valText = document.createElement('span');
        valText.className = 'font-mono text-cyan-400 font-bold';
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
        slider.className = 'w-full accent-cyan-400 cursor-pointer h-1.5 bg-zinc-700 rounded-lg';

        // ZERO-ALLOCATION DIRECT DISPATCH (Thread-safe, avoids React re-renders)
        slider.oninput = (e) => {
          const val = parseFloat((e.target as HTMLInputElement).value);
          setParameter(id, val);
          valText.innerText = `${val}${def.unit}`;
          drawCurve();
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
      descriptor: COMPRESSOR_DESCRIPTOR,
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
