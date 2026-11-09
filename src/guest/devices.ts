/** Listing and describing the microphones a browser offers. Labels only appear after the person has allowed the microphone once. */

export interface MicInfo { id: string; label: string; bluetooth: boolean }

/** Bluetooth headsets record at phone-call quality (about 16 kHz), so the page warns about them */
export const isBluetoothLabel = (label: string): boolean => /bluetooth|airpods|buds|hands-?free|\bhfp\b|\bsco\b/i.test(label);

export const toMicInfo = (d: { deviceId: string; label: string }, index: number): MicInfo => ({
  id: d.deviceId,
  label: d.label.trim() || `Microphone ${index + 1}`,
  bluetooth: isBluetoothLabel(d.label),
});

export const listMics = async (): Promise<MicInfo[]> => {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    // "default" and "communications" are aliases of a real device; showing them as well makes the list confusing. Before the microphone is allowed the browser gives entries with no id, which cannot be chosen, so they are left out.
    return all.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications' && d.deviceId !== 'default').map(toMicInfo);
  } catch { return []; }
};
