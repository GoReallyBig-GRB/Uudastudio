import { describe, expect, it } from 'vitest';
import { handleFreesound, type FreesoundEnv } from './handler';
import { MemoryUserStore } from '../auth/users';
import { issueSession } from '../auth/session';
import { makeLimiter } from '../auth/rateLimit';

const SECRET = 'test-secret-test-secret-test-secret-0123456789';
const ORIGIN = 'https://uuda.test';
type Seen = { url: string; auth: string; method: string; body: string };

const setup = async (answer: (s: Seen) => Response | Promise<Response>, extra: Partial<FreesoundEnv> = {}) => {
  const now = 1_800_000_000_000;
  const users = new MemoryUserStore();
  await users.signIn({ id: 'u1', email: 'u1@x.test', name: 'U', photo: '', role: 'user', now });
  const session = (await issueSession(SECRET, 'u1', now)).token;
  const seen: Seen[] = [];
  const fetchFn = (async (input: any, init?: any) => {
    const s: Seen = { url: String(input), auth: init?.headers?.Authorization ?? init?.headers?.authorization ?? '', method: init?.method ?? 'GET', body: String(init?.body ?? '') };
    seen.push(s);
    return answer(s);
  }) as typeof fetch;
  const env: FreesoundEnv = { auth: { store: users, projectId: 'p', sessionSecret: SECRET, keys: { find: async () => undefined }, now: () => now }, apiKey: 'APIKEY', clientId: 'CID', clientSecret: 'CSECRET', fetchFn, ...extra };
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
    expect(JSON.stringify(b)).not.toContain('APIKEY');
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
    expect(m.seen[0].auth).toBe('Token APIKEY');
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
    expect(m.seen.map((s) => s.auth)).toEqual(['Bearer OLDTOKEN123', 'Token APIKEY']);
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
    const none = await setup(ok, { apiKey: undefined });
    expect((await none.call('GET', 'search?query=a')).status).toBe(503);
    // Connected users still work without a shared key
    expect((await none.call('GET', 'search?query=a', { bearer: 'USERTOKEN123' })).status).toBe(200);
  });
});

describe('Freesound sign-in with the person\'s own account', () => {
  it('gives the authorize address, and swaps the code for a token without exposing the secret', async () => {
    const m = await setup(() => new Response(JSON.stringify({ access_token: 'TOK', expires_in: 86400, scope: 'read', refresh_token: 'SHOULD-NOT-LEAK' }), { status: 200 }));
    expect(((await (await m.call('GET', 'oauth/url')).json()) as any).authUrl).toBe('https://freesound.org/apiv2/oauth2/authorize/?client_id=CID&response_type=code');
    const r = await m.call('POST', 'oauth/token', { body: { code: ' abc ' } });
    const b = (await r.json()) as any;
    expect(b).toEqual({ access_token: 'TOK', expires_in: 86400, scope: 'read' });
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
