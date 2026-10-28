import { describe, expect, it } from 'vitest';
import { fillPercent } from './sliderMath';

describe('slider fill', () => {
  it('maps the value to a percentage of the range', () => {
    expect(fillPercent(0, 0, 100)).toBe(0);
    expect(fillPercent(50, 0, 100)).toBe(50);
    expect(fillPercent(-15, -30, 0)).toBe(50);
  });

  it('clamps values outside the range', () => {
    expect(fillPercent(-5, 0, 10)).toBe(0);
    expect(fillPercent(25, 0, 10)).toBe(100);
  });

  it('returns 0 for an empty, inverted or non-finite input instead of NaN', () => {
    expect(fillPercent(5, 5, 5)).toBe(0);
    expect(fillPercent(5, 10, 0)).toBe(0);
    expect(fillPercent(Number.NaN, 0, 10)).toBe(0);
  });
});
