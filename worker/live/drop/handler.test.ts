import { describe, expect, it } from 'vitest';
import { MemoryLiveStore } from '../store';
import { handleDrop } from './handler';
import { makeTicket } from './ticket';
import { DropRouter } from './router';

const now = 5_000_000_000;
const calls: Array<{ url: string; method: string }> = [];
const drops = { idFromName: (n: string) => n, get: () => ({ fetch: async (r: Request) => { calls.push({ url: r.url, method: r.method }); return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }); } }) } as unknown as DurableObjectNamespace;
const store = new MemoryLiveStore();
store.events.set('ev1', { id: 'ev1', userId: 'host', token: 'tokentokentoken', activatedAt: now - 1000, endedAt: null, startsAt: null, durationMin: null, kind: 'interview', mode: 'conversation' } as never);
const env = { auth: {} as never, store, drops, secret: 's3cret', now: () => now };
const call = (path: string, init: RequestInit = {}) => handleDrop(new Request(`https://x.test/api/live/drop/${path}`, init), path.split('?')[0].split('/'), env);

describe('drop routes', () => {
  it('hands a guest a ticket and accepts an upload only with it', async () => {
    const t = await call('tokentokentoken/ticket', { method: 'POST', body: JSON.stringify({ takeId: 'take-1-abc' }) });
    expect(t.status).toBe(200);
    const { ticket } = (await t.json()) as { ticket: string };
    expect((await call('tokentokentoken/init?take=take-1-abc', { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await call('tokentokentoken/init?take=take-2-abc', { method: 'POST', body: '{}', headers: { 'x-drop-ticket': ticket } })).status).toBe(401);
    expect((await call('tokentokentoken/init?take=take-1-abc', { method: 'POST', body: '{}', headers: { 'x-drop-ticket': ticket } })).status).toBe(200);
    expect(calls.at(-1)?.url).toContain('/init?take=take-1-abc');
  });
  it('a ticket from before the event ended still works after it', async () => {
    const ticket = await makeTicket('s3cret', 'ev1', 'take-1-abc', now - 1000);
    store.events.set('ev1', { ...store.events.get('ev1')!, endedAt: now - 30 * 3600_000 } as never);
    expect((await call('tokentokentoken/complete?take=take-1-abc', { method: 'POST', headers: { 'x-drop-ticket': ticket } })).status).toBe(200);
    expect((await call('tokentokentoken/ticket', { method: 'POST', body: JSON.stringify({ takeId: 'take-1-abc' }) })).status).toBe(410);
  });
  it('only the signed-in host may list or collect; a wrong link is refused', async () => {
    expect((await call('tokentokentoken/list')).status).toBe(401);
    expect((await call('nope/list')).status).toBe(404);
    expect((await call('tokentokentoken/collected?take=take-1-abc', { method: 'POST' })).status).toBe(401);
  });
});

/** A stand-in for the few SQL statements the router uses */
function fakeSql() {
  const kv = new Map<string, string>(), b2 = new Map<string, number>();
  return { exec(q: string, ...b: unknown[]) {
    if (q.startsWith('CREATE')) return { toArray: () => [] };
    if (q.includes("FROM kv")) return { toArray: () => (kv.has('dropMode') ? [{ v: kv.get('dropMode') }] : []) };
    if (q.includes("INTO kv")) { kv.set('dropMode', String(b[0])); return { toArray: () => [] }; }
    if (q.includes('SUM(bytes)')) return { toArray: () => [{ n: [...b2.values()].reduce((a, c) => a + c, 0) }] };
    if (q.includes('INTO b2usage')) { b2.set(String(b[0]), Number(b[1])); return { toArray: () => [] }; }
    if (q.includes('DELETE FROM b2usage')) { b2.delete(String(b[0])); return { toArray: () => [] }; }
    throw new Error(q);
  } };
}
describe('router with memory of its mode', () => {
  it('switches at 80%, stays on B2 until under 65%, then returns', () => {
    const G = 1024 ** 3; let doTotal = 4.1 * G;
    const r = new DropRouter(fakeSql(), () => doTotal);
    expect(r.route(1e6, true).backing).toBe('b2');
    doTotal = 3.5 * G; // 70%: still B2
    expect(r.route(1e6, true).backing).toBe('b2');
    doTotal = 3.2 * G; // 64%: back
    expect(r.route(1e6, true).backing).toBe('do');
    r.setB2('a', 100); expect(r.b2Total()).toBe(100); r.setB2('a', 0); expect(r.b2Total()).toBe(0);
  });
  it('with no B2 it keeps using the Durable Object up to 95%', () => {
    const r = new DropRouter(fakeSql(), () => 4.5 * 1024 ** 3);
    expect(r.route(1e6, false).backing).toBe('do');
    expect(new DropRouter(fakeSql(), () => 4.9 * 1024 ** 3).route(1e6, false).backing).toBeNull();
  });
});
