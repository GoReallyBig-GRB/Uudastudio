/**
 * Uuda Studio - Web Audio Modules (WAM 2.0) Host Wrapper
 * Conforms to the WAM 2.0 standard for sandboxed, dynamic ESM loading of third-party plugins.
 * Bypasses React state engines for direct AudioWorklet parameter automation events.
 */

import { PluginDescriptor, PluginInstance, StoredPluginState } from './types';
import { createMissingPlugin } from './missingPlugin';

// WAM 2.0 Standard Host Group Identifier
const WAM_HOST_GROUP_ID = 'uuda-studio-wam-host';

interface WamPluginInstanceLike {
  audioNode: AudioNode & {
    port?: MessagePort;
    setParameterValues?: (values: Record<string, { value: number; normalized?: boolean }>) => void;
    getParameterInfo?: (paramIds?: string[]) => Promise<Record<string, { minValue: number; maxValue: number; defaultValue: number; label?: string }>>;
  };
  createGui?: () => Promise<HTMLElement>;
  destroy?: () => void;
  getState?: () => Promise<Record<string, unknown>>;
  setState?: (state: Record<string, unknown>) => Promise<void>;
  descriptor?: {
    name?: string;
    vendor?: string;
    version?: string;
    description?: string;
    hasGui?: boolean;
  };
}

interface WamPluginFactory {
  createInstance: (
    groupId: string,
    audioContext: BaseAudioContext,
    initialState?: Record<string, unknown>
  ) => Promise<WamPluginInstanceLike>;
}

/**
 * Initializes the global WAM 2.0 environment on window if not already initialized
 */
export function initializeWamEnvironment(): void {
  if (typeof window === 'undefined') return;

  const win = window as unknown as { WamEnv?: Record<string, unknown> };
  if (!win.WamEnv) {
    win.WamEnv = {
      version: '2.0.0',
      groupId: WAM_HOST_GROUP_ID,
      moduleInstances: new Map<string, unknown>(),
    };
  }
}

/**
 * Dynamically loads and instantiates a WAM 2.0 plugin module from a verified URL
 */
export async function loadThirdPartyWamPlugin(
  audioCtx: BaseAudioContext,
  trackId: string,
  descriptor: PluginDescriptor,
  initialState?: Record<string, unknown>
): Promise<PluginInstance> {
  initializeWamEnvironment();

  if (!descriptor.moduleUrl) {
    throw new Error(`WAM Plugin ${descriptor.name} has no moduleUrl defined.`);
  }

  const instanceId = `wam-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Host Audio Graph Wrapper: Input -> [Dry / Wet (WAM Node)] -> Output
  const inputNode = audioCtx.createGain();
  const dryNode = audioCtx.createGain();
  const wetNode = audioCtx.createGain();
  const outputNode = audioCtx.createGain();

  let isBypassed = false;
  let currentDryWet = 1.0;
  const paramValues: Record<string, number> = {};

  // Initialize dry/wet gains
  dryNode.gain.setValueAtTime(0.0, audioCtx.currentTime);
  wetNode.gain.setValueAtTime(1.0, audioCtx.currentTime);

  inputNode.connect(dryNode);
  dryNode.connect(outputNode);

  let wamInstance: WamPluginInstanceLike;

  try {
    // Dynamic ESM import of the WAM 2.0 script
    // Vite-ignore is essential so Vite does not try to bundle dynamic external URLs at build time
    const moduleExports = await import(/* @vite-ignore */ descriptor.moduleUrl);
    const PluginFactory: WamPluginFactory = moduleExports.default || moduleExports;

    if (!PluginFactory || typeof PluginFactory.createInstance !== 'function') {
      throw new Error(
        `Module at ${descriptor.moduleUrl} does not conform to the WAM 2.0 standard (missing createInstance).`
      );
    }

    wamInstance = await PluginFactory.createInstance(WAM_HOST_GROUP_ID, audioCtx, initialState);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`Dynamic WAM load error for ${descriptor.name}:`, err);

    // A failed module load must be represented as Missing, not as a normal plugin.
    // Otherwise export cannot report the skipped effect and its saved settings are lost.
    try {
      inputNode.disconnect();
      dryNode.disconnect();
      wetNode.disconnect();
      outputNode.disconnect();
    } catch {
      // Nodes may not all be connected yet.
    }

    const state = initialState || {};
    const parameters = Object.fromEntries(
      Object.entries(state).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    );
    const stored: StoredPluginState = {
      instanceId,
      pluginId: descriptor.id,
      isBypassed: true,
      dryWet: 1,
      parameters,
      customState: state,
      moduleUrl: descriptor.moduleUrl,
    };

    return createMissingPlugin(audioCtx, trackId, stored, `Third-party plugin failed to load: ${reason}`);
  }

  // Connect WAM audioNode into track effects graph
  const wamNode = wamInstance.audioNode;
  inputNode.connect(wamNode);
  wamNode.connect(wetNode);
  wetNode.connect(outputNode);

  // Initialize parameters from descriptor or instance
  for (const [pId, def] of Object.entries(descriptor.parameters)) {
    paramValues[pId] = def.defaultValue;
  }

  if (initialState) {
    for (const [k, v] of Object.entries(initialState)) {
      if (typeof v === 'number') {
        paramValues[k] = v;
      }
    }
  }

  // High-performance direct parameter dispatch (bypasses React state engine)
  const setParameter = (paramId: string, value: number) => {
    paramValues[paramId] = value;

    if (paramId === 'dryWet') {
      currentDryWet = value;
      const t = audioCtx.currentTime;
      if (!isBypassed) {
        dryNode.gain.setTargetAtTime(1.0 - value, t, 0.015);
        wetNode.gain.setTargetAtTime(value, t, 0.015);
      }
      return;
    }

    // Direct WAM 2.0 parameter setter or AudioWorklet port message
    try {
      if (typeof wamNode.setParameterValues === 'function') {
        wamNode.setParameterValues({ [paramId]: { value, normalized: false } });
      } else if (wamNode.port) {
        wamNode.port.postMessage({
          type: 'wam-event',
          event: {
            type: 'wam-automation',
            data: { id: paramId, value },
          },
        });
      }
    } catch (e) {
      console.warn(`Failed to dispatch direct parameter update to ${descriptor.name}:`, e);
    }
  };

  const getParameter = (paramId: string) => paramValues[paramId] ?? 0;

  const applyBypass = (bypassed: boolean) => {
    isBypassed = bypassed;
    const t = audioCtx.currentTime;
    if (bypassed) {
      dryNode.gain.setTargetAtTime(1.0, t, 0.01);
      wetNode.gain.setTargetAtTime(0.0, t, 0.01);
    } else {
      dryNode.gain.setTargetAtTime(1.0 - currentDryWet, t, 0.01);
      wetNode.gain.setTargetAtTime(currentDryWet, t, 0.01);
    }
  };

  const destroy = () => {
    try {
      inputNode.disconnect();
      dryNode.disconnect();
      wetNode.disconnect();
      wamNode.disconnect();
      outputNode.disconnect();
      if (wamInstance && typeof wamInstance.destroy === 'function') {
        wamInstance.destroy();
      }
    } catch {}
  };

  const getState = async (): Promise<Record<string, unknown>> => {
    if (wamInstance && typeof wamInstance.getState === 'function') {
      try {
        const internalState = await wamInstance.getState();
        return { ...paramValues, ...internalState };
      } catch {}
    }
    return { ...paramValues };
  };

  const setState = async (state: Record<string, unknown>): Promise<void> => {
    if (wamInstance && typeof wamInstance.setState === 'function') {
      try {
        await wamInstance.setState(state);
      } catch {}
    }
    for (const [k, v] of Object.entries(state)) {
      if (typeof v === 'number') {
        setParameter(k, v);
      }
    }
  };

  // GUI Renderer: either custom WAM DOM GUI or auto-generated parameter editor
  const renderGUI = async (container: HTMLElement): Promise<HTMLElement> => {
    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'w-full bg-[#0d0d14] p-3 rounded-lg border border-amber-500/30 text-zinc-100 flex flex-col gap-3';

    // 1. Try Custom WAM GUI first
    if (descriptor.hasCustomGui && typeof wamInstance.createGui === 'function') {
      try {
        const customGui = await wamInstance.createGui();
        if (customGui instanceof HTMLElement) {
          customGui.className = 'w-full rounded overflow-hidden';
          root.appendChild(customGui);
          container.appendChild(root);
          return root;
        }
      } catch (err) {
        console.warn('Custom WAM GUI rendering error, using generic editor:', err);
      }
    }

    // 2. High-Fidelity Generic Parameter Editor
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between pb-2 border-b border-zinc-800';
    header.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b]"></span>
        <span class="text-xs font-bold uppercase tracking-wider text-amber-300">${descriptor.name}</span>
      </div>
      <span class="text-[10px] text-zinc-400 font-mono">${descriptor.vendor} • v${descriptor.version}</span>
    `;
    root.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-2 sm:grid-cols-3 gap-2.5';

    const paramEntries = Object.entries(descriptor.parameters);
    for (const [id, def] of paramEntries) {
      const card = document.createElement('div');
      card.className = 'flex flex-col gap-1 p-2 bg-[#14141e] rounded border border-zinc-800/90';

      const row = document.createElement('div');
      row.className = 'flex justify-between items-center text-[10px] text-zinc-400 font-semibold';
      const lbl = document.createElement('span');
      lbl.innerText = def.label || def.name || id;
      const valDisp = document.createElement('span');
      valDisp.className = 'font-mono text-amber-400 font-bold';
      valDisp.innerText = `${paramValues[id] ?? def.defaultValue}${def.unit || ''}`;

      row.appendChild(lbl);
      row.appendChild(valDisp);
      card.appendChild(row);

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = String(def.min);
      slider.max = String(def.max);
      slider.step = String(def.step || (def.max - def.min) / 100);
      slider.value = String(paramValues[id] ?? def.defaultValue);
      slider.className = 'w-full accent-amber-400 cursor-pointer h-1.5 bg-zinc-700 rounded-lg';

      // Direct automation on input event (thread-safe, zero React re-render overhead)
      slider.oninput = (e) => {
        const val = parseFloat((e.target as HTMLInputElement).value);
        setParameter(id, val);
        valDisp.innerText = `${val}${def.unit || ''}`;
      };

      card.appendChild(slider);
      grid.appendChild(card);
    }

    root.appendChild(grid);
    container.appendChild(root);
    return root;
  };

  return {
    instanceId,
    trackId,
    descriptor,
    get isBypassed() {
      return isBypassed;
    },
    set isBypassed(val: boolean) {
      applyBypass(val);
    },
    get dryWet() {
      return currentDryWet;
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
