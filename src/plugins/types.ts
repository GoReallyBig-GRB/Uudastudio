/**
 * Uuda Studio - Audio Plugins Framework Types
 * Strict typing for Native Web Plugins and Web Audio Modules (WAM 2.0).
 */

export type PluginType = 'native' | 'third-party-wam';

export type PluginCategory =
  | 'dynamics'
  | 'restoration'
  | 'eq'
  | 'spatial'
  | 'modulation'
  | 'pitch-time'
  | 'utility';

export interface PluginParameterDefinition {
  id: string;
  name: string;
  min: number;
  max: number;
  defaultValue: number;
  step?: number;
  unit?: string;
  label?: string;
}

export interface PluginDescriptor {
  id: string;
  name: string;
  vendor: string;
  version: string;
  type: PluginType;
  category: PluginCategory;
  description?: string;
  moduleUrl?: string;
  hasCustomGui: boolean;
  verified?: boolean;
  parameters: Record<string, { min: number; max: number; defaultValue: number; step?: number; unit?: string; label?: string; name?: string }>;
}

export interface PluginInstance {
  instanceId: string;
  trackId: string;
  descriptor: PluginDescriptor;
  isBypassed: boolean;
  dryWet: number; // 0.0 to 1.0
  audioNode: AudioNode;
  inputNode: AudioNode;
  outputNode: AudioNode;
  guiElement?: HTMLElement | null;
  destroy: () => void;
  getState: () => Promise<Record<string, unknown>>;
  setState: (state: Record<string, unknown>) => Promise<void>;
  setParameter: (paramId: string, value: number) => void;
  getParameter: (paramId: string) => number;
  renderGUI?: (container: HTMLElement) => Promise<HTMLElement | void>;
}

export interface StoredPluginState {
  instanceId: string;
  pluginId: string;
  isBypassed: boolean;
  dryWet: number;
  parameters: Record<string, number>;
  customState?: Record<string, unknown>;
  moduleUrl?: string;
}

export interface BasePlugin {
  descriptor: PluginDescriptor;
  initialize: (audioContext: BaseAudioContext, initialState?: Record<string, unknown>) => Promise<PluginInstance>;
  destroy: () => void;
}
