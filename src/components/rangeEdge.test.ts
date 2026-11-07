import { describe, expect, it } from 'vitest';
import { dragRangeEdge, rangeEdgeHit } from './rangeEdge';
import type { RangeSelection } from './rangeDelete';

const sel: RangeSelection = { trackId: 'a', trackIds: ['a', 'b'], startSeconds: 10, endSeconds: 20 };

describe('range edge', () => {
  it('grabs the start or end edge within a few pixels, on any covered track', () => {
    expect(rangeEdgeHit(sel, 'a', 10.05, 100)).toBe('start');
    expect(rangeEdgeHit(sel, 'b', 19.95, 100)).toBe('end');
    expect(rangeEdgeHit(sel, 'a', 15, 100)).toBeNull();
    expect(rangeEdgeHit(sel, 'c', 10, 100)).toBeNull();
    expect(rangeEdgeHit(null, 'a', 10, 100)).toBeNull();
  });
  it('the pixel distance, not seconds, decides: zoomed out the grab is wider in time', () => {
    expect(rangeEdgeHit(sel, 'a', 10.5, 100)).toBeNull();
    expect(rangeEdgeHit(sel, 'a', 10.5, 10)).toBe('start');
  });
  it('a tiny range gives the press to the nearer edge', () => {
    const tiny = { ...sel, startSeconds: 10, endSeconds: 10.02 };
    expect(rangeEdgeHit(tiny, 'a', 10.015, 100)).toBe('end');
    expect(rangeEdgeHit(tiny, 'a', 10.004, 100)).toBe('start');
  });
  it('dragging an edge keeps the other edge, the tracks and flips past it', () => {
    expect(dragRangeEdge(sel, 'start', 8)).toEqual({ ...sel, startSeconds: 8, endSeconds: 20 });
    expect(dragRangeEdge(sel, 'end', 25)).toEqual({ ...sel, startSeconds: 10, endSeconds: 25 });
    expect(dragRangeEdge(sel, 'start', 30)).toEqual({ ...sel, startSeconds: 20, endSeconds: 30 });
    expect(dragRangeEdge(sel, 'start', -5).startSeconds).toBe(0);
  });
});
