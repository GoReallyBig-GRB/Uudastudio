import { describe, expect, it } from 'vitest';
import type { Clip, Track } from '../types';
import { MAX_SILENCE_SECONDS, SILENCE_ASSET_SECONDS, insertSilenceInTracks, shiftMarkersForInsert, silenceAssetId } from './insertSilence';
import { chainsOnTrack } from './spliceChains';

const SR = 48000;
let n = 0;
const mk = () => `n${++n}`;
const clip = (id: string, trackId: string, start: number, dur: number, extra: Partial<Clip> = {}): Clip => ({
  id, trackId, assetId: 'a', name: id, startSeconds: start, offsetSeconds: 0, durationSeconds: dur,
  gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'exponential', ...extra,
});
const track = (id: string, clips: Clip[]): Track => ({ id, name: id, clips, volume: 1, pan: 0, muted: false, solo: false }) as Track;
const run = (tracks: Track[], at: number, len: number, scope: 'track' | 'all', trackId = 't1') =>
  insertSilenceInTracks({ tracks, trackId, atSeconds: at, lengthSeconds: len, scope, sampleRate: SR, makeId: mk });

describe('insert silence inside a clip', () => {
  const out = run([track('t1', [clip('x', 't1', 2, 10, { offsetSeconds: 1, fadeInSeconds: 0.3, fadeOutSeconds: 0.4 })])], 6, 3, 'track');
  const clips = out[0].clips;
  it('cuts the clip into left, silence, right, all one chain, nothing lost', () => {
    expect(clips.map((c) => [c.name === 'Silence' ? 'S' : c.id === 'x' ? 'L' : 'R', c.startSeconds, c.durationSeconds])).toEqual([['L', 2, 4], ['S', 6, 3], ['R', 9, 6]]);
    expect(chainsOnTrack(clips).map((ch) => ch.length)).toEqual([3]);
    expect(new Set(clips.map((c) => c.spliceId)).size).toBe(1);
  });
  it('the right half continues from the same place in the audio', () => {
    expect(clips[2].offsetSeconds).toBeCloseTo(1 + 4, 6);
    expect(clips[2].assetId).toBe('a');
    expect(clips[1].assetId).toBe(silenceAssetId(SR));
  });
  it('keeps the clip\'s own fades at its two ends and adds short edge fades at the cut', () => {
    expect(clips[0].fadeInSeconds).toBe(0.3);
    expect(clips[2].fadeOutSeconds).toBe(0.4);
    expect(clips[0].fadeOutSeconds).toBeGreaterThan(0);
    expect(clips[0].fadeOutSeconds).toBeLessThanOrEqual(0.005);
    expect(clips[2].fadeInSeconds).toBeGreaterThan(0);
  });
});

describe('insert silence elsewhere', () => {
  it('between clips it only shifts later clips (the gap is the silence)', () => {
    const out = run([track('t1', [clip('a', 't1', 0, 4), clip('b', 't1', 4, 3), clip('c', 't1', 10, 2)])], 4, 2, 'track');
    expect(out[0].clips.map((c) => [c.id, c.startSeconds])).toEqual([['a', 0], ['b', 6], ['c', 12]]);
  });
  it('at the seam inside an edited clip the silence joins its chain', () => {
    const out = run([track('t1', [clip('a', 't1', 0, 4, { spliceId: 's' }), clip('b', 't1', 4, 3, { spliceId: 's', offsetSeconds: 4 })])], 4, 2, 'track');
    expect(chainsOnTrack(out[0].clips).map((ch) => ch.length)).toEqual([3]);
    expect(out[0].clips.map((c) => [c.startSeconds, c.durationSeconds])).toEqual([[0, 4], [4, 2], [6, 3]]);
  });
  it('before everything shifts every clip; after everything changes nothing', () => {
    expect(run([track('t1', [clip('a', 't1', 5, 4)])], 0, 1, 'track')[0].clips[0].startSeconds).toBe(6);
    expect(run([track('t1', [clip('a', 't1', 0, 4)])], 9, 1, 'track')[0].clips).toEqual([clip('a', 't1', 0, 4)]);
  });
  it('a long gap is tiled from the small silent asset, and the length is capped', () => {
    const out = run([track('t1', [clip('x', 't1', 0, 100)])], 20, 25, 'track');
    const silent = out[0].clips.filter((c) => c.name === 'Silence');
    expect(silent.map((c) => c.durationSeconds)).toEqual([SILENCE_ASSET_SECONDS, SILENCE_ASSET_SECONDS, 5]);
    expect(silent.reduce((s, c) => s + c.durationSeconds, 0)).toBe(25);
    const capped = run([track('t1', [clip('x', 't1', 0, 100)])], 20, 9999, 'track')[0].clips.filter((c) => c.name === 'Silence');
    expect(capped.reduce((s, c) => s + c.durationSeconds, 0)).toBe(MAX_SILENCE_SECONDS);
  });
  it('zero length changes nothing', () => {
    const t = [track('t1', [clip('a', 't1', 0, 4)])];
    expect(run(t, 2, 0, 'track')).toEqual(t);
  });
});

describe('scope: this track or all tracks', () => {
  const two = () => [track('t1', [clip('a', 't1', 0, 10)]), track('t2', [clip('m', 't2', 0, 20), clip('n', 't2', 25, 5)])];
  it('this track leaves the others exactly as they were', () => {
    const out = run(two(), 5, 2, 'track');
    expect(out[1]).toEqual(two()[1]);
    expect(out[0].clips.reduce((s, c) => s + c.durationSeconds, 0)).toBe(12);
  });
  it('all tracks opens the same gap everywhere, so they stay in sync', () => {
    const out = run(two(), 5, 2, 'all');
    expect(out[0].clips.at(-1)!.startSeconds + out[0].clips.at(-1)!.durationSeconds).toBe(12);
    expect(out[1].clips.filter((c) => c.name !== 'Silence').map((c) => c.startSeconds)).toEqual([0, 7, 27]);
    expect(chainsOnTrack(out[1].clips).map((ch) => ch.length)).toEqual([3]);
  });
});

describe('markers', () => {
  const tr = [track('t1', [clip('a', 't1', 0, 10)]), track('t2', [clip('m', 't2', 0, 10)])];
  const markers = [{ id: '1', timeSeconds: 2, colorIndex: 0 }, { id: '2', timeSeconds: 8, colorIndex: 1 }, { id: '3', timeSeconds: 9, colorIndex: 2, clipId: 'a' }, { id: '4', timeSeconds: 9.5, colorIndex: 3, clipId: 'm' }];
  it('all tracks: every marker after the point moves', () => {
    expect(shiftMarkersForInsert(markers, tr, 5, 2, 'all', 't1')!.map((m) => m.timeSeconds)).toEqual([2, 10, 11, 11.5]);
  });
  it('one track: only markers attached to that track\'s clips move', () => {
    expect(shiftMarkersForInsert(markers, tr, 5, 2, 'track', 't1')!.map((m) => [m.id, m.timeSeconds])).toEqual([['1', 2], ['2', 8], ['4', 9.5], ['3', 11]]);
  });
});
