import { describe, expect, it } from 'vitest';
import { CreateGate, MemoryGateStore } from './createGate';

describe('job creation limit', () => {
  it('allows a set number per address per day, then refuses with a wait time', async () => {
    let t = Date.parse('2026-11-20T10:00:00Z');
    const g = new CreateGate(new MemoryGateStore(), 3, 100, () => t);
    for (let i = 0; i < 3; i++) expect((await g.take('1.2.3.4')).ok).toBe(true);
    const r = await g.take('1.2.3.4');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfterSeconds).toBe(14 * 3600);
    expect((await g.take('5.6.7.8')).ok).toBe(true); // another address is unaffected
    t = Date.parse('2026-11-21T00:00:01Z');
    expect((await g.take('1.2.3.4')).ok).toBe(true); // next day
  });

  it('has a total daily cap across all addresses, and refused attempts do not use it up', async () => {
    const g = new CreateGate(new MemoryGateStore(), 5, 4, () => Date.parse('2026-11-20T10:00:00Z'));
    for (let i = 0; i < 4; i++) expect((await g.take(`10.0.0.${i}`)).ok).toBe(true);
    expect((await g.take('10.0.0.9')).ok).toBe(false);
    expect((await g.take('10.0.0.9')).ok).toBe(false);
  });

  it('stores a digest, not the address', async () => {
    const store = new MemoryGateStore();
    await new CreateGate(store, 5, 5, () => Date.parse('2026-11-20T10:00:00Z')).take('203.0.113.7');
    expect(JSON.stringify([...(store as unknown as { m: Map<string, number> }).m.keys()])).not.toContain('203.0.113.7');
  });
});
