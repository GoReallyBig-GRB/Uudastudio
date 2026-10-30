import { describe, expect, it } from 'vitest';
import type { Clip, Project, Track } from '../types';
import { expandSelection, selectionScope } from './exportScope';

const clip = (id: string, start: number, dur: number, groupId?: string): Clip => ({
  id, trackId: 't', assetId: 'a', name: id, startSeconds: start, offsetSeconds: 0, durationSeconds: dur,
  gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'linear', groupId,
});
const track = (id: string, clips: Clip[]): Track => ({ id, name: id, clips, volume: 1, pan: 0, muted: false, solo: false });
const project = (tracks: Track[]): Project => ({
  id: 'p', name: 'p', tracks, sampleRate: 48000,
  settings: { autoRefresh: true, sampleRate: 48000, duckPlayingTracks: true, duckingAmountDb: -12 },
});

describe('selection export scope', () => {
  const p = project([
    track('t1', [clip('a', 0, 5), clip('b', 600, 10, 'g1')]),
    track('t2', [clip('c', 605, 8, 'g1'), clip('d', 700, 20)]),
  ]);

  it('keeps only the selected clips and runs from their start to their end', () => {
    const s = selectionScope(p, new Set(['b']));
    expect(s.range).toEqual({ startSeconds: 600, endSeconds: 613 }); // b is grouped with c
    expect(s.project.tracks.flatMap((t) => t.clips.map((c) => c.id)).sort()).toEqual(['b', 'c']);
    expect(s.clipCount).toBe(2);
    expect(s.trackCount).toBe(2);
  });

  it('a clip in the middle of a long project exports only its own length', () => {
    const s = selectionScope(p, new Set(['d']));
    expect(s.range).toEqual({ startSeconds: 700, endSeconds: 720 });
    expect(s.project.tracks[0].clips).toHaveLength(0);
  });

  it('an empty selection has no range', () => {
    expect(selectionScope(p, new Set()).range).toBeNull();
  });

  it('expands a selection to its whole group and leaves the original project untouched', () => {
    expect([...expandSelection(p, new Set(['c']))].sort()).toEqual(['b', 'c']);
    expect(p.tracks[0].clips).toHaveLength(2);
  });
});
