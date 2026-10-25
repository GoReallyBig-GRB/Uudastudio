import { describe, expect, it } from 'vitest';
import { getRulerTickConfig } from './timelineRulerScale';

describe('adaptive timeline ruler scale', () => {
  it.each([0.1, 0.5, 1, 5, 10, 30, 80, 200, 500, 1000])(
    'keeps major ticks readable at %s pixels per second',
    (pixelsPerSecond) => {
      const { majorStepSeconds, minorDivisions } = getRulerTickConfig(pixelsPerSecond);
      const spacing = majorStepSeconds * pixelsPerSecond;
      expect(spacing).toBeGreaterThanOrEqual(80 - 1e-8);
      expect(Number.isFinite(majorStepSeconds)).toBe(true);
      expect(majorStepSeconds).toBeGreaterThan(0);
      expect([1, 2, 5]).toContain(minorDivisions);
    }
  );

  it('uses a safe interval for invalid zoom values', () => {
    expect(getRulerTickConfig(Number.NaN).majorStepSeconds).toBe(100);
    expect(getRulerTickConfig(0).majorStepSeconds).toBe(100);
  });

  it('scales major intervals up for long tracks and down when zooming in', () => {
    expect(getRulerTickConfig(5).majorStepSeconds).toBe(20);
    expect(getRulerTickConfig(500).majorStepSeconds).toBe(0.2);
  });
});
