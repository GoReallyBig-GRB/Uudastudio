/** Names can't always tell a mixing desk from a microphone (many show up as "USB Audio Device"), so the person can say what a device is, and Uuda remembers. */
import type { DeviceKind } from './deviceWatch';

const KEY = 'uuda_device_kinds';
export const CHOICES: ReadonlyArray<{ kind: DeviceKind; label: string }> = [
  { kind: 'usb', label: 'Microphone' }, { kind: 'interface', label: 'Audio interface' }, { kind: 'mixer', label: 'Mixer' }, { kind: 'deck', label: 'DJ deck or controller' },
];

const read = (): Record<string, DeviceKind> => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown; return v && typeof v === 'object' ? (v as Record<string, DeviceKind>) : {}; } catch { return {}; } };

/** Devices are remembered by name, because the browser changes a device's id between sessions and ports */
export const kindFor = (label: string, detected: DeviceKind): DeviceKind => { const k = read()[label.trim().toLowerCase()]; return CHOICES.some((c) => c.kind === k) ? k : detected; };
export const rememberKind = (label: string, kind: DeviceKind | null): void => {
  try { const all = read(); const key = label.trim().toLowerCase(); if (kind) all[key] = kind; else delete all[key]; localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage blocked: the choice lasts until the sheet closes */ }
};
