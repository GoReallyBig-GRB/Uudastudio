/**
 * THE RULE (non-negotiable): any edit except Split leaves a clip whole. A track edited by deleting a range, silencing,
 * changing level, processing, pasting or changing speed is still ONE clip (one chain of touching pieces).
 * Only Split divides a clip, as an intentional action.
 */
import { describe, expect, it } from 'vitest';
import type { Clip, Track } from '../types';
import { deleteRangeFromTracks } from './rangeDelete';
import { isolateRangeInTracks } from './rangeIsolate';
import { joinTouching, rippleInsert, shiftLaterClips } from './rippleInsert';
import { chainsOnTrack } from './spliceChains';

const clip = (id: string, start: number, dur: number, extra: Partial<Clip> = {}): Clip => ({
  id, trackId: 't1', assetId: 'a', name: id, startSeconds: start, offsetSeconds: 0, durationSeconds: dur,
  gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'exponential', muted: false, ...extra,
} as Clip);
const track = (clips: Clip[]): Track => ({ id: 't1', name: 't1', clips, volume: 1, pan: 0, muted: false, solo: false } as Track);
let n = 0;
const id = () => `x${n++}`;
/** The number of separate clips on the track: touching pieces that share a join count as one, every other clip counts as one */
const clipCount = (t: Track): number => {
  const chains = chainsOnTrack(t.clips);
  const inChains = new Set(chains.flat().map((c) => c.id));
  return chains.length + t.clips.filter((c) => !inChains.has(c.id)).length;
};

describe('every edit but Split leaves the clip whole', () => {
  it('deleting a range inside a clip', () => {
    const out = deleteRangeFromTracks([track([clip('a', 0, 60)])], ['t1'], 10, 20, id).tracks[0];
    expect(out.clips.length).toBe(2);
    expect(clipCount(out)).toBe(1);
  });
  it('silencing, amplifying or processing a range (joined isolate)', () => {
    const out = isolateRangeInTracks([track([clip('a', 0, 60)])], ['t1'], 10, 20, id, true).tracks[0];
    expect(out.clips.length).toBe(3);
    expect(clipCount(out)).toBe(1);
  });
  it('repeated edits on the same clip still leave it whole', () => {
    let t = track([clip('a', 0, 120)]);
    t = isolateRangeInTracks([t], ['t1'], 10, 20, id, true).tracks[0];
    t = isolateRangeInTracks([t], ['t1'], 50, 60, id, true).tracks[0];
    t = deleteRangeFromTracks([t], ['t1'], 80, 90, id).tracks[0];
    expect(clipCount(t)).toBe(1);
  });
  it('pasting into the middle of a clip', () => {
    const opened = rippleInsert([track([clip('a', 0, 60)])], new Set(['t1']), 30, 10, id, () => 'tag');
    const withPaste = [{ ...opened[0], clips: [...opened[0].clips, clip('p', 30, 10)] }];
    expect(clipCount(joinTouching(withPaste, new Set(['p']), () => 'j')[0])).toBe(1);
  });
  it('changing the speed of a range keeps the pieces touching', () => {
    let t = isolateRangeInTracks([track([clip('a', 0, 60)])], ['t1'], 10, 20, id, true).tracks[0];
    const inner = t.clips.find((c) => c.startSeconds === 10)!;
    // The range becomes 5 s long: it shortens by 5 s and what follows moves with it
    t = { ...t, clips: t.clips.map((c) => (c.id === inner.id ? { ...c, durationSeconds: 5 } : c)) };
    t = shiftLaterClips([t], 't1', 20, -5, new Set([inner.id]))[0];
    expect(clipCount(t)).toBe(1);
  });
});

describe('Split is the only thing that divides a clip', () => {
  it('a non-joined isolate (the Split button on a range) makes separate clips', () => {
    const out = isolateRangeInTracks([track([clip('a', 0, 60)])], ['t1'], 10, 20, id, false).tracks[0];
    expect(clipCount(out)).toBe(3);
  });
});
