import { describe, expect, it } from 'vitest';
import { MAX_CANVAS_DEVICE_PX, canvasWindowFor, needsRecentre } from './canvasWindow';

describe('canvasWindowFor', () => {
  it('puts a margin of one view each side of the view', () => {
    const w = canvasWindowFor(5000, 1000, 1);
    expect(w.origin).toBe(4000);
    expect(w.width).toBe(3000);
  });
  it('starts at 0 at the left end', () => {
    expect(canvasWindowFor(300, 1000, 1).origin).toBe(0);
  });
  it('never asks for more device pixels than the limit, and the view always fits', () => {
    for (const [view, dpr] of [[1800, 2], [3800, 2], [3800, 3], [900, 1]] as const) {
      const w = canvasWindowFor(10000, view, dpr);
      expect(w.width * dpr).toBeLessThan(MAX_CANVAS_DEVICE_PX + 1);
      expect(w.origin <= 10000 && w.origin + w.width >= 10000 + view).toBe(true);
    }
  });
  it('does not run past the end of the lane', () => {
    const w = canvasWindowFor(900, 1000, 1, 2500);
    expect(w.origin + w.width).toBeLessThan(2501);
  });
});

describe('needsRecentre', () => {
  const win = canvasWindowFor(5000, 1000, 1);
  it('is quiet while the view stays well inside the canvas', () => {
    expect(needsRecentre(win, 5000, 1000)).toBe(false);
    expect(needsRecentre(win, 5400, 1000)).toBe(false);
    expect(needsRecentre(win, 4600, 1000)).toBe(false);
  });
  it('asks for a new window near either edge, or outside', () => {
    expect(needsRecentre(win, 4010, 1000)).toBe(true);
    expect(needsRecentre(win, 6950, 1000)).toBe(true);
    expect(needsRecentre(win, 100, 1000)).toBe(true);
    expect(needsRecentre(win, 9000, 1000)).toBe(true);
  });
  it('does not keep asking at the very start of the lane', () => {
    const start = canvasWindowFor(0, 1000, 1);
    expect(needsRecentre(start, 0, 1000)).toBe(false);
    expect(needsRecentre(start, 40, 1000)).toBe(false);
  });
});
