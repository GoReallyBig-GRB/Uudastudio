import { describe, it, expect } from 'vitest';
import { isClipLocked, lockViolation } from './clipLock';
import type { Clip, Project } from '../types';

const clip = (id: string, extra: Partial<Clip> = {}): Clip => ({
  id, trackId: 't1', assetId: 'a', name: id, startSeconds: 0, offsetSeconds: 0, durationSeconds: 5,
  gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'exponential', ...extra,
});
const proj = (clips: Clip[], groupSettings: Project['groupSettings'] = {}): Project =>
  ({ tracks: [{ id: 't1', clips }], groupSettings } as unknown as Project);

describe('clip lock', () => {
  it('solo clip follows its own flag; grouped clip follows the group', () => {
    const p = proj([clip('a', { locked: true }), clip('b', { groupId: 'g', locked: false })], { g: { volume: 1, pan: 0, muted: false, locked: true } });
    expect(isClipLocked(p, p.tracks[0].clips[0])).toBe(true);
    expect(isClipLocked(p, p.tracks[0].clips[1])).toBe(true);
  });
  it('blocks move, trim and delete of locked clips', () => {
    const prev = proj([clip('a', { locked: true })]);
    expect(lockViolation(prev, proj([clip('a', { locked: true, startSeconds: 2 })]))).toBe(1);
    expect(lockViolation(prev, proj([clip('a', { locked: true, durationSeconds: 3 })]))).toBe(1);
    expect(lockViolation(prev, proj([]))).toBe(1);
  });
  it('allows unlocking, mute and edits to unlocked clips', () => {
    const prev = proj([clip('a', { locked: true }), clip('b')]);
    expect(lockViolation(prev, proj([clip('a', { locked: false }), clip('b')]))).toBe(0);
    expect(lockViolation(prev, proj([clip('a', { locked: true, muted: true }), clip('b', { startSeconds: 9 })]))).toBe(0);
  });
  it('group lock protects every member and unlocking is allowed', () => {
    const g = { volume: 1, pan: 0, muted: false, locked: true };
    const prev = proj([clip('a', { groupId: 'g' }), clip('b', { groupId: 'g' })], { g });
    expect(lockViolation(prev, proj([clip('a', { groupId: 'g', startSeconds: 1 }), clip('b', { groupId: 'g' })], { g }))).toBe(1);
    expect(lockViolation(prev, proj([clip('a', { groupId: 'g' }), clip('b', { groupId: 'g' })], { g: { ...g, locked: false } }))).toBe(0);
  });
});
