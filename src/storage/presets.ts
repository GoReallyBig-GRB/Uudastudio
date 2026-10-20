/**
 * X-PRO AUDIO - EQ Presets & Recording Settings Persistence
 * Manages 4-band hardware input EQ presets and device preferences.
 */

import { EQPreset, InputEQSettings, RecordingDeviceSettings } from '../types';

const STORAGE_KEY_PRESETS = 'xpro_eq_presets';
const STORAGE_KEY_DEVICE = 'xpro_rec_device_settings';

export const DEFAULT_EQ_SETTINGS: InputEQSettings = {
  lowShelf80Hz: 0,
  peak400Hz: 0,
  peak2500Hz: 0,
  highShelf8000Hz: 0,
  bypassed: false,
};

export const FACTORY_PRESETS: EQPreset[] = [
  {
    id: 'preset-flat',
    name: 'Flat (Clean Reference)',
    settings: {
      lowShelf80Hz: 0,
      peak400Hz: 0,
      peak2500Hz: 0,
      highShelf8000Hz: 0,
      bypassed: false,
    },
    isDefault: true,
  },
  {
    id: 'preset-broadcast-warmth',
    name: 'Broadcast Warmth',
    settings: {
      lowShelf80Hz: 2.5,
      peak400Hz: -1.5,
      peak2500Hz: 2.0,
      highShelf8000Hz: 1.5,
      bypassed: false,
    },
    isDefault: false,
  },
  {
    id: 'preset-voice-presence',
    name: 'Voiceover Presence',
    settings: {
      lowShelf80Hz: -1.0,
      peak400Hz: -2.0,
      peak2500Hz: 3.5,
      highShelf8000Hz: 2.0,
      bypassed: false,
    },
    isDefault: false,
  },
  {
    id: 'preset-air-clarity',
    name: 'Air & Crisp Tops',
    settings: {
      lowShelf80Hz: -2.0,
      peak400Hz: -0.5,
      peak2500Hz: 1.5,
      highShelf8000Hz: 3.5,
      bypassed: false,
    },
    isDefault: false,
  },
];

export function loadEQPresets(): EQPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PRESETS);
    if (!raw) return FACTORY_PRESETS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : FACTORY_PRESETS;
  } catch {
    return FACTORY_PRESETS;
  }
}

export function saveEQPresets(presets: EQPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_PRESETS, JSON.stringify(presets));
  } catch {}
}

export function getDefaultEQPreset(presets: EQPreset[]): EQPreset {
  const def = presets.find((p) => p.isDefault);
  return def || presets[0] || FACTORY_PRESETS[0];
}

export function setDefaultEQPreset(presetId: string, presets: EQPreset[]): EQPreset[] {
  const updated = presets.map((p) => ({
    ...p,
    isDefault: p.id === presetId,
  }));
  saveEQPresets(updated);
  return updated;
}

export function loadRecordingDeviceSettings(): RecordingDeviceSettings {
  const defaultSettings: RecordingDeviceSettings = {
    deviceId: '',
    echoCancellation: false, // Default all OFF for studio quality recording
    noiseSuppression: false,
    autoGainControl: false,
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY_DEVICE);
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return defaultSettings;
  }
}

export function saveRecordingDeviceSettings(settings: RecordingDeviceSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY_DEVICE, JSON.stringify(settings));
  } catch {}
}
