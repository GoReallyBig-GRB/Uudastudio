import { describe, expect, it } from 'vitest';
import { addQueued, listQueued, removeQueued, type QueuedTake } from './takeQueue';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
const take = (token: string, takeId: string): QueuedTake => ({ token, takeId, name: 'Live take', startAt: 1, stopAt: 9, roomStartMs: 0, savedAt: 5, meta: { storeId: `s-${takeId}`, sampleRate: 48000, channels: 1, frames: 480000, durationSeconds: 10, peakBase: 256, complete: true, createdAt: 1 } });

describe('take queue', () => {
  it('keeps takes per room, replaces repeats, and forgets handed-over ones', () => {
    const s = mem();
    addQueued(take('a', '1'), s); addQueued(take('a', '2'), s); addQueued(take('b', '1'), s); addQueued(take('a', '1'), s);
    expect(listQueued('a', s).map((t) => t.takeId).sort()).toEqual(['1', '2']);
    expect(listQueued(undefined, s)).toHaveLength(3);
    removeQueued('a', '1', s);
    expect(listQueued('a', s).map((t) => t.takeId)).toEqual(['2']);
  });
  it('survives broken or missing storage', () => {
    expect(listQueued('a', { getItem: () => '{nope', setItem: () => {} })).toEqual([]);
    expect(listQueued('a', null)).toEqual([]);
    expect(() => addQueued(take('a', '1'), null)).not.toThrow();
  });
});
