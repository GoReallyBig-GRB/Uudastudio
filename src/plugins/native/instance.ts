/**
 * Uuda Studio - builds a PluginInstance from the pieces a native plugin creates.
 *
 * The plugin manager changes bypass and dry/wet by assigning to instance.isBypassed and instance.dryWet,
 * restores saved settings through instance.setState, and wires the chain through audioNode. A plain object with those as
 * fields would silently do nothing, so every native plugin returns its instance through this function.
 */

import { PluginDescriptor, PluginInstance } from '../types';

export interface NativeInstanceParts {
  instanceId: string;
  trackId: string;
  descriptor: PluginDescriptor;
  inputNode: AudioNode;
  outputNode: AudioNode;
  /** Live parameter values. Setting a parameter must go through setParameter. */
  params: Record<string, number>;
  setParameter: (paramId: string, value: number) => void;
  getParameter: (paramId: string) => number;
  applyBypass: (bypassed: boolean) => void;
  destroy: () => void;
  getState: () => Promise<Record<string, unknown>>;
  renderGUI?: (container: HTMLElement) => Promise<HTMLElement | void>;
}

export function makeNativeInstance(p: NativeInstanceParts): PluginInstance {
  let bypassed = false;
  const hasDryWet = 'dryWet' in p.params;

  return {
    instanceId: p.instanceId,
    trackId: p.trackId,
    descriptor: p.descriptor,
    get isBypassed() {
      return bypassed;
    },
    set isBypassed(value: boolean) {
      bypassed = Boolean(value);
      p.applyBypass(bypassed);
    },
    get dryWet() {
      return hasDryWet ? p.params.dryWet : 1;
    },
    set dryWet(value: number) {
      if (hasDryWet && Number.isFinite(value)) p.setParameter('dryWet', value);
    },
    audioNode: p.outputNode,
    inputNode: p.inputNode,
    outputNode: p.outputNode,
    destroy: p.destroy,
    getState: p.getState,
    setState: async (state: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(state)) {
        if (typeof value === 'number' && Number.isFinite(value) && key in p.params) p.setParameter(key, value);
      }
    },
    setParameter: p.setParameter,
    getParameter: p.getParameter,
    renderGUI: p.renderGUI,
  };
}
