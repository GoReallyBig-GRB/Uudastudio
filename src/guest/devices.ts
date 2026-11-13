/** Listing and describing the microphones a browser offers. Labels only appear after the person has allowed the microphone once. */

import { isAlias, systemDefaults, withoutDefaultTwin } from '../audio/deviceWatch';

export interface MicInfo { id: string; label: string; bluetooth: boolean }

/** Bluetooth headsets record at phone-call quality (about 16 kHz), so the page warns about them */
export const isBluetoothLabel = (label: string): boolean => /bluetooth|airpods|buds|hands-?free|\bhfp\b|\bsco\b/i.test(label);

export const toMicInfo = (d: { deviceId: string; label: string }, index: number): MicInfo => ({
  id: d.deviceId,
  label: d.label.trim() || `Microphone ${index + 1}`,
  bluetooth: isBluetoothLabel(d.label),
});

/** The microphones to offer, without the browser's "default" aliases, and without the real device the default already points at (it is shown as the default card) */
export const pickMics = (all: ReadonlyArray<{ deviceId: string; kind: string; label: string; groupId?: string }>): { mics: MicInfo[]; defaultLabel: string } => {
  const defaults = systemDefaults(all);
  const real = all
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.kind === 'audioinput' && d.deviceId && !isAlias(d))
    .map(({ d, i }) => ({ ...toMicInfo(d, i), direction: 'input' as const, groupId: d.groupId }));
  const mics = withoutDefaultTwin(real, defaults).map(({ id, label, bluetooth }) => ({ id, label, bluetooth }));
  // When the default is the only microphone the browser shows (common on phones), it keeps its own card, named after the real device
  return { mics, defaultLabel: defaults.input?.label ?? '' };
};

export const listMicState = async (): Promise<{ mics: MicInfo[]; defaultLabel: string }> => {
  try { return pickMics(await navigator.mediaDevices.enumerateDevices()); } catch { return { mics: [], defaultLabel: '' }; }
};
export const listMics = async (): Promise<MicInfo[]> => (await listMicState()).mics;
