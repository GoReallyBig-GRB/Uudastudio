/**
 * Where a dragged selection may land. The whole selection moves as ONE rigid block: one shift in time and one shift in tracks,
 * limited by the tightest clip in it. Clamping each clip on its own (the old behaviour) let the front piece of an edited clip
 * stop at a neighbour or at 0 while the rest kept going, and the clip tore apart.
 *
 * Pure and framework-free so it can be unit-tested.
 */
import type { Track } from '../types';
import { chainIds, expandChains } from './spliceChains';

export interface DragItem {
  id: string;
  trackIndex: number;
  startSeconds: number;
  durationSeconds: number;
}

export interface DragPlan {
  /** Allowed shift in seconds (the requested one, limited by what is in the way) */
  dt: number;
  /** Allowed shift in tracks */
  drow: number;
  /** False when some clip has nowhere to go on its target track; the drag then changes nothing */
  ok: boolean;
}

const EPS = 1e-9;

/** The free gap on a track (between the clips that are not being dragged) that a clip at `start` of length `dur` should sit in. */
function gapFor(obstacles: ReadonlyArray<{ s: number; e: number }>, start: number, dur: number): { lo: number; hi: number } | null {
  const centre = start + dur / 2;
  let lo = 0;
  let hi = Infinity;
  for (const o of obstacles) {
    if (centre >= o.s && centre <= o.e) {
      // Centre is inside an obstacle: take the side it is nearer to
      if (centre - o.s < o.e - centre) hi = o.s; else lo = o.e;
      continue;
    }
    if (o.e <= centre) lo = Math.max(lo, o.e);
    else hi = Math.min(hi, o.s);
  }
  // A gap chosen by the nearer side can still contain another obstacle; tighten with every obstacle on the same side
  for (const o of obstacles) {
    if (o.e <= lo + EPS || o.s >= hi - EPS) continue;
    if (o.s + o.e < 2 * centre) lo = Math.max(lo, o.e); else hi = Math.min(hi, o.s);
  }
  return hi - lo + EPS >= dur ? { lo, hi } : null;
}

export function planDragMove(tracks: readonly Track[], items: readonly DragItem[], requestedDt: number, requestedDrow: number): DragPlan {
  if (items.length === 0) return { dt: 0, drow: 0, ok: true };
  const dragged = new Set(items.map((i) => i.id));
  const minRow = Math.min(...items.map((i) => i.trackIndex));
  const maxRow = Math.max(...items.map((i) => i.trackIndex));
  const drow = Math.max(-minRow, Math.min(tracks.length - 1 - maxRow, requestedDrow)) + 0; // + 0 turns -0 into 0

  // Never before time zero: the earliest clip stops at 0 and everything else stops with it
  let dtMin = -Math.min(...items.map((i) => i.startSeconds));
  let dtMax = Infinity;

  for (const it of items) {
    const target = tracks[it.trackIndex + drow];
    if (!target) return { dt: 0, drow: 0, ok: false };
    const obstacles = target.clips
      .filter((c) => !dragged.has(c.id))
      .map((c) => ({ s: c.startSeconds, e: c.startSeconds + c.durationSeconds }))
      .sort((a, b) => a.s - b.s);
    // On the same track a clip cannot jump over a neighbour: it stays in the gap it is in now. Moved to another track, it
    // takes the gap it would land in.
    const probe = drow === 0 ? it.startSeconds : Math.max(0, it.startSeconds + requestedDt);
    const gap = gapFor(obstacles, probe, it.durationSeconds);
    if (!gap) return { dt: 0, drow: 0, ok: false };
    dtMin = Math.max(dtMin, gap.lo - it.startSeconds);
    if (gap.hi !== Infinity) dtMax = Math.min(dtMax, gap.hi - it.durationSeconds - it.startSeconds);
  }
  if (dtMin > dtMax + EPS) return { dt: 0, drow: 0, ok: false };
  return { dt: Math.max(dtMin, Math.min(dtMax, requestedDt)), drow, ok: true };
}

/**
 * The clips a pointer-down on `clickedId` selects (and then drags). Whatever is picked, the whole of every edited clip
 * (all its joined pieces) and every grouped clip comes with it. Before, a click on an unselected piece picked only that piece,
 * so dragging left the other pieces behind.
 */
export function selectionForPointerDown(tracks: readonly Track[], selected: ReadonlySet<string>, clickedId: string, shift: boolean): Set<string> {
  let picked = new Set(selected);
  if (shift) {
    if (picked.has(clickedId)) for (const id of chainIds(tracks, clickedId)) picked.delete(id);
    else picked.add(clickedId);
  } else if (!picked.has(clickedId)) {
    picked = new Set([clickedId]);
  }
  const groups = new Set<string>();
  for (const t of tracks) for (const c of t.clips) if (picked.has(c.id) && c.groupId) groups.add(c.groupId);
  if (groups.size > 0) for (const t of tracks) for (const c of t.clips) if (c.groupId && groups.has(c.groupId)) picked.add(c.id);
  // Grouped clips can themselves be edited clips: bring in their joined pieces too
  return expandChains(tracks, picked);
}
