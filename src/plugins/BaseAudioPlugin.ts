/**
 * Uuda Studio - Unified Base Audio Plugin Abstract Class
 * Standardized lifecycle interface shared across all Native Web Plugins
 * and sandboxed Web Audio Modules (WAM 2.0).
 */

import { PluginDescriptor, PluginInstance } from './types';

export abstract class BaseAudioPlugin implements PluginInstance {
  public abstract readonly descriptor: PluginDescriptor;
  public abstract readonly instanceId: string;
  public abstract readonly trackId: string;

  public isBypassed: boolean = false;
  public dryWet: number = 1.0;

  public abstract readonly audioNode: AudioNode;
  public abstract readonly inputNode: AudioNode;
  public abstract readonly outputNode: AudioNode;

  /**
   * Initializes plugin audio nodes, worklet processors, or WAM modules.
   */
  public abstract initialize(
    audioContext: BaseAudioContext,
    initialState?: Record<string, unknown>
  ): Promise<void>;

  /**
   * Restores plugin parameters and internal DSP state.
   */
  public abstract loadState(state: Record<string, unknown>): Promise<void>;

  /**
   * Serializes current parameters and internal DSP state for persistence.
   */
  public abstract saveState(): Promise<Record<string, unknown>>;

  /**
   * Connects this plugin into the track's processing audio graph.
   */
  public abstract connectGraph(sourceNode: AudioNode, destinationNode: AudioNode): void;

  /**
   * Renders the custom GUI or builds a high-performance control interface.
   */
  public abstract renderGUI(container: HTMLElement): Promise<HTMLElement | void>;

  /**
   * Tears down nodes, disconnects graph, and terminates worker threads.
   */
  public abstract destroy(): void;

  /**
   * High-frequency zero-allocation parameter dispatch bypassing React re-renders.
   */
  public abstract setParameter(paramId: string, value: number): void;

  /**
   * Retrieves current parameter value.
   */
  public abstract getParameter(paramId: string): number;

  /**
   * PluginInstance compatibility getters/setters
   */
  public async getState(): Promise<Record<string, unknown>> {
    return this.saveState();
  }

  public async setState(state: Record<string, unknown>): Promise<void> {
    return this.loadState(state);
  }
}
