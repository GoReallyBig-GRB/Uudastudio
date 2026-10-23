import { describe, expect, it } from 'vitest';
import { calculateZoomScrollLeft } from './timelineZoom';

describe('timeline zoom anchoring', () => {
  it('keeps the same timeline time near the viewport center when zooming in', () => {
    const result = calculateZoomScrollLeft({
      scrollLeft: 1200,
      viewportWidth: 800,
      headerWidth: 240,
      previousZoom: 2,
      nextZoom: 4,
      maxScrollLeft: 5000,
    });
    expect(result).toBe(2560);
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

  it('clamps a viewport near the start without allowing negative scroll', () => {
    const result = calculateZoomScrollLeft({
      scrollLeft: 0,
      viewportWidth: 1200,
      headerWidth: 240,
      previousZoom: 4,
      nextZoom: 0.5,
      maxScrollLeft: 0,
    });
    expect(result).toBe(0);
  });
});
