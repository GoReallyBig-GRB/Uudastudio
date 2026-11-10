/** What the browser really did with the microphone, as opposed to what the page asked for. Browsers may ignore "processing off". */

/** Newer browsers may report a mode name instead of true/false */
const isOn = (v: unknown): boolean => v === true || (typeof v === 'string' && v !== '' && v !== 'none' && v !== 'false');

export interface CaptureSettings {
  sampleRate?: number;
  channelCount?: number;
  echoCancellation?: boolean | string;
  noiseSuppression?: boolean | string;
  autoGainControl?: boolean | string;
}

export const readSettings = (track: { getSettings?: () => MediaTrackSettings }): CaptureSettings => {
  try {
    const s = track.getSettings?.() ?? {};
    return { sampleRate: s.sampleRate, channelCount: s.channelCount, echoCancellation: s.echoCancellation, noiseSuppression: s.noiseSuppression, autoGainControl: s.autoGainControl };
  } catch { return {}; }
};

/** The browser features that are still switched on after we asked for them off */
export const processingOn = (s: CaptureSettings): string[] => {
  const on: string[] = [];
  if (isOn(s.echoCancellation)) on.push('echo cancellation');
  if (isOn(s.noiseSuppression)) on.push('noise suppression');
  if (isOn(s.autoGainControl)) on.push('automatic gain');
  return on;
};

/** One line for the Send message and the setup result */
export const describeSettings = (s: CaptureSettings, recordedRate: number): string => {
  const on = processingOn(s);
  const rate = s.sampleRate && Math.abs(s.sampleRate - recordedRate) > 1 ? `microphone ${Math.round(s.sampleRate / 100) / 10} kHz, recorded at ${Math.round(recordedRate / 100) / 10} kHz` : `${Math.round(recordedRate / 100) / 10} kHz`;
  return `${rate}; browser processing: ${on.length ? `ON (${on.join(', ')})` : 'off'}`;
};
