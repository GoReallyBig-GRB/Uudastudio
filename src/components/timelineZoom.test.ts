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
    expect(result).toBe(2680);
  });

  it('preserves the same time at the center of the usable timeline viewport', () => {
    const viewportWidth = 1100;
    const headerWidth = 272;
    const scrollLeft = 1800;
    const previousZoom = 3;
    const nextZoom = 7;
    const usableWidth = viewportWidth - headerWidth;
    const beforeCenterTime = (scrollLeft + usableWidth / 2) / previousZoom;
    const nextScrollLeft = calculateZoomScrollLeft({
      scrollLeft,
      viewportWidth,
      headerWidth,
      previousZoom,
      nextZoom,
      maxScrollLeft: 10000,
    });
    const afterCenterTime = (nextScrollLeft + usableWidth / 2) / nextZoom;
    expect(afterCenterTime).toBeCloseTo(beforeCenterTime, 10);
  });

  it('accounts for the sticky controller width when preserving the zoom anchor', () => {
    const narrowHeader = calculateZoomScrollLeft({
      scrollLeft: 900,
      viewportWidth: 1000,
      headerWidth: 32,
      previousZoom: 2,
      nextZoom: 4,
      maxScrollLeft: 5000,
    });
    const wideHeader = calculateZoomScrollLeft({
      scrollLeft: 900,
      viewportWidth: 1000,
      headerWidth: 272,
      previousZoom: 2,
      nextZoom: 4,
      maxScrollLeft: 5000,
    });
    expect(narrowHeader).toBe(2284);
    expect(wideHeader).toBe(2164);
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
    expect(result).toBe(0);
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
