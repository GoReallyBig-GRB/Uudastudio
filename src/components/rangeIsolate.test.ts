import { describe, expect, it } from 'vitest';
import type { Clip, Track } from '../types';
import { isolateRangeInTracks } from './rangeIsolate';

const clip = (id: string, start: number, dur: number, extra: Partial<Clip> = {}): Clip => ({
  id, trackId: 't1', assetId: 'a', name: id, startSeconds: start, offsetSeconds: 0, durationSeconds: dur,
  gain: 1, fadeInSeconds: 0.2, fadeOutSeconds: 0.3, fadeShape: 'exponential', ...extra,
});
const track = (id: string, clips: Clip[]): Track => ({ id, clips } as unknown as Track);
let n = 0;
const mk = () => `new-${++n}`;

describe('isolateRangeInTracks', () => {
  it('splits a clip into before, inside and after without moving audio', () => {
    const r = isolateRangeInTracks([track('t1', [clip('c', 0, 10, { offsetSeconds: 1 })])], ['t1'], 4, 6, mk);
    const cs = r.tracks[0].clips;
    expect(cs).toHaveLength(3);
    expect(cs[0]).toMatchObject({ id: 'c', startSeconds: 0, durationSeconds: 4, fadeOutSeconds: 0, fadeInSeconds: 0.2 });
    expect(cs[1]).toMatchObject({ startSeconds: 4, offsetSeconds: 5, durationSeconds: 2, fadeInSeconds: 0, fadeOutSeconds: 0 });
    expect(cs[2]).toMatchObject({ startSeconds: 6, offsetSeconds: 7, durationSeconds: 4, fadeInSeconds: 0, fadeOutSeconds: 0.3 });
    expect(r.innerClipIds).toEqual([cs[1].id]);
    expect(r.changedTrackIds).toEqual(['t1']);
  });

  it('keeps the clip id for the inside piece when the range starts at the clip start', () => {
    const r = isolateRangeInTracks([track('t1', [clip('c', 2, 6)])], ['t1'], 0, 5, mk);
    expect(r.tracks[0].clips).toHaveLength(2);
    expect(r.innerClipIds).toEqual(['c']);
    expect(r.tracks[0].clips[0]).toMatchObject({ id: 'c', startSeconds: 2, durationSeconds: 3, fadeOutSeconds: 0, fadeInSeconds: 0.2 });
  });

  it('does not split a clip that is already inside the range', () => {
    const t = track('t1', [clip('c', 2, 2)]);
    const r = isolateRangeInTracks([t], ['t1'], 1, 5, mk);
    expect(r.tracks[0]).toBe(t);
    expect(r.innerClipIds).toEqual(['c']);
    expect(r.changedTrackIds).toEqual([]);
  });

  it('leaves other tracks and clips outside the range alone', () => {
    const other = track('t2', [clip('x', 0, 10)]);
    const r = isolateRangeInTracks([track('t1', [clip('a', 0, 1), clip('b', 8, 1)]), other], ['t1'], 3, 5, mk);
    expect(r.tracks[1]).toBe(other);
    expect(r.innerClipIds).toEqual([]);
  });

  it('works across several tracks and ignores an empty range', () => {
    const ts = [track('t1', [clip('a', 0, 10)]), track('t2', [clip('b', 0, 10)])];
    expect(isolateRangeInTracks(ts, ['t1', 't2'], 4, 6, mk).innerClipIds).toHaveLength(2);
    expect(isolateRangeInTracks(ts, ['t1'], 5, 5, mk).innerClipIds).toEqual([]);
  });

  it('joined: the three pieces share a splice id and keep the clip name', () => {
    const r = isolateRangeInTracks([track('t1', [clip('c', 0, 10)])], ['t1'], 4, 6, mk, true);
    const cs = r.tracks[0].clips;
    expect(new Set(cs.map((c) => c.spliceId)).size).toBe(1);
    expect(cs[0].spliceId).toBeTruthy();
    expect(cs.every((c) => c.name === 'c')).toBe(true);
  });

  it('separate: only the first piece keeps any join', () => {
    const r = isolateRangeInTracks([track('t1', [clip('c', 0, 10, { spliceId: 'old' })])], ['t1'], 4, 6, mk, false);
    const cs = r.tracks[0].clips;
    expect(cs[0].spliceId).toBe('old');
    expect(cs[1].spliceId).toBeUndefined();
    expect(cs[2].spliceId).toBeUndefined();
  });
});
