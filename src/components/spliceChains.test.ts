import { describe, expect, it } from 'vitest';
import type { Clip, Track } from '../types';
import { healSeams, breakChainAt, chainHead, chainIds, chainsOnTrack, expandChains, remapSpliceIds, seamFlags, rejoinPlan, applyRejoin, joinPlan, selectionUnitCount, spreadUpdate } from './spliceChains';

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

describe('healSeams', () => {
  const mk = (id: string, start: number, dur: number, tag?: string) => ({ id, trackId: 't', assetId: 'a', name: id, startSeconds: start, offsetSeconds: 0, durationSeconds: dur, gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'exponential', muted: false, spliceId: tag }) as never;
  const tr = (clips: never[]) => [{ id: 't', name: 't', clips, volume: 1, pan: 0, muted: false, solo: false }] as never;
  it('joins a processed piece that came back a frame fraction long or short', () => {
    for (const drift of [1.1e-5, -1.1e-5, 2e-5]) {
      const healed = healSeams(tr([mk('a', 0, 10, 's'), mk('b', 10, 5 + drift, 's'), mk('c', 15, 10, 's')])) as never as { clips: { id: string }[] }[];
      expect(chainsOnTrack(healed[0].clips as never).map((c) => c.length)).toEqual([3]);
    }
  });
  it('leaves real gaps and other clips alone, and returns the same array when nothing changes', () => {
    const t = tr([mk('a', 0, 10, 's'), mk('b', 10.5, 5, 's'), mk('x', 20, 5)]);
    expect(healSeams(t)).toBe(t);
  });
});

describe('clipUnitCount', () => {
  const piece = (id: string, start: number, dur: number, spliceId?: string) =>
    ({ id, trackId: 't', assetId: 'a', name: id, startSeconds: start, offsetSeconds: 0, durationSeconds: dur, gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'linear', spliceId }) as any;
  it('counts a joined chain of pieces as one clip', async () => {
    const { clipUnitCount } = await import('./spliceChains');
    expect(clipUnitCount([piece('a', 0, 5, 's'), piece('b', 5, 3, 's'), piece('c', 8, 2, 's')])).toBe(1);
  });
  it('counts separate clips, and a chain beside a loose clip, separately', async () => {
    const { clipUnitCount } = await import('./spliceChains');
    expect(clipUnitCount([piece('a', 0, 5, 's'), piece('b', 5, 3, 's'), piece('z', 20, 2)])).toBe(2);
    expect(clipUnitCount([])).toBe(0);
  });
  it('pieces with a gap between them are two clips', async () => {
    const { clipUnitCount } = await import('./spliceChains');
    expect(clipUnitCount([piece('a', 0, 5, 's'), piece('b', 6, 3, 's')])).toBe(2);
  });
});

describe('rejoin torn pieces', () => {
  const two = (clips1: Clip[], clips2: Clip[] = []): Track[] => [
    { id: 't1', clips: clips1 } as unknown as Track,
    { id: 't2', clips: clips2 } as unknown as Track,
  ];
  const on2 = (id: string, start: number, dur: number, extra: Partial<Clip> = {}) => clip(id, start, dur, { trackId: 't2', ...extra });

  it('pieces torn apart on one track are laid back to back from the earliest start', () => {
    const t = two([clip('a', 2, 4, { spliceId: 's' }), clip('b', 20, 3, { spliceId: 's' })]);
    const plan = rejoinPlan(t, 'b');
    expect(plan).toEqual({ ok: true, trackId: 't1', moves: [{ clipId: 'a', startSeconds: 2 }, { clipId: 'b', startSeconds: 6 }] });
    const out = applyRejoin(t, plan as any);
    expect(chainsOnTrack(out[0].clips).map((c) => c.map((p) => p.id))).toEqual([['a', 'b']]);
  });

  it('a piece on another track comes over to the selected piece\'s track', () => {
    const t = two([clip('a', 0, 4, { spliceId: 's' })], [on2('b', 9, 3, { spliceId: 's' })]);
    const plan = rejoinPlan(t, 'a');
    expect(plan.ok && plan.trackId).toBe('t1');
    const out = applyRejoin(t, plan as any);
    expect(out[1].clips).toHaveLength(0);
    expect(out[0].clips.map((c) => [c.id, c.trackId, c.startSeconds])).toEqual([['a', 't1', 0], ['b', 't1', 4]]);
  });

  it('keeps the order they sit in, three pieces, other clips untouched', () => {
    const t = two([clip('c', 30, 2, { spliceId: 's' }), clip('a', 1, 3, { spliceId: 's' }), clip('b', 10, 2, { spliceId: 's' }), clip('z', 50, 5)]);
    const plan = rejoinPlan(t, 'c') as any;
    expect(plan.moves.map((m: any) => [m.clipId, m.startSeconds])).toEqual([['a', 1], ['b', 4], ['c', 6]]);
    expect(applyRejoin(t, plan)[0].clips.find((c) => c.id === 'z')!.startSeconds).toBe(50);
  });

  it('says why when there is nothing to do', () => {
    expect(rejoinPlan(two([clip('a', 0, 4)]), 'a')).toEqual({ ok: false, reason: 'none' });
    expect(rejoinPlan(two([clip('a', 0, 4, { spliceId: 's' })]), 'a')).toEqual({ ok: false, reason: 'none' });
    expect(rejoinPlan(two([clip('a', 0, 4, { spliceId: 's' }), clip('b', 4, 3, { spliceId: 's' })]), 'a')).toEqual({ ok: false, reason: 'already' });
    expect(rejoinPlan(two([clip('a', 0, 4, { spliceId: 's', locked: true }), clip('b', 9, 3, { spliceId: 's' })]), 'b')).toEqual({ ok: false, reason: 'locked' });
  });

  it('refuses when another clip is in the way', () => {
    const t = two([clip('a', 0, 4, { spliceId: 's' }), clip('x', 5, 3), clip('b', 20, 3, { spliceId: 's' })]);
    expect(rejoinPlan(t, 'a')).toEqual({ ok: false, reason: 'no-room' });
  });
});

describe('join clips divided by Split', () => {
  const tr = (clips: Clip[]): Track[] => [{ id: 't1', clips } as unknown as Track];
  let n = 0;
  const mk = () => `j${++n}`;
  // one source cut in three places: starts 0, 4, 9 and 15, source offsets continue
  const split = () => [clip('a', 0, 4, { offsetSeconds: 0 }), clip('b', 4, 5, { offsetSeconds: 4 }), clip('c', 9, 6, { offsetSeconds: 9 }), clip('d', 15, 2, { offsetSeconds: 15 })];

  it('selecting one piece joins every touching, continuing piece, both ways', () => {
    const plan = joinPlan(tr(split()), new Set(['b']), mk);
    expect(plan.ok && plan.ids.sort()).toEqual(['a', 'b', 'c', 'd']);
  });
  it('stops where the source stops continuing, or the clips stop touching', () => {
    const cs = split(); cs[2] = clip('c', 9, 6, { offsetSeconds: 30 });
    expect(joinPlan(tr(cs), new Set(['a']), mk)).toMatchObject({ ok: true, ids: expect.arrayContaining(['a', 'b']) });
    expect((joinPlan(tr(cs), new Set(['a']), mk) as any).ids).not.toContain('c');
    const gap = split(); gap[1] = clip('b', 5, 5, { offsetSeconds: 4 });
    expect(joinPlan(tr(gap), new Set(['a']), mk)).toEqual({ ok: false, reason: 'none' });
  });
  it('different audio files are never joined', () => {
    const cs = split(); cs[1] = clip('b', 4, 5, { offsetSeconds: 4, assetId: 'other' });
    expect(joinPlan(tr(cs), new Set(['a']), mk)).toEqual({ ok: false, reason: 'none' });
  });
  it('already joined, locked, or a lone clip: nothing to do', () => {
    const joined = [clip('a', 0, 4, { spliceId: 's' }), clip('b', 4, 5, { spliceId: 's', offsetSeconds: 4 })];
    expect(joinPlan(tr(joined), new Set(['a']), mk)).toEqual({ ok: false, reason: 'none' });
    expect(joinPlan(tr(split().map((c, i) => (i === 2 ? { ...c, locked: true } : c))), new Set(['a']), mk)).toEqual({ ok: false, reason: 'locked' });
    expect(joinPlan(tr([clip('a', 0, 4)]), new Set(['a']), mk)).toEqual({ ok: false, reason: 'none' });
  });
  it('reuses an existing splice id when one piece already has it', () => {
    const cs = split(); cs[0] = { ...cs[0], spliceId: 'keep' };
    expect((joinPlan(tr(cs), new Set(['b']), mk) as any).spliceId).toBe('keep');
  });
});
