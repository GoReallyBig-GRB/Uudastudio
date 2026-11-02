import { describe, it, expect } from 'vitest';
import { rippleInsert } from './rippleInsert';
import type { Clip, Track } from '../types';

const clip = (id: string, start: number, dur: number, extra: Partial<Clip> = {}): Clip => ({
  id, trackId: 't1', assetId: 'a', name: id, startSeconds: start, offsetSeconds: 0, durationSeconds: dur,
  gain: 1, fadeInSeconds: 0.5, fadeOutSeconds: 0.5, fadeShape: 'exponential', muted: false, ...extra,
} as Clip);
const track = (id: string, clips: Clip[]): Track => ({ id, name: id, clips, volume: 1, pan: 0, muted: false, solo: false } as Track);

describe('rippleInsert', () => {
  it('splits the clip under the playhead and moves the right half and later clips', () => {
    const t = [track('t1', [clip('a', 0, 10, { offsetSeconds: 2 }), clip('b', 12, 3)])];
    let n = 0;
    const out = rippleInsert(t, new Set(['t1']), 4, 5, () => `new${n++}`)[0].clips;
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ id: 'a', startSeconds: 0, durationSeconds: 4, fadeOutSeconds: 0 });
    expect(out[1]).toMatchObject({ id: 'new0', startSeconds: 9, offsetSeconds: 6, durationSeconds: 6, fadeInSeconds: 0 });
    expect(out[2]).toMatchObject({ id: 'b', startSeconds: 17 });
  });
  it('leaves earlier clips, clips on edges and other tracks alone', () => {
    const t = [track('t1', [clip('a', 0, 4), clip('b', 4, 2)]), track('t2', [clip('c', 0, 10)])];
    const out = rippleInsert(t, new Set(['t1']), 4, 3, () => 'x');
    expect(out[0].clips.map((c) => [c.id, c.startSeconds])).toEqual([['a', 0], ['b', 7]]);
    expect(out[1].clips[0]).toMatchObject({ id: 'c', startSeconds: 0, durationSeconds: 10 });
  });
});
