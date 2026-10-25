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
