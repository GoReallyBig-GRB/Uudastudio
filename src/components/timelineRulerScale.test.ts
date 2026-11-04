import { describe, expect, it } from 'vitest';
import { getRulerTickConfig, formatRulerLabel } from './timelineRulerScale';

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

describe('formatRulerLabel', () => {
  it('shows m:ss with no decimals on whole-second steps', () => {
    expect(formatRulerLabel(0, 2)).toBe('0:00');
    expect(formatRulerLabel(20, 20)).toBe('0:20');
    expect(formatRulerLabel(60, 20)).toBe('1:00');
    expect(formatRulerLabel(125, 5)).toBe('2:05');
  });
  it('adds hours from one hour', () => {
    expect(formatRulerLabel(3600, 60)).toBe('1:00:00');
    expect(formatRulerLabel(7385, 5)).toBe('2:03:05');
  });
  it('adds only the decimals the step needs', () => {
    expect(formatRulerLabel(1.5, 0.5)).toBe('0:01.5');
    expect(formatRulerLabel(1.25, 0.05)).toBe('0:01.25');
    expect(formatRulerLabel(1.234, 0.002)).toBe('0:01.234');
    expect(formatRulerLabel(0.2, 0.2)).toBe('0:00.2');
  });
  it('never shows a negative or non-finite step badly', () => {
    expect(formatRulerLabel(-3, 1)).toBe('0:00');
    expect(formatRulerLabel(5, NaN)).toBe('0:05');
  });
});
