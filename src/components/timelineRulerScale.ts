export interface RulerTickConfig {
  majorStepSeconds: number;
  minorDivisions: number;
}

/**
 * Select a 1-2-5 time interval that keeps major ruler ticks at least about
 * 80 CSS pixels apart at every zoom level. This avoids both dense tick carpets
 * and huge, fixed intervals that hide useful detail.
 */
export function getRulerTickConfig(pixelsPerSecond: number): RulerTickConfig {
  const safePixelsPerSecond = Number.isFinite(pixelsPerSecond) && pixelsPerSecond > 0
    ? pixelsPerSecond
    : 1;
  const targetSeconds = 80 / safePixelsPerSecond;
  const magnitude = 10 ** Math.floor(Math.log10(targetSeconds));
  const normalized = targetSeconds / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const majorStepSeconds = multiplier * magnitude;
  const majorSpacingPixels = majorStepSeconds * safePixelsPerSecond;
  const minorDivisions = majorSpacingPixels >= 40 ? 5 : majorSpacingPixels >= 16 ? 2 : 1;
  return { majorStepSeconds, minorDivisions };
}

/**
 * Short ruler label for a time in seconds: m:ss (h:mm:ss from one hour), with only as many decimals as the tick step
 * needs (a 0.5 s step shows tenths, a 0.01 s step shows hundredths). Whole-second steps show no decimals at all.
 */
export function formatRulerLabel(seconds: number, majorStepSeconds: number): string {
  const step = Number.isFinite(majorStepSeconds) && majorStepSeconds > 0 ? majorStepSeconds : 1;
  const decimals = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step) - 1e-9));
  const factor = 10 ** decimals;
  const total = Math.max(0, Math.round(Math.max(0, seconds) * factor) / factor);
  const whole = Math.floor(total);
  const frac = decimals > 0 ? '.' + String(Math.round((total - whole) * factor)).padStart(decimals, '0') : '';
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const sec = whole % 60;
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}${frac}` : `${m}:${ss}${frac}`;
}
