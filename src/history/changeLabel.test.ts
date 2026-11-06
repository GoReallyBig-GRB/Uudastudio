import { describe, expect, it } from 'vitest';
import type { Clip, Project } from '../types';
import { describeChange } from './changeLabel';

const clip = (id: string, start: number, dur: number, extra: Partial<Clip> = {}): Clip => ({
  id, trackId: 't1', assetId: 'a', name: id, startSeconds: start, offsetSeconds: 0, durationSeconds: dur,
  gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'exponential', muted: false, ...extra,
} as Clip);
const proj = (clips: Clip[], extraTracks: Project['tracks'] = []): Project => ({
  name: 'p', tracks: [{ id: 't1', name: 't1', clips, volume: 1, pan: 0, muted: false, solo: false }, ...extraTracks],
} as unknown as Project);

describe('describeChange names what the edit did', () => {
  const base = proj([clip('a', 0, 10), clip('b', 10, 10)]);
  it('delete', () => expect(describeChange(base, proj([clip('a', 0, 10)]))).toBe('delete'));
  it('split', () => expect(describeChange(proj([clip('a', 0, 20)]), proj([clip('a', 0, 8), clip('n', 8, 12, { offsetSeconds: 8 })]))).toBe('split'));
  it('mute and unmute', () => {
    expect(describeChange(base, proj([clip('a', 0, 10, { muted: true }), clip('b', 10, 10)]))).toBe('mute');
    expect(describeChange(proj([clip('a', 0, 10, { muted: true })]), proj([clip('a', 0, 10)]))).toBe('unmute');
  });
  it('level, move, fade, processing, rename', () => {
    expect(describeChange(base, proj([clip('a', 0, 10, { gain: 0.5 }), clip('b', 10, 10)]))).toBe('level change');
    expect(describeChange(base, proj([clip('a', 3, 10), clip('b', 10, 10)]))).toBe('move');
    expect(describeChange(base, proj([clip('a', 0, 10, { fadeInSeconds: 1 }), clip('b', 10, 10)]))).toBe('fade');
    expect(describeChange(base, proj([clip('a', 0, 10, { assetId: 'x' }), clip('b', 10, 10)]))).toBe('processing');
    expect(describeChange(base, proj([clip('a', 0, 10, { name: 'z' }), clip('b', 10, 10)]))).toBe('rename');
  });
  it('group, ungroup, lock', () => {
    const grouped = proj([clip('a', 0, 10, { groupId: 'g' }), clip('b', 10, 10, { groupId: 'g' })]);
    expect(describeChange(base, grouped)).toBe('group');
    expect(describeChange(grouped, base)).toBe('ungroup');
    expect(describeChange(base, proj([clip('a', 0, 10, { locked: true }), clip('b', 10, 10)]))).toBe('lock');
  });
  it('a whole track added or removed', () => {
    const other = { id: 't2', name: 't2', clips: [clip('z', 0, 5, { trackId: 't2' })], volume: 1, pan: 0, muted: false, solo: false } as unknown as Project['tracks'][number];
    expect(describeChange(proj([clip('a', 0, 10)], [other]), proj([clip('a', 0, 10)]))).toBe('delete track');
    expect(describeChange(proj([clip('a', 0, 10)]), proj([clip('a', 0, 10)], [other]))).toBe('add track');
  });
  it('a silenced range and a new clip', () => {
    expect(describeChange(proj([clip('a', 0, 20)]), proj([clip('a', 0, 5), clip('m', 5, 5, { muted: true }), clip('r', 10, 10)]))).toBe('silence');
    expect(describeChange(base, proj([clip('a', 0, 10), clip('b', 10, 10), clip('c', 20, 5)]))).toBe('add clip');
  });
});
