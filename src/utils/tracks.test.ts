import { describe, it, expect } from 'vitest';
import { getTrackLabel, renameUpdate, isTrackEmpty, isUntouchedTrack, pruneEmptiedTracks } from './tracks';
import { Track, Clip } from '../types';

const clip = { id: 'c' } as unknown as Clip;
function track(id: string, over: Partial<Track> = {}): Track {
  return { id, name: 'Track 1', clips: [clip], volume: 1, pan: 0, muted: false, solo: false, ...over };
}
const noPlugins = () => false;

describe('track labels', () => {
  it('default names follow the position, typed names stick', () => {
    expect(getTrackLabel(track('a', { name: 'Track 1' }), 2)).toBe('Track 3');
    expect(getTrackLabel(track('a', { name: 'Interview', customName: true }), 0)).toBe('Interview');
    expect(getTrackLabel(track('a', { name: 'Koka Female (Part 2)' }), 4)).toBe('Koka Female (Part 2)');
    expect(getTrackLabel(track('a', { name: '', customName: true }), 1)).toBe('Track 2');
  });

  it('a typed name that looks like a default still sticks once marked custom', () => {
    expect(getTrackLabel(track('a', { name: 'Track 7', customName: true }), 0)).toBe('Track 7');
  });

  it('renaming sets a custom name; blank returns to automatic', () => {
    expect(renameUpdate('  Host  ')).toEqual({ name: 'Host', customName: true });
    expect(renameUpdate('   ')).toEqual({ name: 'Track', customName: false });
    expect(renameUpdate('x'.repeat(100)).name.length).toBe(60);
  });
});

describe('empty lanes', () => {
  it('knows empty and untouched lanes', () => {
    const empty = track('e', { clips: [] });
    expect(isTrackEmpty(empty)).toBe(true);
    expect(isUntouchedTrack(empty, false)).toBe(true);
    expect(isUntouchedTrack({ ...empty, customName: true, name: 'Host' }, false)).toBe(false);
    expect(isUntouchedTrack({ ...empty, volume: 0.8 }, false)).toBe(false);
    expect(isUntouchedTrack({ ...empty, muted: true }, false)).toBe(false);
    expect(isUntouchedTrack(empty, true)).toBe(false);
  });

  it('removes a lane a move emptied, keeps lanes that were already empty or touched', () => {
    const before = [track('a'), track('b'), track('c', { clips: [] }), track('d')];
    const after = [track('a', { clips: [] }), track('b', { clips: [clip, clip] }), track('c', { clips: [] }), track('d', { clips: [] })];
    // d was renamed, so it stays even though the move emptied it; c was empty before the move
    after[3] = { ...after[3], name: 'Music', customName: true };
    const result = pruneEmptiedTracks(before, after, noPlugins);
    expect(result.removedIds).toEqual(['a']);
    expect(result.tracks.map((t) => t.id)).toEqual(['b', 'c', 'd']);
  });

  it('keeps a lane that has plugins, and never removes every track', () => {
    const before = [track('a'), track('b')];
    const after = [track('a', { clips: [] }), track('b', { clips: [clip] })];
    expect(pruneEmptiedTracks(before, after, (id) => id === 'a').removedIds).toEqual([]);

    const bothEmptied = [track('a', { clips: [] }), track('b', { clips: [] })];
    const r = pruneEmptiedTracks(before, bothEmptied, noPlugins);
    expect(r.tracks.length).toBe(2);
    expect(r.removedIds).toEqual([]);
  });
});
