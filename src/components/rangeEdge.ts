import { rangeTrackIds, type RangeSelection } from './rangeDelete';

/** How close (screen pixels) a press must be to a highlighted range's edge to grab it */
export const RANGE_EDGE_GRAB_PX = 7;

/** Which edge of the highlighted range a press on `trackId` at `seconds` grabs, or null. The nearer edge wins on a tiny range. */
export const rangeEdgeHit = (sel: RangeSelection | null, trackId: string, seconds: number, pixelsPerSecond: number, grabPx = RANGE_EDGE_GRAB_PX): 'start' | 'end' | null => {
  if (!sel || !rangeTrackIds(sel).includes(trackId) || pixelsPerSecond <= 0) return null;
  const dStart = Math.abs(seconds - sel.startSeconds) * pixelsPerSecond;
  const dEnd = Math.abs(seconds - sel.endSeconds) * pixelsPerSecond;
  if (dStart > grabPx && dEnd > grabPx) return null;
  return dStart <= dEnd ? 'start' : 'end';
};

/** The range after its grabbed edge is dragged to `here`: the other edge stays put, and dragging past it flips the range. Never below 0. */
export const dragRangeEdge = (sel: RangeSelection, grabbed: 'start' | 'end', here: number): RangeSelection => {
  const anchor = grabbed === 'start' ? sel.endSeconds : sel.startSeconds;
  const h = Math.max(0, here);
  return { ...sel, startSeconds: Math.min(anchor, h), endSeconds: Math.max(anchor, h) };
};
