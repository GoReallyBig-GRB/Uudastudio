/**
 * The on-clip volume line (the Audition-style "pull the line up or down"): where the line sits inside a clip for a given gain,
 * and the gain for a given position. The scale is -24 dB at the bottom of the clip to +12 dB at the top, so unity gain (0 dB)
 * sits a third of the way down. Pure so it can be unit-tested without a browser.
 */
export const LINE_MIN_DB = -24;
export const LINE_MAX_DB = 12;
export const MAX_CLIP_GAIN = 2.5; // matches the clip toolbar's limit (about +8 dB)

/** 0 = bottom of the clip (silence), 1 = top. */
export function gainToFraction(gain: number): number {
  if (!Number.isFinite(gain) || gain <= 0) return 0;
  const db = 20 * Math.log10(Math.min(gain, MAX_CLIP_GAIN));
  return Math.min(1, Math.max(0, (db - LINE_MIN_DB) / (LINE_MAX_DB - LINE_MIN_DB)));
}

/** Gain for a position (0 bottom .. 1 top). Near 0 dB it snaps to exactly 1.0; at the very bottom it is silent. */
export function fractionToGain(fraction: number): number {
  if (!Number.isFinite(fraction) || fraction <= 0.01) return 0;
  const db = LINE_MIN_DB + Math.min(1, fraction) * (LINE_MAX_DB - LINE_MIN_DB);
  if (Math.abs(db) < 0.4) return 1;
  return Math.min(MAX_CLIP_GAIN, Math.pow(10, db / 20));
}

/** Pixel y of the line inside a clip that starts at clipY and is clipH tall. */
export function gainToY(gain: number, clipY: number, clipH: number): number {
  return clipY + clipH * (1 - gainToFraction(gain));
}

/** Gain for a pointer y inside the same clip. */
export function yToGain(y: number, clipY: number, clipH: number): number {
  return fractionToGain(1 - (y - clipY) / clipH);
}
