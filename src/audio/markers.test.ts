import { describe, expect, it } from 'vitest';
import { MARKER_COLORS, markerColor, neighbourMarker, recolorMarker, removeMarker, toggleMarkerAt } from './markers';
import type { Project } from '../types';

const base = { id: 'p', name: 'p', tracks: [], sampleRate: 48000, settings: {} as any } as Project;
let n = 0;
const id = () => `m${++n}`;

describe('markers', () => {
  it('adds in time order with cycling colours', () => {
    let p = toggleMarkerAt(base, 10, id).project;
    p = toggleMarkerAt(p, 2, id).project;
    p = toggleMarkerAt(p, 30, id).project;
    expect(p.markers!.map((m) => m.timeSeconds)).toEqual([2, 10, 30]);
    expect(new Set(p.markers!.map((m) => m.colorIndex)).size).toBe(3);
  });
  it('pressing again at the same spot removes it, and an empty list is dropped', () => {
    const a = toggleMarkerAt(base, 5, id);
    expect(a.added).toBe(true);
    const b = toggleMarkerAt(a.project, 5.02, id);
    expect(b.added).toBe(false);
    expect('markers' in b.project).toBe(false);
  });
  it('a marker a little further away is a new one', () => {
    const a = toggleMarkerAt(base, 5, id).project;
    expect(toggleMarkerAt(a, 5.5, id).project.markers).toHaveLength(2);
  });
  it('never goes below zero; colours wrap', () => {
    const p = toggleMarkerAt(base, -4, id).project;
    expect(p.markers![0].timeSeconds).toBe(0);
    let q = p;
    for (let i = 0; i < MARKER_COLORS.length; i++) q = recolorMarker(q, q.markers![0].id);
    expect(q.markers![0].colorIndex).toBe(p.markers![0].colorIndex);
    expect(markerColor({ id: 'x', timeSeconds: 0, colorIndex: -1 })).toBe(MARKER_COLORS[MARKER_COLORS.length - 1]);
  });
  it('finds the next and previous marker', () => {
    let p = base;
    for (const t of [2, 10, 30]) p = toggleMarkerAt(p, t, id).project;
    expect(neighbourMarker(p, 10, 1)?.timeSeconds).toBe(30);
    expect(neighbourMarker(p, 10, -1)?.timeSeconds).toBe(2);
    expect(neighbourMarker(p, 30, 1)).toBeNull();
    expect(removeMarker(p, p.markers![0].id).markers).toHaveLength(2);
  });
});
