/**
 * Timeline markers: named-by-colour points on the ruler (key M adds one at the playhead). Stored on Project.markers so they
 * save with the project and take part in Undo/Redo. Pure functions; the UI lives in Timeline.
 */
import type { Marker, Project } from '../types';

/** Distinct hues for markers. Cyan and gold are left out: they already mean playhead and Export/Solo/Lock. */
export const MARKER_COLORS = ['#fb7185', '#fb923c', '#a3e635', '#34d399', '#60a5fa', '#a78bfa', '#f472b6'] as const;

/** A press of M within this distance of an existing marker removes it instead of adding another one. */
export const MARKER_TOGGLE_TOLERANCE_SECONDS = 0.05;

export const markersOf = (p: Pick<Project, 'markers'>): Marker[] => p.markers ?? [];

/** The next colour in the cycle, so neighbouring markers differ. */
function nextColorIndex(existing: Marker[]): number {
  return (existing.reduce((m, x) => Math.max(m, x.colorIndex), -1) + 1) % MARKER_COLORS.length;
}

export function markerColor(m: Marker): string {
  return MARKER_COLORS[((m.colorIndex % MARKER_COLORS.length) + MARKER_COLORS.length) % MARKER_COLORS.length];
}

export function findMarkerNear(p: Pick<Project, 'markers'>, seconds: number, tolerance = MARKER_TOGGLE_TOLERANCE_SECONDS): Marker | undefined {
  let best: Marker | undefined;
  for (const m of markersOf(p)) {
    const d = Math.abs(m.timeSeconds - seconds);
    if (d <= tolerance && (!best || d < Math.abs(best.timeSeconds - seconds))) best = m;
  }
  return best;
}

/** Adds a marker, or removes the one already at that spot. */
export function toggleMarkerAt(p: Project, seconds: number, makeId: () => string): { project: Project; added: boolean } {
  const t = Math.max(0, seconds);
  const hit = findMarkerNear(p, t);
  if (hit) return { project: removeMarker(p, hit.id), added: false };
  const list = markersOf(p);
  const marker: Marker = { id: makeId(), timeSeconds: t, colorIndex: nextColorIndex(list) };
  return { project: { ...p, markers: [...list, marker].sort((a, b) => a.timeSeconds - b.timeSeconds) }, added: true };
}

export function removeMarker(p: Project, id: string): Project {
  const rest = markersOf(p).filter((m) => m.id !== id);
  const { markers: _drop, ...others } = p;
  return rest.length ? { ...others, markers: rest } : (others as Project);
}

export function recolorMarker(p: Project, id: string): Project {
  return { ...p, markers: markersOf(p).map((m) => (m.id === id ? { ...m, colorIndex: (m.colorIndex + 1) % MARKER_COLORS.length } : m)) };
}

/** Nearest marker strictly after / before a time, for jumping (null when none). */
export function neighbourMarker(p: Pick<Project, 'markers'>, seconds: number, dir: 1 | -1): Marker | null {
  const eps = 1e-3;
  const list = markersOf(p);
  const cand = dir === 1 ? list.filter((m) => m.timeSeconds > seconds + eps) : list.filter((m) => m.timeSeconds < seconds - eps);
  if (!cand.length) return null;
  return cand.reduce((a, b) => ((dir === 1 ? b.timeSeconds < a.timeSeconds : b.timeSeconds > a.timeSeconds) ? b : a));
}
