/** Pure helper for the Slider, kept separate so it can be unit-tested without a browser. */

/** Filled share of the track, 0 to 100. A zero or inverted range returns 0 instead of NaN. */
export const fillPercent = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value) || !(max > min)) return 0;
  const pct = ((value - min) / (max - min)) * 100;
  return Math.min(100, Math.max(0, pct));
};
