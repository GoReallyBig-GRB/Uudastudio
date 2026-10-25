import { describe, expect, it } from 'vitest';
import { calculateZoomScrollLeft } from './timelineZoom';

describe('timeline zoom anchoring', () => {
  it('keeps time zero fixed and expands only to the right when zooming in', () => {
    const result = calculateZoomScrollLeft({
      scrollLeft: 0,
      viewportWidth: 800,
      headerWidth: 272,
      previousZoom: 2,
      nextZoom: 4,
      maxScrollLeft: 5000,
    });
    expect(result).toBe(0);
  });

  it('preserves the time at the left edge of the visible timeline while zooming', () => {
    const scrollLeft = 900;
    const previousZoom = 2;
    const nextZoom = 4;
    const result = calculateZoomScrollLeft({
      scrollLeft,
      viewportWidth: 1000,
      headerWidth: 272,
      previousZoom,
      nextZoom,
      maxScrollLeft: 5000,
    });
    expect(result / nextZoom).toBeCloseTo(scrollLeft / previousZoom, 10);
    expect(result).toBe(1800);
  });

  it('uses the same left-edge anchor with expanded and collapsed controllers', () => {
    const makeInput = (headerWidth: number) => ({
      scrollLeft: 900,
      viewportWidth: 1000,
      headerWidth,
      previousZoom: 2,
      nextZoom: 4,
      maxScrollLeft: 5000,
    });
    expect(calculateZoomScrollLeft(makeInput(32))).toBe(1800);
    expect(calculateZoomScrollLeft(makeInput(272))).toBe(1800);
  });

  it('clamps zoom-out offsets to the browser scroll range', () => {
    const result = calculateZoomScrollLeft({
      scrollLeft: 9000,
      viewportWidth: 1000,
      headerWidth: 240,
      previousZoom: 10,
      nextZoom: 0.2,
      maxScrollLeft: 150,
    });
    expect(result).toBe(150);
  });

  it('handles invalid zoom and geometry values without returning NaN', () => {
    const result = calculateZoomScrollLeft({
      scrollLeft: Number.NaN,
      viewportWidth: Number.POSITIVE_INFINITY,
      headerWidth: -20,
      previousZoom: 0,
      nextZoom: Number.NaN,
      maxScrollLeft: Number.NaN,
    });
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBe(0);
  });

  it('never returns a negative scroll offset', () => {
    const result = calculateZoomScrollLeft({
      scrollLeft: -50,
      viewportWidth: 1200,
      headerWidth: 240,
      previousZoom: 4,
      nextZoom: 0.5,
      maxScrollLeft: 1000,
    });
    expect(result).toBe(0);
  });
});
