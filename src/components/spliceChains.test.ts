import { describe, expect, it } from 'vitest';
import type { Clip, Track } from '../types';
import { breakChainAt, chainHead, chainIds, chainsOnTrack, expandChains, remapSpliceIds, seamFlags, selectionUnitCount, spreadUpdate } from './spliceChains';

const clip = (id: string, start: number, dur: number, extra: Partial<Clip> = {}): Clip => ({
  id, trackId: 't1', assetId: 'a', name: id, startSeconds: start, offsetSeconds: 0, durationSeconds: dur,
  gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'exponential', ...extra,
});
const tracks = (clips: Clip[]): Track[] => [{ id: 't1', clips } as unknown as Track];

describe('splice chains', () => {
  const cs = [clip('a', 0, 4, { spliceId: 's' }), clip('b', 4, 3, { spliceId: 's' }), clip('c', 7, 2, { spliceId: 's' }), clip('x', 9, 1)];

  it('finds touching pieces and their seams', () => {
    expect(chainsOnTrack(cs).map((c) => c.map((p) => p.id))).toEqual([['a', 'b', 'c']]);
    const f = seamFlags(cs);
    expect(f.get('a')).toEqual({ left: false, right: true });
    expect(f.get('b')).toEqual({ left: true, right: true });
    expect(f.get('c')).toEqual({ left: true, right: false });
    expect(f.has('x')).toBe(false);
  });

  it('pieces that no longer touch are separate clips', () => {
    const moved = [clip('a', 0, 4, { spliceId: 's' }), clip('b', 10, 3, { spliceId: 's' })];
    expect(chainsOnTrack(moved)).toEqual([]);
    expect(chainIds(tracks(moved), 'a')).toEqual(['a']);
  });

  it('selecting one piece selects the whole clip and counts once', () => {
    const t = tracks(cs);
    expect([...expandChains(t, new Set(['b']))].sort()).toEqual(['a', 'b', 'c']);
    expect(selectionUnitCount(t, new Set(['a', 'b', 'c']))).toBe(1);
    expect(selectionUnitCount(t, new Set(['a', 'b', 'c', 'x']))).toBe(2);
    expect(chainHead(t, 'c')?.id).toBe('a');
  });

  it('spreads level and mute to every piece, fades to the ends, and leaves other changes on one piece', () => {
    const t = tracks(cs);
    expect([...spreadUpdate(t, 'b', { gain: 0.5 }).keys()].sort()).toEqual(['a', 'b', 'c']);
    const fades = spreadUpdate(t, 'a', { fadeInSeconds: 1, fadeOutSeconds: 2 });
    expect(fades.get('a')).toEqual({ fadeInSeconds: 1 });
    expect(fades.get('c')).toEqual({ fadeOutSeconds: 2 });
    expect(fades.has('b')).toBe(false);
    const audio = spreadUpdate(t, 'b', { assetId: 'new', offsetSeconds: 0 });
    expect([...audio.keys()]).toEqual(['b']);
  });

  it('a split ends the join from the split point on', () => {
    const changed = breakChainAt(cs, 'a', 2, 'new');
    expect(changed.get('b')).toEqual({ spliceId: 'new' });
    expect(changed.get('c')).toEqual({ spliceId: 'new' });
    expect(changed.has('a')).toBe(false);
  });

  it('copies get their own join ids', () => {
    const out = remapSpliceIds(cs, (() => { let n = 0; return () => `n${++n}`; })());
    expect(out[0].spliceId).toBe('n1');
    expect(out[1].spliceId).toBe('n1');
    expect(out[3].spliceId).toBeUndefined();
  });
});
