/** Time-left estimate for the shared progress indicator. */
export const MIN_FRACTION_FOR_ESTIMATE = 0.03;

/** Seconds left, assuming the speed so far continues. null while there is too little progress to say. */
export function secondsLeft(elapsedSeconds: number, fraction: number): number | null {
  if (!(fraction > MIN_FRACTION_FOR_ESTIMATE) || fraction >= 1 || elapsedSeconds <= 0) return fraction >= 1 ? 0 : null;
  return (elapsedSeconds * (1 - fraction)) / fraction;
}

/** "45s", "3m 05s", "1h 02m". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

export function clampPercent(fraction: number): number {
  return Math.min(100, Math.max(0, Math.round(fraction * 100)));
}
