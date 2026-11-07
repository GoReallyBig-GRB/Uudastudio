import { describe, expect, it } from 'vitest';
import { planDragMove, type DragItem } from './clipDragPlan';
import type { Clip, Track } from '../types';

const clip = (id: string, trackId: string, start: number, dur: number): Clip =>
  ({ id, trackId, assetId: 'a', name: id, startSeconds: start, offsetSeconds: 0, durationSeconds: dur, gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'linear' }) as Clip;
const track = (id: string, clips: Clip[]): Track => ({ id, name: id, clips, volume: 1, pan: 0, muted: false, solo: false }) as Track;
const item = (c: Clip, trackIndex: number): DragItem => ({ id: c.id, trackIndex, startSeconds: c.startSeconds, durationSeconds: c.durationSeconds });

describe('planDragMove', () => {
  // an edited clip in three joined pieces (10-15, 15-18, 18-30) with a neighbour 40-50 and one 0-5
  const p1 = clip('p1', 'T1', 10, 5), p2 = clip('p2', 'T1', 15, 3), p3 = clip('p3', 'T1', 18, 12);
  const left = clip('L', 'T1', 0, 5), right = clip('R', 'T1', 40, 10);
  const tracks = [track('T1', [left, p1, p2, p3, right]), track('T2', [])];
  const pieces = [item(p1, 0), item(p2, 0), item(p3, 0)];

  it('moves freely when nothing is in the way', () => {
    expect(planDragMove(tracks, pieces, 3, 0)).toEqual({ dt: 3, drow: 0, ok: true });
  });
  it('stops the WHOLE edited clip where its last piece touches the neighbour on the right', () => {
    const r = planDragMove(tracks, pieces, 25, 0);
    expect(r.dt).toBeCloseTo(10); // p3 ends at 30, neighbour starts at 40
  });
  it('stops the whole edited clip where its first piece touches the neighbour on the left', () => {
    const r = planDragMove(tracks, pieces, -20, 0);
    expect(r.dt).toBeCloseTo(-5); // p1 starts at 10, neighbour ends at 5
  });
  it('stops at time zero for everything together', () => {
    const solo = [track('T1', [p1, p2, p3])];
    expect(planDragMove(solo, pieces, -50, 0).dt).toBeCloseTo(-10);
  });
  it('every piece gets the same shift, so joins stay exactly where they were', () => {
    const r = planDragMove(tracks, pieces, 7.123456789, 0);
    const moved = pieces.map((i) => i.startSeconds + r.dt);
    expect(moved[1] - (moved[0] + pieces[0].durationSeconds)).toBeCloseTo(0, 9);
    expect(moved[2] - (moved[1] + pieces[1].durationSeconds)).toBeCloseTo(0, 9);
  });
  it('moves the block to another track as one, and refuses when it does not fit there', () => {
    expect(planDragMove(tracks, pieces, 0, 1)).toEqual({ dt: 0, drow: 1, ok: true });
    const inTheWay = [track('T1', [p1, p2, p3]), track('T2', [clip('X', 'T2', 12, 4)])];
    expect(planDragMove(inTheWay, pieces, 0, 1).ok).toBe(false); // the 20 s block would sit on top of X
    const clear = [track('T1', [p1, p2, p3]), track('T2', [clip('X', 'T2', 60, 4)])];
    expect(planDragMove(clear, pieces, 0, 1).ok).toBe(true);
  });
  it('limits the track shift so no piece leaves the track list', () => {
    expect(planDragMove(tracks, pieces, 0, 5).drow).toBe(1);
    expect(planDragMove(tracks, pieces, 0, -5).drow).toBe(0);
  });
  it('two separate clips keep their spacing when one is blocked', () => {
    const a = clip('a', 'T1', 0, 4), b = clip('b', 'T1', 10, 4), wall = clip('w', 'T1', 20, 5);
    const t = [track('T1', [a, b, wall])];
    const r = planDragMove(t, [item(a, 0), item(b, 0)], 30, 0);
    expect(r.dt).toBeCloseTo(6); // b ends at 14, wall at 20; a goes with it
  });
});
