import { describe, expect, it } from 'vitest';
import { handleFreesound, type FreesoundEnv } from './handler';
import { D1TokenStore, makeSealer, MemoryTokenStore } from './tokens';
import type { D1Full } from '../templates/store';
import { MemoryUserStore } from '../auth/users';
import { issueSession } from '../auth/session';
import { makeLimiter } from '../auth/rateLimit';

const SECRET = 'test-secret-test-secret-test-secret-0123456789';
const ORIGIN = 'https://uuda.test';
type Seen = { url: string; auth: string; method: string; body: string };

const clock = { t: 1_800_000_000_000 };
const setup = async (answer: (s: Seen) => Response | Promise<Response>, extra: Partial<FreesoundEnv> = {}) => {
  clock.t = 1_800_000_000_000;
  const now = clock.t;
  const users = new MemoryUserStore();
  await users.signIn({ id: 'u1', email: 'u1@x.test', name: 'U', photo: '', role: 'user', now });
  const session = (await issueSession(SECRET, 'u1', now)).token;
  const seen: Seen[] = [];
  const fetchFn = (async (input: any, init?: any) => {
    const s: Seen = { url: String(input), auth: init?.headers?.Authorization ?? init?.headers?.authorization ?? '', method: init?.method ?? 'GET', body: String(init?.body ?? '') };
    seen.push(s);
    return answer(s);
  }) as typeof fetch;
  const env: FreesoundEnv = { auth: { store: users, projectId: 'p', sessionSecret: SECRET, keys: { find: async () => undefined }, now: () => now }, clientId: 'CID', clientSecret: 'CSECRET', fetchFn, now: () => clock.t, ...extra };
  const call = (method: string, path: string, o: { signedIn?: boolean; bearer?: string; body?: unknown; origin?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (o.signedIn !== false) headers.cookie = `__session=${session}`;
    if (o.bearer) headers.authorization = `Bearer ${o.bearer}`;
    if (o.origin) headers.origin = o.origin;
    return handleFreesound(new Request(`${ORIGIN}/api/freesound/${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }), path.split('?')[0].split('/').filter(Boolean), env);
  };
  return { seen, call };
};
const ok = () => new Response(JSON.stringify({ count: 1, results: [{ id: 1 }] }), { status: 200, headers: { 'X-RateLimit-Remaining': '55', 'X-RateLimit-Reset': '30' } });

describe('Freesound config', () => {
  it('is public and never shows a secret', async () => {
    const m = await setup(ok);
    const b = (await (await m.call('GET', 'config', { signedIn: false })).json()) as any;
    expect(b).toEqual({ enabled: true, hasApiKey: true, clientId: 'CID' });
    expect(JSON.stringify(b)).not.toContain('CSECRET');
      });
});

describe('Freesound search', () => {
  it('needs sign-in', async () => {
    const m = await setup(ok);
    expect((await m.call('GET', 'search?query=door', { signedIn: false })).status).toBe(401);
    expect(m.seen.length).toBe(0);
  });

  it('uses the shared key for someone who has not connected, and only asks for CC0', async () => {
    const m = await setup(ok);
    const r = await m.call('GET', 'search?query=door&tag=wood%22x&sort=nonsense&pageSize=999&page=0&minDuration=1&maxDuration=5');
    const b = (await r.json()) as any;
    expect(r.status).toBe(200);
    expect(b.via).toBe('shared');
    expect(b.rateLimitRemaining).toBe(55);
    expect(m.seen[0].auth).toBe('Token CSECRET');
    const u = new URL(m.seen[0].url);
    expect(u.searchParams.get('filter')).toBe('license:"Creative Commons 0" tag:"woodx" duration:[1 TO 5]');
    expect(u.searchParams.get('sort')).toBe('score');
    expect(u.searchParams.get('page_size')).toBe('50');
    expect(u.searchParams.get('page')).toBe('1');
  });

  it("uses the person's own token when they have connected one", async () => {
    const m = await setup(ok);
    const b = (await (await m.call('GET', 'search?query=door', { bearer: 'USERTOKEN123' })).json()) as any;
    expect(b.via).toBe('user');
    expect(m.seen.length).toBe(1);
    expect(m.seen[0].auth).toBe('Bearer USERTOKEN123');
  });

  it('falls back to the shared key when their token has expired', async () => {
    const m = await setup((s) => (s.auth.startsWith('Bearer') ? new Response('{}', { status: 401 }) : ok()));
    const b = (await (await m.call('GET', 'search?query=door', { bearer: 'OLDTOKEN123' })).json()) as any;
    expect(b.via).toBe('shared');
    expect(m.seen.map((s) => s.auth)).toEqual(['Bearer OLDTOKEN123', 'Token CSECRET']);
  });

  it('caps shared-key searches tighter than own-token searches, per person', async () => {
    const m = await setup(ok, { limits: { search: makeLimiter(5, 60_000, () => 0), sharedSearch: makeLimiter(2, 60_000, () => 0), other: makeLimiter(30, 60_000) } });
    expect((await m.call('GET', 'search?query=a')).status).toBe(200);
    expect((await m.call('GET', 'search?query=b')).status).toBe(200);
    const r = await m.call('GET', 'search?query=c');
    expect(r.status).toBe(429);
    expect(((await r.json()) as any).rateLimited).toBe(true);
    // A connected person is not held to the shared cap
    expect((await m.call('GET', 'search?query=d', { bearer: 'USERTOKEN123' })).status).toBe(200);
  });

  it('passes Freesound\'s own limit on as a plain message with the wait time', async () => {
    const m = await setup(() => new Response('{}', { status: 429, headers: { 'X-RateLimit-Reset': '42' } }));
    const r = await m.call('GET', 'search?query=a');
    const b = (await r.json()) as any;
    expect(r.status).toBe(429);
    expect(b.rateLimited).toBe(true);
    expect(b.resetSeconds).toBe(42);
    expect(b.error).toMatch(/wait/i);
  });

  it('says so when Freesound cannot be reached, or when no key is set and nobody is connected', async () => {
    const down = await setup(() => { throw new Error('offline'); });
    expect((await down.call('GET', 'search?query=a')).status).toBe(502);
    const none = await setup(ok, { clientSecret: undefined });
    expect((await none.call('GET', 'search?query=a')).status).toBe(503);
    // Connected users still work without a shared key
    expect((await none.call('GET', 'search?query=a', { bearer: 'USERTOKEN123' })).status).toBe(200);
  });
});

describe('Freesound sign-in with the person\'s own account', () => {
  it('gives the authorize address, and swaps the code for a token without exposing the secret', async () => {
    const m = await setup(() => new Response(JSON.stringify({ access_token: 'TOK', expires_in: 86400, scope: 'read', refresh_token: 'SHOULD-NOT-LEAK' }), { status: 200 }));
    const u = (await (await m.call('GET', 'oauth/url')).json()) as any;
    expect(u.authUrl).toBe(`https://freesound.org/apiv2/oauth2/authorize/?client_id=CID&response_type=code&state=${u.state}`);
    expect(u.state).toMatch(/^[0-9a-f]{32}$/);
    const r = await m.call('POST', 'oauth/token', { body: { code: ' abc ' } });
    const b = (await r.json()) as any;
    expect(b).toEqual({ access_token: 'TOK', expires_in: 86400, scope: 'read', lasting: false });
    expect(m.seen[0].body).toContain('client_secret=CSECRET');
    expect(m.seen[0].body).toContain('code=abc');
    expect(JSON.stringify(b)).not.toContain('CSECRET');
  });

  it('turns Freesound\'s refusals into sentences, and refuses cross-site or empty requests', async () => {
    const m = await setup(() => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
    const bad = await m.call('POST', 'oauth/token', { body: { code: 'old' } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error).toMatch(/fresh code/);
    expect((await m.call('POST', 'oauth/token', { body: {} })).status).toBe(400);
    expect((await m.call('POST', 'oauth/token', { body: { code: 'x' }, origin: 'https://evil.example' })).status).toBe(403);
    expect((await m.call('POST', 'oauth/token', { body: { code: 'x' }, signedIn: false })).status).toBe(401);
  });
});

describe('Freesound download', () => {
  it('needs sign-in and a connected Freesound token, and checks the id', async () => {
    const m = await setup(ok);
    expect((await m.call('GET', 'download/123', { signedIn: false, bearer: 'USERTOKEN123' })).status).toBe(401);
    expect((await m.call('GET', 'download/123')).status).toBe(401);
    expect((await m.call('GET', 'download/12a', { bearer: 'USERTOKEN123' })).status).toBe(400);
    expect((await m.call('GET', 'download/../x', { bearer: 'USERTOKEN123' })).status).toBe(404);
    expect(m.seen.length).toBe(0);
  });

  it('streams the original with the person\'s own token (not the shared key)', async () => {
    const m = await setup(() => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'audio/wav' } }));
    const r = await m.call('GET', 'download/123', { bearer: 'USERTOKEN123' });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/wav');
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([1, 2, 3, 4]);
    expect(m.seen[0].url).toBe('https://freesound.org/apiv2/sounds/123/download/');
    expect(m.seen[0].auth).toBe('Bearer USERTOKEN123');
  });

  it('reports a rejected connection and a download limit plainly', async () => {
    const a = await setup(() => new Response('', { status: 401 }));
    const ra = await a.call('GET', 'download/123', { bearer: 'USERTOKEN123' });
    expect(ra.status).toBe(401);
    expect(((await ra.json()) as any).error).toMatch(/Connect your account again/);
    const b = await setup(() => new Response('', { status: 429 }));
    const rb = await b.call('GET', 'download/123', { bearer: 'USERTOKEN123' });
    expect(rb.status).toBe(429);
    expect(((await rb.json()) as any).rateLimited).toBe(true);
  });
});

describe('Freesound lasting connection', () => {
  const tokenReply = (access: string, refresh: string, expires = 86400) => new Response(JSON.stringify({ access_token: access, refresh_token: refresh, expires_in: expires, scope: 'read' }), { status: 200 });
  const post = (m: Awaited<ReturnType<typeof setup>>, path: string, body?: unknown) => m.call('POST', path, { body });

  it('works with the Freesound API key alone, since it is the same string as the client secret', async () => {
    const m = await setup(ok, { clientSecret: undefined, apiKey: 'ONLYKEY' });
    await m.call('GET', 'search?query=a');
    expect(m.seen[0].auth).toBe('Token ONLYKEY');
    expect(((await (await m.call('GET', 'config', { signedIn: false })).json()) as any).enabled).toBe(true);
  });

  it('remembers the connection, then hands out a working token with nothing pasted, and renews it before it runs out', async () => {
    const tokens = new MemoryTokenStore();
    const m = await setup((s) => s.body.includes('grant_type=authorization_code') ? tokenReply('ACC1', 'REF1') : s.body.includes('refresh_token=REF1') ? tokenReply('ACC2', 'REF2') : s.body.includes('refresh_token=REF2') ? tokenReply('ACC3', 'REF3') : new Response('{}', { status: 400 }), { tokens });
    expect(((await (await post(m, 'oauth/session')).json()) as any).connected).toBe(false);
    const first = (await (await post(m, 'oauth/token', { code: 'abc' })).json()) as any;
    expect(first.lasting).toBe(true);
    // Later (a new tab, a new visit): no code, the stored connection answers. No call to Freesound is needed.
    const calls = m.seen.length;
    const s1 = (await (await post(m, 'oauth/session')).json()) as any;
    expect(s1).toMatchObject({ connected: true, access_token: 'ACC1' });
    expect(m.seen.length).toBe(calls);
    // Close to expiry: renewed silently, and the refresh token is replaced
    clock.t += 86400_000 - 60_000;
    const s2 = (await (await post(m, 'oauth/session')).json()) as any;
    expect(s2).toMatchObject({ connected: true, access_token: 'ACC2' });
    expect((await tokens.get('u1'))?.refresh).toBe('REF2');
    clock.t += 86400_000 - 60_000;
    expect(((await (await post(m, 'oauth/session')).json()) as any).access_token).toBe('ACC3');
  });

  it('forgets a connection Freesound no longer honours, so the person connects again', async () => {
    const tokens = new MemoryTokenStore();
    await tokens.put('u1', { refresh: 'DEAD', access: 'OLD', expires: clock.t + 1000 });
    const m = await setup(() => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }), { tokens });
    await tokens.put('u1', { refresh: 'DEAD', access: 'OLD', expires: clock.t + 1000 });
    const b = (await (await post(m, 'oauth/session')).json()) as any;
    expect(b).toEqual({ connected: false, expired: true });
    expect(await tokens.get('u1')).toBeNull();
  });

  it('does not disconnect someone when two tabs renew at the same moment', async () => {
    const tokens = new MemoryTokenStore();
    const m = await setup(async () => {
      // The other tab got there first: it has already stored the new connection when this refusal arrives
      await tokens.put('u1', { refresh: 'REF-NEW', access: 'ACC-NEW', expires: clock.t + 86400_000 });
      return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    }, { tokens });
    await tokens.put('u1', { refresh: 'REF-OLD', access: 'ACC-OLD', expires: clock.t + 1000 });
    const b = (await (await post(m, 'oauth/session')).json()) as any;
    expect(b).toMatchObject({ connected: true, access_token: 'ACC-NEW' });
  });

  it('disconnects on request, and only for a signed-in same-site caller', async () => {
    const tokens = new MemoryTokenStore();
    const m = await setup(ok, { tokens });
    await tokens.put('u1', { refresh: 'R', access: 'A', expires: clock.t + 86400_000 });
    expect((await m.call('DELETE', 'oauth/session', { signedIn: false })).status).toBe(401);
    expect((await m.call('DELETE', 'oauth/session', { origin: 'https://evil.example' })).status).toBe(403);
    expect(await tokens.get('u1')).not.toBeNull();
    expect(((await (await m.call('DELETE', 'oauth/session')).json()) as any).connected).toBe(false);
    expect(await tokens.get('u1')).toBeNull();
    expect((await m.call('POST', 'oauth/session', { origin: 'https://evil.example' })).status).toBe(403);
  });

  it('keeps the stored tokens encrypted, and unreadable with a different secret', async () => {
    const rows = new Map<string, string>();
    const db = {
      exec: async () => undefined,
      prepare: (q: string) => ({ bind: (...v: unknown[]) => ({
        first: async () => (q.startsWith('SELECT') ? (rows.has(String(v[0])) ? { data: rows.get(String(v[0])) } : null) : null),
        run: async () => { if (q.startsWith('INSERT')) rows.set(String(v[0]), String(v[1])); else rows.delete(String(v[0])); },
        all: async () => ({ results: [] }),
      }) }),
    } as unknown as D1Full;
    const store = new D1TokenStore(db, makeSealer('secret-one-secret-one-secret-one-1234'));
    await store.put('u1', { refresh: 'REFRESH-PLAIN', access: 'ACCESS-PLAIN', expires: 5 });
    const stored = rows.get('u1')!;
    expect(stored).not.toContain('REFRESH-PLAIN');
    expect(stored).not.toContain('ACCESS-PLAIN');
    expect(await store.get('u1')).toEqual({ refresh: 'REFRESH-PLAIN', access: 'ACCESS-PLAIN', expires: 5 });
    expect(await new D1TokenStore(db, makeSealer('a-different-secret-a-different-secret-12')).get('u1')).toBeNull();
    // A changed value is refused rather than read
    rows.set('u1', stored.slice(0, -2) + (stored.endsWith('AA') ? 'BB' : 'AA'));
    expect(await store.get('u1')).toBeNull();
    await store.delete('u1');
    expect(rows.has('u1')).toBe(false);
  });
});
