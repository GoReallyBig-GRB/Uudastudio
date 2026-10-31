import { describe, expect, it } from 'vitest';
import type { Clip, Track } from '../types';
import { deleteRangeFromClips, deleteRangeFromTracks, normalizeRange, rangeTrackIds } from './rangeDelete';

const clip = (id: string, start: number, duration: number, extra: Partial<Clip> = {}): Clip => ({
  id,
  trackId: 't1',
  assetId: 'a1',
  name: id,
  startSeconds: start,
  offsetSeconds: 0,
  durationSeconds: duration,
  gain: 1,
  fadeInSeconds: 0,
  fadeOutSeconds: 0,
  fadeShape: 'linear',
  ...extra,
});

let n = 0;
const makeId = () => `new-${++n}`;

describe('normalizeRange', () => {
  it('orders the ends and clamps to zero', () => {
    expect(normalizeRange(5, 2)).toEqual({ start: 2, end: 5 });
    expect(normalizeRange(-1, 3)).toEqual({ start: 0, end: 3 });
  });
  it('rejects empty, tiny and non-finite ranges', () => {
    expect(normalizeRange(2, 2)).toBeNull();
    expect(normalizeRange(2, 2.0004)).toBeNull();
    expect(normalizeRange(Number.NaN, 2)).toBeNull();
    expect(normalizeRange(0, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('ripple delete on one track', () => {
  it('cutting the middle of one clip makes two clips that meet with no gap', () => {
    const res = deleteRangeFromClips([clip('c', 0, 10)], 4, 6, makeId);
    expect(res.removedSeconds).toBe(2);
    expect(res.clips).toHaveLength(2);
    const [left, right] = res.clips;
    expect(left).toMatchObject({ id: 'c', startSeconds: 0, offsetSeconds: 0, durationSeconds: 4 });
    expect(right).toMatchObject({ startSeconds: 4, offsetSeconds: 6, durationSeconds: 4 });
    expect(right.id).not.toBe('c');
    // Both pieces share a splice id: they stay ONE clip until an explicit Split
    expect(left.spliceId).toBeTruthy();
    expect(right.spliceId).toBe(left.spliceId);
    // Contiguous on the timeline: the left piece ends exactly where the right piece starts.
    expect(left.startSeconds + left.durationSeconds).toBe(right.startSeconds);
    // And the source audio skips exactly the removed 2 seconds: 0..4 then 6..10.
    expect(left.offsetSeconds + left.durationSeconds).toBe(4);
    expect(right.offsetSeconds).toBe(6);
  });

  it('removes a clip that lies fully inside the range and slides later clips left', () => {
    const res = deleteRangeFromClips([clip('a', 0, 2), clip('b', 3, 2), clip('c', 6, 4)], 2.5, 5.5, makeId);
    expect(res.clips.map((c) => c.id)).toEqual(['a', 'c']);
    expect(res.clips[1].startSeconds).toBe(3); // 6 - 3
    expect(res.clips[0].startSeconds).toBe(0); // before the range: untouched
    expect(res.removedSeconds).toBe(3);
  });

  it('trims the right edge of a clip that overlaps the start of the range', () => {
    const res = deleteRangeFromClips([clip('a', 0, 6, { fadeOutSeconds: 1 })], 4, 8, makeId);
    expect(res.clips).toHaveLength(1);
    expect(res.clips[0]).toMatchObject({ id: 'a', startSeconds: 0, durationSeconds: 4, fadeOutSeconds: 0 });
  });

  it('trims the left edge of a clip that overlaps the end of the range and moves it to the cut', () => {
    const res = deleteRangeFromClips([clip('a', 5, 6, { offsetSeconds: 1, fadeInSeconds: 1 })], 4, 8, makeId);
    expect(res.clips).toHaveLength(1);
    // 3 seconds of the clip (5..8) are removed: it now starts at the cut, 3 seconds later in the source.
    expect(res.clips[0]).toMatchObject({ id: 'a', startSeconds: 4, offsetSeconds: 4, durationSeconds: 3, fadeInSeconds: 0 });
  });

  it('adds no fade at the join', () => {
    const res = deleteRangeFromClips([clip('c', 0, 10, { fadeInSeconds: 0.5, fadeOutSeconds: 0.5 })], 4, 6, makeId);
    const [left, right] = res.clips;
    expect(left.fadeInSeconds).toBe(0.5); // the clip's own start fade is kept
    expect(left.fadeOutSeconds).toBe(0); // nothing added at the cut
    expect(right.fadeInSeconds).toBe(0); // nothing added at the cut
    expect(right.fadeOutSeconds).toBe(0.5); // the clip's own end fade is kept
  });

  it('does not pile up (Part 2) tags when the same clip is cut again and again', () => {
    let clips = [clip('c', 0, 30, { name: 'Take' })];
    for (let i = 0; i < 4; i++) {
      const cutAt = 2 + i * 6;
      clips = deleteRangeFromClips(clips, cutAt, cutAt + 1, makeId).clips;
    }
    expect(clips.length).toBeGreaterThan(1);
    expect(clips.every((c) => c.name === 'Take' || c.name === 'Take (Part 2)')).toBe(true);
  });

  it('keeps clip settings on both pieces', () => {
    const res = deleteRangeFromClips([clip('c', 0, 10, { gain: 0.7, muted: true })], 4, 6, makeId);
    expect(res.clips.every((c) => c.gain === 0.7 && c.muted === true && c.assetId === 'a1')).toBe(true);
  });

  it('leaves clips before the range exactly as they were', () => {
    const before = clip('a', 0, 3);
    const res = deleteRangeFromClips([before], 5, 7, makeId);
    expect(res.clips[0]).toBe(before);
    expect(res.removedSeconds).toBe(0);
    expect(res.changedClipIds).toEqual([]);
  });

  it('does nothing for an invalid range', () => {
    const res = deleteRangeFromClips([clip('a', 0, 3)], 2, 2, makeId);
    expect(res.removedSeconds).toBe(0);
    expect(res.clips).toHaveLength(1);
  });

  it('drops slivers shorter than a millisecond instead of leaving near-empty clips', () => {
    const res = deleteRangeFromClips([clip('a', 0, 4.0004)], 4, 6, makeId);
    expect(res.clips).toHaveLength(1);
    expect(res.clips[0].durationSeconds).toBe(4);
    const res2 = deleteRangeFromClips([clip('b', 0, 6.0004)], 0, 6, makeId);
    expect(res2.clips).toHaveLength(0);
  });

  it('does not mutate its input', () => {
    const input = [clip('c', 0, 10)];
    const snapshot = JSON.stringify(input);
    deleteRangeFromClips(input, 4, 6, makeId);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('deleting a range that covers everything leaves the track empty', () => {
    const res = deleteRangeFromClips([clip('a', 1, 2), clip('b', 4, 2)], 0, 10, makeId);
    expect(res.clips).toHaveLength(0);
  });
});

const track = (id: string, clips: Clip[]): Track => ({ id, name: id, clips, volume: 1, pan: 0, muted: false, solo: false });

describe('ripple delete across several tracks', () => {
  it('removes the span from every included track and closes each gap on its own', () => {
    const tracks = [
      track('t1', [clip('a', 0, 10)]),
      track('t2', [clip('b', 2, 3), clip('c', 8, 4)]),
      track('t3', [clip('d', 0, 10)]),
    ];
    const res = deleteRangeFromTracks(tracks, ['t1', 't2'], 4, 6, makeId);
    expect(res.removedSeconds).toBe(2);
    expect(res.changedTrackIds).toEqual(['t1', 't2']);
    expect(res.tracks[0].clips).toHaveLength(2); // t1 clip split around the span
    expect(res.tracks[1].clips.find((c) => c.id === 'c')!.startSeconds).toBe(6); // t2 later clip slides left
    expect(res.tracks[2]).toBe(tracks[2]); // t3 untouched
  });

  it('leaves a track alone when it has no audio in the range', () => {
    const tracks = [track('t1', [clip('a', 0, 2)]), track('t2', [clip('b', 0, 10)])];
    const res = deleteRangeFromTracks(tracks, ['t1', 't2'], 5, 7, makeId);
    expect(res.tracks[0]).toBe(tracks[0]);
    expect(res.changedTrackIds).toEqual(['t2']);
  });

  it('reports nothing changed for an empty range', () => {
    const tracks = [track('t1', [clip('a', 0, 10)])];
    expect(deleteRangeFromTracks(tracks, ['t1'], 3, 3, makeId).changedTrackIds).toEqual([]);
  });

  it('rangeTrackIds falls back to the anchor track', () => {
    expect(rangeTrackIds({ trackId: 't1' })).toEqual(['t1']);
    expect(rangeTrackIds({ trackId: 't1', trackIds: ['t1', 't2'] })).toEqual(['t1', 't2']);
  });
});
