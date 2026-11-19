import { describe, expect, it } from 'vitest';
import { measureNetwork, networkVerdict } from './networkCheck';

const rtts = (ms: number, n = 8, spread = 2) => Array.from({ length: n }, (_, i) => ms + (i % 2 ? spread : -spread));

describe('network check', () => {
  it('calls a fast, steady connection good for three guests', () => {
    const v = networkVerdict({ rttMs: rtts(40), uploadKbps: 8000, failed: false });
    expect(v).toMatchObject({ level: 'good', guests: 3 });
    expect(v.messages[0]).toMatch(/good/);
  });
  it('says how many guests a modest upload suits', () => {
    const v = networkVerdict({ rttMs: rtts(60), uploadKbps: 300, failed: false });
    expect(v.guests).toBe(1);
    expect(v.level).toBe('fair');
    expect(v.messages.join(' ')).toMatch(/1 guest\b/);
  });
  it('warns about slow or uneven connections and too little upload', () => {
    expect(networkVerdict({ rttMs: rtts(400), uploadKbps: 8000, failed: false }).level).toBe('poor');
    expect(networkVerdict({ rttMs: rtts(100, 8, 70), uploadKbps: 8000, failed: false }).level).toBe('poor');
    const low = networkVerdict({ rttMs: rtts(40), uploadKbps: 80, failed: false });
    expect(low).toMatchObject({ level: 'poor', guests: 0 });
    expect(networkVerdict({ rttMs: rtts(40), uploadKbps: null, failed: false }).messages.join(' ')).toMatch(/could not measure/);
  });
  it('handles an unreachable server', () => {
    expect(networkVerdict({ rttMs: [], uploadKbps: null, failed: true })).toMatchObject({ level: 'poor', guests: 0 });
  });
  it('measures with timed requests and works out an upload speed', async () => {
    let t = 0;
    const calls: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url).split('?')[0]}`);
      t += init?.method === 'POST' ? 520 : 40; // posts take longer
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const r = await measureNetwork(fake, () => t);
    expect(r.failed).toBe(false);
    expect(r.rttMs).toHaveLength(8);
    expect(calls.filter((c) => c.startsWith('GET /api/health'))).toHaveLength(9);
    expect(calls.filter((c) => c === 'POST /api/live/ping')).toHaveLength(2);
    // 200 KB in (520 - 40) ms = 0.48 s => about 3333 kbps
    expect(r.uploadKbps).toBeGreaterThan(3000);
    expect(r.uploadKbps).toBeLessThan(3700);
  });
  it('reports failure when the server cannot be reached', async () => {
    const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect((await measureNetwork(down, () => 0)).failed).toBe(true);
  });
});
