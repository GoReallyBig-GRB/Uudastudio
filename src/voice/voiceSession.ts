/**
 * X-PRO AUDIO - Shared Voice Session Store
 * Coordinates script, voice selection, model choice, delivery instructions,
 * and the 4 precept slots between VoicePanel (sidebar) and VoiceoverModal (expanded).
 * Synchronizes across components in memory and cross-tab via the storage event.
 */

import { useSyncExternalStore } from 'react';

export interface CustomPrecept {
  id: string;
  title: string;
  instruction: string;
}

export interface VoiceSessionState {
  script: string;
  deliveryInstruction: string;
  selectedVoice: string;
  selectedModel: string;
  customPrecepts: (CustomPrecept | null)[];
}

const PRIMARY_PRECEPTS_KEY = 'uuda_custom_precepts_v2';
const LEGACY_PRECEPTS_KEY = 'uuda_voice_custom_precepts_v2';

const DEFAULT_SCRIPT =
  'Welcome to Uuda Studio. High-fidelity audio recording, multi-track editing, and broadcast-ready loudness mastering.';

function loadAndMigratePrecepts(): (CustomPrecept | null)[] {
  if (typeof window === 'undefined') return [null, null, null, null];

  let primary: (CustomPrecept | null)[] = [null, null, null, null];
  try {
    const raw = localStorage.getItem(PRIMARY_PRECEPTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length === 4) {
        primary = parsed;
      }
    }
  } catch {}

  // One-time migration from legacy key
  try {
    const legacyRaw = localStorage.getItem(LEGACY_PRECEPTS_KEY);
    if (legacyRaw) {
      const legacyParsed = JSON.parse(legacyRaw);
      if (Array.isArray(legacyParsed)) {
        let changed = false;
        for (let i = 0; i < 4; i++) {
          if (!primary[i] && legacyParsed[i]) {
            primary[i] = legacyParsed[i];
            changed = true;
          }
        }
        if (changed) {
          localStorage.setItem(PRIMARY_PRECEPTS_KEY, JSON.stringify(primary));
        }
      }
    }
  } catch {}

  return primary;
}

class VoiceSessionStore {
  private state: VoiceSessionState;
  private listeners = new Set<() => void>();

  constructor() {
    this.state = {
      script: DEFAULT_SCRIPT,
      deliveryInstruction: '',
      selectedVoice: 'Zephyr',
      selectedModel: 'gemini-3.8-flash-tts',
      customPrecepts: loadAndMigratePrecepts(),
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === PRIMARY_PRECEPTS_KEY) {
          try {
            const updated = e.newValue ? JSON.parse(e.newValue) : [null, null, null, null];
            if (Array.isArray(updated) && updated.length === 4) {
              this.state = { ...this.state, customPrecepts: updated };
              this.notify();
            }
          } catch {}
        }
      });
    }
  }

  public getSnapshot = (): VoiceSessionState => {
    return this.state;
  };

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  public setScript(script: string) {
    if (this.state.script === script) return;
    this.state = { ...this.state, script };
    this.notify();
  }

  public setDeliveryInstruction(deliveryInstruction: string) {
    if (this.state.deliveryInstruction === deliveryInstruction) return;
    this.state = { ...this.state, deliveryInstruction };
    this.notify();
  }

  public setSelectedVoice(selectedVoice: string) {
    if (this.state.selectedVoice === selectedVoice) return;
    this.state = { ...this.state, selectedVoice };
    this.notify();
  }

  public setSelectedModel(selectedModel: string) {
    if (this.state.selectedModel === selectedModel) return;
    this.state = { ...this.state, selectedModel };
    this.notify();
  }

  public savePrecept(slotIndex: number, precept: CustomPrecept) {
    if (slotIndex < 0 || slotIndex >= 4) return;
    const nextPrecepts = [...this.state.customPrecepts];
    nextPrecepts[slotIndex] = precept;
    this.state = { ...this.state, customPrecepts: nextPrecepts };
    try {
      localStorage.setItem(PRIMARY_PRECEPTS_KEY, JSON.stringify(nextPrecepts));
    } catch {}
    this.notify();
  }

  public clearPrecept(slotIndex: number) {
    if (slotIndex < 0 || slotIndex >= 4) return;
    const nextPrecepts = [...this.state.customPrecepts];
    nextPrecepts[slotIndex] = null;
    this.state = { ...this.state, customPrecepts: nextPrecepts };
    try {
      localStorage.setItem(PRIMARY_PRECEPTS_KEY, JSON.stringify(nextPrecepts));
    } catch {}
    this.notify();
  }
}

export const voiceSessionStore = new VoiceSessionStore();

export function useVoiceSession() {
  const session = useSyncExternalStore(
    voiceSessionStore.subscribe,
    voiceSessionStore.getSnapshot,
    voiceSessionStore.getSnapshot
  );

  return {
    ...session,
    setScript: (s: string) => voiceSessionStore.setScript(s),
    setDeliveryInstruction: (i: string) => voiceSessionStore.setDeliveryInstruction(i),
    setSelectedVoice: (v: string) => voiceSessionStore.setSelectedVoice(v),
    setSelectedModel: (m: string) => voiceSessionStore.setSelectedModel(m),
    savePrecept: (index: number, precept: CustomPrecept) => voiceSessionStore.savePrecept(index, precept),
    clearPrecept: (index: number) => voiceSessionStore.clearPrecept(index),
  };
}
