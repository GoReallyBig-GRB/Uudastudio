/** Grabbing and dragging the ends of a clip to trim or extend it. Pure maths, so it can be tested without a browser. */
import type { Clip } from '../types';
import type { Seams } from './spliceChains';

export const MIN_CLIP_SECONDS = 0.05;

/** How far from a clip end (in px) a press still grabs it. Wider on touch; never more than a third of a short clip. */
export const edgeZonePx = (clipWidthPx: number, coarsePointer = false): number => {
  const wanted = coarsePointer ? 18 : 10;
  return Math.max(4, Math.min(wanted, clipWidthPx / 3));
};

export interface EdgeHit { clipId: string; edge: 'left' | 'right'; distance: number }

/**
 * The clip end nearest the pointer, if one is close enough. Ends that touch a neighbouring piece of the same clip are
 * skipped (they are joins, not ends). The nearest end wins, so a neighbour's body or a longer clip next door cannot
 * steal the press.
 */
export const pickEdge = (
  clips: readonly Clip[],
  seams: ReadonlyMap<string, Seams>,
  x: number,
  pixelsPerSecond: number,
  coarsePointer = false,
): EdgeHit | null => {
  let best: EdgeHit | null = null;
  for (const c of clips) {
    const s = seams.get(c.id);
    const left = c.startSeconds * pixelsPerSecond;
    const right = (c.startSeconds + c.durationSeconds) * pixelsPerSecond;
    const zone = edgeZonePx(right - left, coarsePointer);
    if (!s?.left) {
      const d = Math.abs(x - left);
      if (d <= zone && (!best || d < best.distance)) best = { clipId: c.id, edge: 'left', distance: d };
    }
    if (!s?.right) {
      const d = Math.abs(x - right);
      if (d <= zone && (!best || d < best.distance)) best = { clipId: c.id, edge: 'right', distance: d };
    }
  }
  return best;
};

export interface TrimStart { startSeconds: number; offsetSeconds: number; durationSeconds: number }

/**
 * Where a clip lands when its end is dragged by `dt` seconds (right is positive). Both directions work: inward cuts the
 * clip shorter, outward brings back audio that was trimmed away, up to the start or end of the source and never before 0.
 * `sourceSeconds` is the length of the source audio; when it is unknown the right end cannot grow. `bounds` keeps an extended end
 * from running into the neighbouring clip on the same track.
 */
export interface TrimBounds { /** End of the clip before this one on the track (0 if none) */ minStart: number; /** Start of the clip after this one (Infinity if none) */ maxEnd: number }

export const trimEdge = (edge: 'left' | 'right', dt: number, init: TrimStart, sourceSeconds: number | null, bounds: TrimBounds = { minStart: 0, maxEnd: Infinity }): TrimStart => {
  const { startSeconds, offsetSeconds, durationSeconds } = init;
  if (edge === 'left') {
    const lo = -Math.min(offsetSeconds, Math.max(0, startSeconds - bounds.minStart));
    const hi = durationSeconds - MIN_CLIP_SECONDS;
    const d = Math.min(hi, Math.max(lo, dt));
    return { startSeconds: startSeconds + d, offsetSeconds: offsetSeconds + d, durationSeconds: durationSeconds - d };
  }
  const sourceRoom = sourceSeconds == null ? 0 : Math.max(0, sourceSeconds - (offsetSeconds + durationSeconds));
  const room = Math.min(sourceRoom, Math.max(0, bounds.maxEnd - (startSeconds + durationSeconds)));
  const d = Math.min(room, Math.max(-(durationSeconds - MIN_CLIP_SECONDS), dt));
  return { startSeconds, offsetSeconds, durationSeconds: durationSeconds + d };
};
