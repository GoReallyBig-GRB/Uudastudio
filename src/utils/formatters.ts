/**
 * X-PRO AUDIO - Time & Measurement Formatters
 */

export function formatTimecode(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);

  const mStr = String(mins).padStart(2, '0');
  const sStr = String(secs).padStart(2, '0');
  const msStr = String(millis).padStart(3, '0');

  return `${mStr}:${sStr}.${msStr}`;
}

export function formatVolumeDb(linearGain: number): string {
  if (linearGain <= 0.0001) return '-inf dB';
  const db = 20 * Math.log10(linearGain);
  const sign = db > 0 ? '+' : '';
  return `${sign}${db.toFixed(1)} dB`;
}

export function formatPan(pan: number): string {
  if (Math.abs(pan) < 0.02) return 'C';
  if (pan < 0) return `L${Math.round(Math.abs(pan) * 100)}`;
  return `R${Math.round(pan * 100)}`;
}

/** Where a track's audio ends: the end of its last clip, in seconds. */
export function trackEndSeconds(clips: ReadonlyArray<{ startSeconds: number; durationSeconds: number }>): number {
  let end = 0;
  for (const c of clips) end = Math.max(end, c.startSeconds + c.durationSeconds);
  return end;
}

/** Hours and minutes only, as short as possible: "1h 27m", "2h", "47m", "<1m". */
export function formatTrackLength(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return '<1m';
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
