import { describe, expect, it } from 'vitest';
import type { Clip, Track } from '../types';
import { copyRange, pasteRange, sliceClip } from './rangeClipboard';

const clip = (id: string, start: number, dur: number, extra: Partial<Clip> = {}): Clip => ({
  id, trackId: 't', assetId: 'a', name: id, startSeconds: start, offsetSeconds: 0, durationSeconds: dur,
  gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'linear', ...extra,
});
const track = (id: string, clips: Clip[]): Track => ({ id, name: id, clips, volume: 1, pan: 0, muted: false, solo: false });
let n = 0;
const makeId = () => `new-${++n}`;
const makeTrack = (i: number, src: string): Track => track(`created-${i}-${src}`, []);

describe('sliceClip', () => {
  it('trims to the range, keeps source offsets right and drops fades made by the cut', () => {
    const c = clip('a', 2, 10, { offsetSeconds: 1, fadeInSeconds: 0.5, fadeOutSeconds: 0.5 });
    const s = sliceClip(c, 4, 8)!;
    expect(s).toMatchObject({ startSeconds: 0, offsetSeconds: 3, durationSeconds: 4, fadeInSeconds: 0, fadeOutSeconds: 0 });
  });
  it('keeps a fade on an edge the range did not cut', () => {
    const c = clip('a', 4, 2, { fadeInSeconds: 0.5, fadeOutSeconds: 0.25 });
    const s = sliceClip(c, 3, 9)!;
    expect(s).toMatchObject({ startSeconds: 1, durationSeconds: 2, fadeInSeconds: 0.5, fadeOutSeconds: 0.25 });
  });
  it('returns null when nothing is inside', () => {
    expect(sliceClip(clip('a', 0, 2), 5, 6)).toBeNull();
  });
});

describe('copy and paste of a range across tracks', () => {
  const tracks = [
    track('t1', [clip('a', 0, 10)]),
    track('t2', [clip('b', 3, 4), clip('c', 20, 5)]),
    track('t3', [clip('d', 0, 30)]),
  ];

  it('copies the same stack of tracks, trimmed, with positions relative to the range', () => {
    const cb = copyRange(tracks, ['t1', 't2'], 2, 6)!;
    expect(cb.durationSeconds).toBe(4);
    expect(cb.layers.map((l) => l.sourceTrackId)).toEqual(['t1', 't2']);
    expect(cb.layers[0].clips[0]).toMatchObject({ startSeconds: 0, offsetSeconds: 2, durationSeconds: 4 });
    expect(cb.layers[1].clips[0]).toMatchObject({ startSeconds: 1, offsetSeconds: 0, durationSeconds: 3 });
  });

  it('keeps an empty layer so the stack keeps its shape', () => {
    const cb = copyRange(tracks, ['t1', 't2'], 40, 50);
    expect(cb).toBeNull(); // nothing at all in range
    const cb2 = copyRange([track('t1', [clip('a', 0, 10)]), track('t2', [])], ['t1', 't2'], 0, 5)!;
    expect(cb2.layers).toHaveLength(2);
    expect(cb2.layers[1].clips).toHaveLength(0);
  });

  it('pastes the stack onto consecutive tracks at the new time without changing the source', () => {
    const cb = copyRange(tracks, ['t1', 't2'], 2, 6)!;
    const res = pasteRange(tracks, cb, 100, 0, makeId, makeTrack);
    expect(res.tracks[0].clips.map((c) => c.startSeconds)).toEqual([0, 100]);
    expect(res.tracks[1].clips.find((c) => c.startSeconds === 101)).toBeDefined();
    expect(res.addedClipIds).toHaveLength(2);
    expect(tracks[0].clips).toHaveLength(1); // original untouched
  });

  it('adds tracks at the bottom when the stack does not fit', () => {
    const cb = copyRange(tracks, ['t1', 't2'], 2, 6)!;
    const res = pasteRange(tracks, cb, 0, 2, makeId, makeTrack); // starts on t3, needs one more
    expect(res.tracks).toHaveLength(4);
    expect(res.createdTrackIds).toHaveLength(1);
    expect(res.tracks[3].clips).toHaveLength(1);
  });

  it('pasted clips are new and never join a group', () => {
    const g = [track('t1', [clip('a', 0, 10, { groupId: 'g1' })])];
    const cb = copyRange(g, ['t1'], 0, 5)!;
    const res = pasteRange(g, cb, 20, 0, makeId, makeTrack);
    const added = res.tracks[0].clips.find((c) => c.startSeconds === 20)!;
    expect(added.groupId).toBeUndefined();
    expect(added.id).not.toBe('a');
  });
});
