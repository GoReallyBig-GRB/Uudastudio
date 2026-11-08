import { describe, expect, it } from 'vitest';
import { MARKER_COLORS, followClips, markerColor, markerLabel, neighbourMarker, recolorMarker, removeMarker, renameMarker, toggleMarkerAt } from './markers';
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

const withClips = (starts: Record<string, number>, markers?: Project['markers']): Project =>
  ({ ...base, markers, tracks: [{ id: 't1', name: 't', clips: Object.entries(starts).map(([id, startSeconds]) => ({ id, startSeconds, durationSeconds: 5 })) }] } as unknown as Project);

describe('marker names', () => {
  it('names, trims, and clears with a blank', () => {
    let p = toggleMarkerAt(base, 3, id).project;
    const mid = p.markers![0].id;
    p = renameMarker(p, mid, '  Intro  ');
    expect(p.markers![0].name).toBe('Intro');
    expect(markerLabel(p.markers![0], '0:03')).toBe('Intro (0:03)');
    p = renameMarker(p, mid, 'x'.repeat(60));
    expect(p.markers![0].name).toHaveLength(24);
    p = renameMarker(p, mid, '   ');
    expect('name' in p.markers![0]).toBe(false);
    expect(markerLabel(p.markers![0], '0:03')).toBe('0:03');
  });
});

describe('markers follow their clip', () => {
  const markers = [{ id: 'a', timeSeconds: 12, colorIndex: 0, clipId: 'c1' }, { id: 'b', timeSeconds: 40, colorIndex: 1 }];
  it('an attached marker moves by the clip\'s shift, a free one stays', () => {
    const prev = withClips({ c1: 10 }, markers);
    const next = { ...withClips({ c1: 25 }), markers: prev.markers };
    const out = followClips(prev, next);
    expect(out.markers!.find((m) => m.id === 'a')!.timeSeconds).toBe(27);
    expect(out.markers!.find((m) => m.id === 'b')!.timeSeconds).toBe(40);
  });
  it('keeps time order after a move', () => {
    const prev = withClips({ c1: 10 }, markers);
    const next = { ...withClips({ c1: 40 }), markers: prev.markers };
    expect(followClips(prev, next).markers!.map((m) => m.id)).toEqual(['b', 'a']);
  });
  it('a clip that no longer exists frees its marker where it was', () => {
    const prev = withClips({ c1: 10 }, markers);
    const next = { ...withClips({}), markers: prev.markers };
    const a = followClips(prev, next).markers!.find((m) => m.id === 'a')!;
    expect(a.timeSeconds).toBe(12);
    expect('clipId' in a).toBe(false);
  });
  it('never goes below zero, and leaves a change that edited the markers themselves alone', () => {
    const prev = withClips({ c1: 10 }, markers);
    const back = { ...withClips({ c1: 0 }), markers: prev.markers };
    expect(followClips(prev, back).markers!.find((m) => m.id === 'a')!.timeSeconds).toBe(2);
    const far = { ...withClips({ c1: 0 }), markers: [{ id: 'a', timeSeconds: 12, colorIndex: 0, clipId: 'c1' }] };
    expect(followClips(prev, far)).toBe(far);
  });
  it('an unchanged clip changes nothing; a marker added with a clip remembers it', () => {
    const prev = withClips({ c1: 10 }, markers);
    const same = { ...withClips({ c1: 10 }), markers: prev.markers };
    expect(followClips(prev, same)).toBe(same);
    expect(toggleMarkerAt(base, 4, id, 'cx').project.markers![0].clipId).toBe('cx');
  });
});
