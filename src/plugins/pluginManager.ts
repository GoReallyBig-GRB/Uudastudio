/**
 * Uuda Studio - Plugin Manager & Effects Rack Audio Routing Engine
 * Pure TypeScript audio routing manager for track effect chains.
 * Isolate node routing graph outside React components to avoid audio dropouts.
 */

import { PluginDescriptor, PluginInstance, StoredPluginState } from './types';
import { NATIVE_STEM_PLUGINS, VERIFIED_THIRD_PARTY_PLUGINS, findPluginDescriptor, resolveVerifiedThirdPartyPlugin } from './registry';
import { loadThirdPartyWamPlugin } from './wamHost';
import { createNativePlugin } from './nativeFactories';

export class PluginManager {
  private static instance: PluginManager;

  // Active instances per track: trackId -> PluginInstance[]
  private trackPlugins: Map<string, PluginInstance[]> = new Map();

  // Listeners for UI state synchronizations (rack updates, add/remove/bypass)
  private changeListeners: Set<() => void> = new Set();

  private constructor() {}

  public static getInstance(): PluginManager {
    if (!PluginManager.instance) {
      PluginManager.instance = new PluginManager();
    }
    return PluginManager.instance;
  }

  public subscribe(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private notify() {
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch (err) {
        console.error('PluginManager notify error:', err);
      }
    }
  }

  public getPluginsForTrack(trackId: string): PluginInstance[] {
    return this.trackPlugins.get(trackId) || [];
  }

  public getAllActivePlugins(): PluginInstance[] {
    const all: PluginInstance[] = [];
    for (const instances of this.trackPlugins.values()) {
      all.push(...instances);
    }
    return all;
  }

  /**
   * Instantiates a plugin (Native or WAM 2.0)
   */
  public async instantiatePlugin(
    audioCtx: BaseAudioContext,
    trackId: string,
    descriptor: PluginDescriptor,
    initialState?: Record<string, unknown>
  ): Promise<PluginInstance> {
    if (descriptor.type === 'native') {
      return await createNativePlugin(descriptor.id, audioCtx, trackId, initialState);
    } else {
      // Never load a module URL supplied by project state or callers. Resolve the plugin ID against
      // the built-in catalogue and load only the canonical, reviewed descriptor.
      const trustedDescriptor = resolveVerifiedThirdPartyPlugin(descriptor);
      if (!trustedDescriptor) {
        throw new Error(`Unapproved third-party plugin: ${descriptor.id}`);
      }
      return await loadThirdPartyWamPlugin(audioCtx, trackId, trustedDescriptor, initialState);
    }
  }

  /**
   * Adds a plugin to a track's ordered effect chain
   */
  public async addPluginToTrack(
    audioCtx: BaseAudioContext,
    trackId: string,
    descriptor: PluginDescriptor,
    initialState?: Record<string, unknown>
  ): Promise<PluginInstance> {
    const instance = await this.instantiatePlugin(audioCtx, trackId, descriptor, initialState);
    const current = this.trackPlugins.get(trackId) || [];
    current.push(instance);
    this.trackPlugins.set(trackId, current);

    this.rebuildTrackAudioGraph(trackId);
    this.notify();
    return instance;
  }

  /**
   * Removes a plugin from a track
   */
  public removePluginFromTrack(trackId: string, instanceId: string): void {
    const current = this.trackPlugins.get(trackId) || [];
    const targetIdx = current.findIndex((p) => p.instanceId === instanceId);
    if (targetIdx !== -1) {
      const [removed] = current.splice(targetIdx, 1);
      removed.destroy();
      this.trackPlugins.set(trackId, current);
      this.rebuildTrackAudioGraph(trackId);
      this.notify();
    }
  }

  /**
   * Reorders plugins in a track's effect chain
   */
  public reorderTrackPlugins(trackId: string, fromIndex: number, toIndex: number): void {
    const current = this.trackPlugins.get(trackId) || [];
    if (fromIndex < 0 || fromIndex >= current.length || toIndex < 0 || toIndex >= current.length) {
      return;
    }
    const [moved] = current.splice(fromIndex, 1);
    current.splice(toIndex, 0, moved);
    this.trackPlugins.set(trackId, current);
    this.rebuildTrackAudioGraph(trackId);
    this.notify();
  }

  /**
   * Sets bypass state on a plugin instance
   */
  public setPluginBypass(trackId: string, instanceId: string, isBypassed: boolean): void {
    const current = this.trackPlugins.get(trackId) || [];
    const plugin = current.find((p) => p.instanceId === instanceId);
    if (plugin) {
      plugin.isBypassed = isBypassed;
      this.notify();
    }
  }

  /**
   * Sets dry/wet mix on a plugin instance
   */
  public setPluginDryWet(trackId: string, instanceId: string, dryWet: number): void {
    const current = this.trackPlugins.get(trackId) || [];
    const plugin = current.find((p) => p.instanceId === instanceId);
    if (plugin) {
      plugin.dryWet = dryWet;
      this.notify();
    }
  }

  /**
   * Dispatches parameter update directly to target AudioNode / AudioWorklet port
   * Eliminates React state engine overhead for 60fps high-frequency knobs and sliders
   */
  public setParameterDirect(trackId: string, instanceId: string, paramId: string, value: number): void {
    const current = this.trackPlugins.get(trackId) || [];
    const plugin = current.find((p) => p.instanceId === instanceId);
    if (plugin) {
      plugin.setParameter(paramId, value);
    }
  }

  /**
   * Rebuilds the audio node graph for a specific track:
   * Connects: Chain Input -> Plugin 0 -> Plugin 1 -> ... -> Chain Output
   */
  public connectPluginChain(
    trackId: string,
    sourceNode: AudioNode,
    destinationNode: AudioNode
  ): void {
    const plugins = this.trackPlugins.get(trackId) || [];

    if (plugins.length === 0) {
      try {
        sourceNode.disconnect();
        sourceNode.connect(destinationNode);
      } catch {}
      return;
    }

    try {
      sourceNode.disconnect();
    } catch {}

    // Connect source to first plugin
    sourceNode.connect(plugins[0].inputNode);

    // Connect intermediate plugins in series
    for (let i = 0; i < plugins.length - 1; i++) {
      try {
        plugins[i].outputNode.disconnect();
      } catch {}
      plugins[i].outputNode.connect(plugins[i + 1].inputNode);
    }

    // Connect last plugin to destination
    const lastPlugin = plugins[plugins.length - 1];
    try {
      lastPlugin.outputNode.disconnect();
    } catch {}
    lastPlugin.outputNode.connect(destinationNode);
  }

  private rebuildTrackAudioGraph(trackId: string) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('uuda:rebuild-track-plugins', { detail: { trackId } })
    );
  }

  /**
   * Exports active plugin states for project persistence in IndexedDB / JSON
   */
  public async exportTrackPluginStates(trackId: string): Promise<StoredPluginState[]> {
    const plugins = this.trackPlugins.get(trackId) || [];
    const stored: StoredPluginState[] = [];

    for (const p of plugins) {
      const state = await p.getState();
      const params: Record<string, number> = {};
      for (const [k, v] of Object.entries(state)) {
        if (typeof v === 'number') {
          params[k] = v;
        }
      }

      stored.push({
        instanceId: p.instanceId,
        pluginId: p.descriptor.id,
        isBypassed: p.isBypassed,
        dryWet: p.dryWet,
        parameters: params,
        customState: state,
        moduleUrl: p.descriptor.moduleUrl,
      });
    }

    return stored;
  }

  /**
   * Restores plugins from stored project file
   */
  public async restoreTrackPluginStates(
    audioCtx: BaseAudioContext,
    trackId: string,
    storedStates: StoredPluginState[]
  ): Promise<void> {
    // Clear existing instances on track
    const existing = this.trackPlugins.get(trackId) || [];
    for (const p of existing) {
      p.destroy();
    }
    this.trackPlugins.set(trackId, []);

    for (const stored of storedStates) {
      const descriptor =
        findPluginDescriptor(stored.pluginId) ||
        (stored.moduleUrl
          ? {
              id: stored.pluginId,
              name: stored.pluginId,
              vendor: 'Third-Party',
              version: '1.0.0',
              type: 'third-party-wam' as const,
              category: 'utility' as const,
              moduleUrl: stored.moduleUrl,
              hasCustomGui: false,
              parameters: {},
            }
          : undefined);

      if (descriptor) {
        try {
          const instance = await this.instantiatePlugin(
            audioCtx,
            trackId,
            descriptor,
            stored.parameters || stored.customState
          );
          instance.isBypassed = stored.isBypassed;
          instance.dryWet = stored.dryWet;
          const current = this.trackPlugins.get(trackId) || [];
          current.push(instance);
          this.trackPlugins.set(trackId, current);
        } catch (err) {
          console.warn(`Failed to restore plugin ${stored.pluginId}:`, err);
        }
      }
    }

    this.rebuildTrackAudioGraph(trackId);
    this.notify();
  }

  /** Destroys every plugin on one track (used when the track itself is deleted) */
  public clearTrack(trackId: string): void {
    const instances = this.trackPlugins.get(trackId);
    if (!instances) return;
    for (const p of instances) p.destroy();
    this.trackPlugins.delete(trackId);
    this.rebuildTrackAudioGraph(trackId);
    this.notify();
  }

  public clearAll(): void {
    for (const instances of this.trackPlugins.values()) {
      for (const p of instances) {
        p.destroy();
      }
    }
    this.trackPlugins.clear();
    this.notify();
  }
}

/** Pseudo track id for the master bus chain: effects here process the whole mix after every track is summed */
export const MASTER_TRACK_ID = '__master__';

export const pluginManager = PluginManager.getInstance();
