import { describe, expect, it } from 'vitest';
import type { Clip, Track } from '../types';
import { JOIN_FADE_SECONDS, cropTrackWindow, joinInOrder, previewWindow } from './joinInOrder';
import { chainsOnTrack } from './spliceChains';

let n = 0;
const mk = () => `j${++n}`;
const clip = (id: string, trackId: string, start: number, dur: number, extra: Partial<Clip> = {}): Clip => ({
  id, trackId, assetId: id, name: id, startSeconds: start, offsetSeconds: 0, durationSeconds: dur,
  gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'exponential', ...extra,
});
const track = (id: string, clips: Clip[]): Track => ({ id, name: id, clips, volume: 1, pan: 0, muted: false, solo: false }) as Track;
const ok = <T extends { ok: boolean }>(p: T) => { expect(p.ok).toBe(true); return p as Extract<T, { ok: true }>; };

describe('join in the picked order', () => {
  const tracks = () => [track('t1', [clip('a', 't1', 0, 4), clip('b', 't1', 10, 3), clip('c', 't1', 20, 2)]), track('t2', [clip('x', 't2', 5, 6)])];
  const joined = (plan: Extract<ReturnType<typeof joinInOrder>, { ok: true }>) => plan.tracks.find((t) => t.id === plan.trackId)!;
  const byName = (t: Track) => t.clips.map((c) => [c.name, c.startSeconds]);

  it('builds the joined clip on a NEW track under the first clip\'s track; nothing else moves', () => {
    const before = tracks();
    const plan = ok(joinInOrder(before, ['c', 'a', 'b'], mk));
    expect(plan.tracks.map((t) => t.id)).toEqual(['t1', plan.trackId, 't2']);
    expect(plan.tracks[0]).toEqual(before[0]);
    expect(plan.tracks[2]).toEqual(before[1]);
    const j = joined(plan);
    expect(byName(j)).toEqual([['c', 20], ['a', 22], ['b', 26]]);
    expect(j.clips.every((c) => c.trackId === plan.trackId && c.spliceId === plan.spliceId)).toBe(true);
    expect(chainsOnTrack(j.clips)).toHaveLength(1);
    expect(plan.seams).toEqual([22, 26]);
    expect(plan.clipCount).toBe(3);
  });

  it('starts where the FIRST picked clip starts, and may take clips from other tracks', () => {
    const plan = ok(joinInOrder(tracks(), ['a', 'x', 'c'], mk));
    expect(byName(joined(plan))).toEqual([['a', 0], ['x', 4], ['c', 10]]);
    expect([plan.start, plan.end]).toEqual([0, 12]);
  });

  it('the copies have fresh ids and drop group and lock', () => {
    const ts = tracks(); ts[0].clips[0] = { ...ts[0].clips[0], groupId: 'g', locked: true };
    const plan = ok(joinInOrder(ts, ['a', 'b'], mk));
    const j = joined(plan);
    expect(j.clips.some((c) => ['a', 'b'].includes(c.id))).toBe(false);
    expect(j.clips.every((c) => !c.groupId && !c.locked)).toBe(true);
  });

  it('a short fade at each join, none inside a pair that already continues in the same audio', () => {
    const j = joined(ok(joinInOrder(tracks(), ['a', 'b'], mk)));
    expect(j.clips[0].fadeOutSeconds).toBe(JOIN_FADE_SECONDS);
    expect(j.clips[1].fadeInSeconds).toBe(JOIN_FADE_SECONDS);
    const cont = [track('t1', [clip('p', 't1', 0, 4, { assetId: 's', offsetSeconds: 0 }), clip('q', 't1', 9, 3, { assetId: 's', offsetSeconds: 4 })])];
    expect(joined(ok(joinInOrder(cont, ['p', 'q'], mk))).clips.every((c) => c.fadeInSeconds === 0 && c.fadeOutSeconds === 0)).toBe(true);
  });

  it('an edited clip counts once and keeps its pieces', () => {
    const ts = [track('t1', [clip('a1', 't1', 0, 2, { spliceId: 'e' }), clip('a2', 't1', 2, 3, { spliceId: 'e' }), clip('b', 't1', 20, 4), clip('z', 't1', 40, 1)])];
    const plan = ok(joinInOrder(ts, ['a2', 'b'], mk));
    expect(plan.clipCount).toBe(2);
    expect(byName(joined(plan))).toEqual([['a1', 0], ['a2', 2], ['b', 5]]);
    expect(plan.tracks[0].clips).toHaveLength(4);
  });

  it('says why when it cannot: too few, missing', () => {
    expect(joinInOrder(tracks(), ['a'], mk)).toEqual({ ok: false, reason: 'few' });
    expect(joinInOrder(tracks(), ['a', 'a'], mk)).toEqual({ ok: false, reason: 'few' });
    expect(joinInOrder(tracks(), ['a', 'nope'], mk)).toEqual({ ok: false, reason: 'missing' });
  });
});

describe('preview window', () => {
  const plan = ok(joinInOrder([track('t1', [clip('a', 't1', 0, 30), clip('b', 't1', 100, 30)])], ['a', 'b'], mk));
  it('starts a few seconds before the join and is at most as long as asked', () => {
    expect(previewWindow(plan, 0, 20)).toEqual({ from: 26, to: 46 });
    expect(previewWindow(plan, 0, 100, 4)).toEqual({ from: 26, to: 60 });
  });
  it('cropping keeps timeline time, moves the audio offset, and drops what is outside', () => {
    const w = previewWindow(plan, 0, 20);
    const cropped = cropTrackWindow(plan.tracks.find((t) => t.id === plan.trackId)!, w.from, w.to);
    expect(cropped.clips.map((c) => [c.name, c.startSeconds, c.offsetSeconds, c.durationSeconds])).toEqual([['a', 26, 26, 4], ['b', 30, 0, 16]]);
  });
});
