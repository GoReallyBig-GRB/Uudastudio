import { describe, it, expect } from 'vitest';
import { rippleInsert, joinTouching } from './rippleInsert';
import { chainsOnTrack } from './spliceChains';
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

  it('keeps the track ONE clip after an insert: split halves and the pasted piece form a single chain', () => {
    const t = [track('t1', [clip('a', 0, 10), clip('b', 10, 4)])];
    let n = 0;
    const opened = rippleInsert(t, new Set(['t1']), 4, 5, () => `new${n++}`, () => 'tag');
    const withPaste = opened.map((tr) => ({ ...tr, clips: [...tr.clips, clip('p', 4, 5, { spliceId: 'other' })] }));
    const joined = joinTouching(withPaste, new Set(['p']), () => 'joined');
    const chains = chainsOnTrack(joined[0].clips);
    expect(chains).toHaveLength(1);
    // 'b' was a separate clip before the paste and stays one
    expect(chains[0].map((c) => c.id).sort()).toEqual(['a', 'new0', 'p']);
  });
  it('joins a clip pasted at the end of the track onto it', () => {
    const t = [track('t1', [clip('a', 0, 6)]) ];
    const withPaste = [{ ...t[0], clips: [...t[0].clips, clip('p', 6, 2)] }];
    expect(chainsOnTrack(joinTouching(withPaste, new Set(['p']), () => 'j')[0].clips)).toHaveLength(1);
  });
});
