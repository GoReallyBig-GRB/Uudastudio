import { describe, expect, it } from 'vitest';
import { MAX_CLIP_GAIN, fractionToGain, gainToFraction, gainToY, yToGain } from './clipGainLine';

describe('clip gain line', () => {
  it('puts unity gain a third of the way down and silence at the bottom', () => {
    expect(gainToFraction(1)).toBeCloseTo(24 / 36, 5);
    expect(gainToFraction(0)).toBe(0);
    expect(gainToY(0, 4, 72)).toBe(76);
    expect(gainToY(1, 4, 72)).toBeCloseTo(4 + 72 * (1 - 24 / 36), 5);
  });

  it('raising the line raises the gain, never past the limit', () => {
    expect(fractionToGain(0.9)).toBeGreaterThan(fractionToGain(0.7));
    expect(fractionToGain(1)).toBeLessThanOrEqual(MAX_CLIP_GAIN);
  });

  it('snaps to exactly 0 dB near unity and to silence at the bottom', () => {
    expect(fractionToGain(24 / 36 + 0.005)).toBe(1);
    expect(fractionToGain(0)).toBe(0);
    expect(fractionToGain(0.005)).toBe(0);
  });

  it('a gain survives the trip to a pixel and back', () => {
    for (const g of [0.25, 0.5, 1, 1.5, 2]) {
      const y = gainToY(g, 4, 72);
      const back = yToGain(y, 4, 72);
      expect(Math.abs(20 * Math.log10(back / g))).toBeLessThan(0.45); // within the 0 dB snap and rounding
    }
  });

  it('ignores bad numbers', () => {
    expect(gainToFraction(NaN)).toBe(0);
    expect(fractionToGain(NaN)).toBe(0);
  });
});
