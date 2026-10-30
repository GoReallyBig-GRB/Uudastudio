import { describe, expect, it } from 'vitest';
import type { Clip, Track } from '../types';
import { copyClipSet, pasteClipSet } from './clipSetClipboard';

const clip = (id: string, start: number, dur: number, groupId?: string): Clip => ({
  id, trackId: 't', assetId: 'a', name: id, startSeconds: start, offsetSeconds: 0, durationSeconds: dur,
  gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'linear', groupId,
});
const track = (id: string, clips: Clip[]): Track => ({ id, name: id, clips, volume: 1, pan: 0, muted: false, solo: false });
const mk = (index: number): Track => track('new' + index, []);

describe('copyClipSet', () => {
  it('returns null when nothing is selected', () => {
    expect(copyClipSet([track('A', [clip('a', 0, 1)])], new Set())).toBeNull();
  });

  it('keeps relative timing and the track stack, including empty tracks in between', () => {
    const tracks = [track('A', [clip('a', 10, 2, 'g')]), track('B', [clip('x', 0, 1)]), track('C', [clip('c', 14, 4, 'g')])];
    const cb = copyClipSet(tracks, new Set(['a', 'c']))!;
    expect(cb.layers.map((l) => l.sourceTrackId)).toEqual(['A', 'B', 'C']);
    expect(cb.layers[1].clips).toEqual([]);
    expect(cb.layers[0].clips[0].startSeconds).toBe(0);
    expect(cb.layers[2].clips[0].startSeconds).toBe(4);
    expect(cb.durationSeconds).toBe(8);
    expect(cb.groupIds).toEqual(['g']);
  });
});

describe('pasteClipSet', () => {
  const tracks = [track('A', [clip('a', 10, 2, 'g')]), track('B', [clip('c', 14, 4, 'g')])];
  let n = 0;
  const run = (start: number, at: number, ts = tracks) =>
    pasteClipSet(ts, copyClipSet(ts, new Set(['a', 'c']))!, at, start, () => 'n' + n++, mk, () => 'G2');

  it('pastes at the new time with the same offsets and a fresh group id', () => {
    const r = run(0, 30);
    const added = r.tracks.flatMap((t) => t.clips).filter((c) => r.addedClipIds.includes(c.id));
    expect(added.map((c) => c.startSeconds).sort((a, b) => a - b)).toEqual([30, 34]);
    expect(added.every((c) => c.groupId === 'G2')).toBe(true);
    expect(r.groupMap).toEqual({ g: 'G2' });
  });

  it('leaves the originals and their group untouched', () => {
    const r = run(0, 30);
    expect(r.tracks[0].clips[0].groupId).toBe('g');
    expect(r.tracks[1].clips[0].groupId).toBe('g');
  });

  it('adds tracks at the bottom when the stack does not fit', () => {
    const r = run(1, 30);
    expect(r.tracks.length).toBe(3);
    expect(r.createdTrackIds.length).toBe(1);
  });

  it('keeps loose clips loose', () => {
    const ts = [track('A', [clip('a', 0, 1), clip('c', 2, 1)])];
    const r = pasteClipSet(ts, copyClipSet(ts, new Set(['a', 'c']))!, 5, 0, () => 'p' + Math.random(), mk, () => 'G');
    expect(r.tracks[0].clips.filter((c) => c.groupId).length).toBe(0);
    expect(r.groupMap).toEqual({});
  });
});
