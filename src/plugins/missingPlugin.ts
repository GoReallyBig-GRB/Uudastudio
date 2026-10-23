/**
 * Uuda Studio - stand-in for a plugin that cannot be loaded.
 *
 * When a saved project names a plugin that is not installed, not approved or fails to load, the slot is kept as a
 * "Missing" pass-through. Audio flows through unchanged, the rack shows what is missing, and the saved settings are
 * carried along untouched, so saving again (or opening on a machine that has the plugin) loses nothing.
 */

import { PluginDescriptor, PluginInstance, StoredPluginState } from './types';

let counter = 0;

function prettyName(pluginId: string): string {
  const base = pluginId.replace(/^uuda-native-/, '').replace(/[-_]+/g, ' ').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Unknown plugin';
}

export function createMissingPlugin(
  audioCtx: BaseAudioContext,
  trackId: string,
  stored: StoredPluginState,
  reason: string
): PluginInstance {
  const node = audioCtx.createGain(); // unity gain: audio passes straight through
  const descriptor: PluginDescriptor = {
    id: stored.pluginId,
    name: prettyName(stored.pluginId),
    vendor: 'Not available',
    version: '0',
    type: stored.moduleUrl ? 'third-party-wam' : 'native',
    category: 'utility',
    moduleUrl: stored.moduleUrl,
    hasCustomGui: false,
    parameters: {},
  };
  const saved: Record<string, unknown> = { ...(stored.customState || {}), ...(stored.parameters || {}) };
  let bypassed = !!stored.isBypassed;
  let dryWet = typeof stored.dryWet === 'number' ? stored.dryWet : 1;
  counter += 1;

  return {
    instanceId: `missing-${Date.now().toString(36)}-${counter}`,
    trackId,
    descriptor,
    missing: true,
    missingReason: reason,
    get isBypassed() {
      return bypassed;
    },
    set isBypassed(v: boolean) {
      bypassed = !!v;
    },
    get dryWet() {
      return dryWet;
    },
    set dryWet(v: number) {
      if (Number.isFinite(v)) dryWet = v;
    },
    audioNode: node,
    inputNode: node,
    outputNode: node,
    destroy: () => {
      try {
        node.disconnect();
      } catch {
        // already disconnected
      }
    },
    getState: async () => ({ ...saved }),
    setState: async () => undefined,
    setParameter: () => undefined,
    getParameter: (id: string) => (typeof saved[id] === 'number' ? (saved[id] as number) : 0),
  };
}
