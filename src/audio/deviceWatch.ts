/**
 * Pure helpers for noticing audio gear: which devices are new, whether the setup changed since last time, and what kind of device a label describes.
 * The browser only gives device names once the microphone has been allowed; before that, entries have no id and are ignored here.
 */

export type DeviceDirection = 'input' | 'output';
export type DeviceKind = 'usb' | 'interface' | 'bluetooth' | 'headphones' | 'builtin';

export interface AudioDevice {
  id: string;
  label: string;
  direction: DeviceDirection;
  kind: DeviceKind;
  /** Browsers give the same physical device the same group id */
  groupId?: string;
}

/** The browser's "default"/"communications" entries are aliases of a real device, not devices of their own */
export const isAlias = (d: { deviceId: string; label: string }): boolean =>
  d.deviceId === 'default' || d.deviceId === 'communications' || /^(default|communications)\b/i.test(d.label.trim());

/** "Default - Internal Microphone (Conexant)" -> "Internal Microphone (Conexant)" */
export const stripDefaultPrefix = (label: string): string => label.trim().replace(/^(default|communications)\s*[-\u2013:]\s*/i, '').trim();

export interface SystemDefault { label: string; groupId: string }
export type SystemDefaults = Partial<Record<DeviceDirection, SystemDefault>>;

/** Which real device the system default currently points at, per direction (the browser lists it as a "default" entry) */
export const systemDefaults = (list: ReadonlyArray<{ deviceId: string; kind: string; label: string; groupId?: string }>): SystemDefaults => {
  const out: SystemDefaults = {};
  for (const d of list) {
    if (d.kind !== 'audioinput' && d.kind !== 'audiooutput') continue;
    if (d.deviceId !== 'default' && !isAlias(d)) continue;
    if (d.deviceId === 'communications') continue;
    const direction: DeviceDirection = d.kind === 'audioinput' ? 'input' : 'output';
    const label = stripDefaultPrefix(d.label);
    if (!out[direction]) out[direction] = { label: /^(microphone|speaker|audio)\b.*device$/i.test(label) || !label ? '' : label, groupId: d.groupId ?? '' };
  }
  return out;
};

/** Drops the real device the system default already points at, so one microphone is not listed twice */
export const withoutDefaultTwin = <T extends { direction: DeviceDirection; groupId?: string }>(devices: readonly T[], defaults: SystemDefaults): T[] =>
  devices.filter((d) => { const def = defaults[d.direction]; return !(def && def.groupId && d.groupId && d.groupId === def.groupId); });

export const kindOf = (label: string, direction: DeviceDirection): DeviceKind => {
  const l = label.toLowerCase();
  if (/bluetooth|airpods|buds|hands-?free|\bhfp\b|\bsco\b/.test(l)) return 'bluetooth';
  if (/scarlett|focusrite|motu|behringer|presonus|steinberg|audient|universal audio|apollo|zoom|mixer|interface|ur\d{2}|umc|xr\d{2}|x32/.test(l)) return 'interface';
  if (direction === 'output' && /headphone|headset|earphone|earbud/.test(l)) return 'headphones';
  if (/usb|samson|rode|røde|yeti|fifine|fduce|shure|audio-technica|at2020|q2u|\bblue\b|hyperx|elgato|wave/.test(l)) return 'usb';
  return 'builtin';
};

export const KIND_TEXT: Record<DeviceKind, string> = {
  usb: 'USB',
  interface: 'Audio interface / mixer',
  bluetooth: 'Bluetooth',
  headphones: 'Headphones',
  builtin: 'Built-in',
};

/** Real, nameable devices from a browser list; aliases ("default", "communications") and id-less entries are dropped */
export const toDevices = (list: ReadonlyArray<{ deviceId: string; kind: string; label: string; groupId?: string }>): AudioDevice[] => {
  const out: AudioDevice[] = [];
  list.forEach((d, i) => {
    if (d.kind !== 'audioinput' && d.kind !== 'audiooutput') return;
    if (!d.deviceId || isAlias(d)) return;
    const direction: DeviceDirection = d.kind === 'audioinput' ? 'input' : 'output';
    const label = d.label.trim() || `${direction === 'input' ? 'Microphone' : 'Speaker'} ${i + 1}`;
    out.push({ id: d.deviceId, label, direction, kind: kindOf(label, direction), groupId: d.groupId });
  });
  return out;
};

/** Devices in `now` that were not in `known` */
export const newDevices = (known: ReadonlySet<string>, now: readonly AudioDevice[]): AudioDevice[] => now.filter((d) => !known.has(d.id));

/** A stable fingerprint of the connected gear, to tell whether the setup changed since the last visit */
export const signature = (devices: readonly AudioDevice[]): string => devices.map((d) => `${d.direction}:${d.id}`).sort().join('|');

/** Whether the setup sheet should open by itself when the app loads */
export const shouldOpenOnLoad = (devices: readonly AudioDevice[], lastSignature: string | null, savedMicId: string): boolean => {
  if (devices.length === 0) return false;
  if (lastSignature === null) return true; // first time on this computer
  if (savedMicId && !devices.some((d) => d.id === savedMicId)) return true; // the mic that was chosen is gone
  return signature(devices) !== lastSignature;
};
