import { describe, expect, it } from 'vitest';
import { handleAuth, type AuthEnv } from './handler';
import { makeLimiter } from './rateLimit';
import { issueSession, readSession } from './session';
import { ACTIVE_WRITE_MS, D1UserStore, MemoryUserStore, type D1Like } from './users';
import { keyCache, TokenError, verifyIdToken, type Jwk, type KeySet } from './verifyIdToken';

const PROJECT = 'demo-project';
const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) => { let s = ''; for (const x of new Uint8Array(b)) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const gen = async () => (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const jwkOf = async (pub: CryptoKey, kid: string): Promise<Jwk> => ({ ...(await crypto.subtle.exportKey('jwk', pub)), kid } as Jwk);
const NOW = 1_800_000_000_000;
const sec = NOW / 1000;

const signToken = async (priv: CryptoKey, kid: string, payload: Record<string, unknown>, header: Record<string, unknown> = {}) => {
  const h = b64u(enc.encode(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT', ...header })));
  const p = b64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', priv, enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
};
const good = (o: Record<string, unknown> = {}) => ({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: 'uid-1', iat: sec - 10, auth_time: sec - 10, exp: sec + 3000, email: 'Ada@Example.com', email_verified: true, name: 'Ada', picture: 'https://x/p.png', firebase: { sign_in_provider: 'google.com' }, ...o });

const setup = async () => {
  const pair = await gen(); const other = await gen();
  const jwk = await jwkOf(pair.publicKey, 'k1');
  const keys = { find: async (kid: string) => (kid === 'k1' ? jwk : undefined) };
  const v = (t: string, o: Partial<Parameters<typeof verifyIdToken>[1]> = {}) => verifyIdToken(t, { projectId: PROJECT, keys, now: () => NOW, ...o });
  return { pair, other, jwk, keys, v };
};
const reason = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof TokenError ? e.reason : `other:${e}`; } };

describe('verifyIdToken', () => {
  it('accepts a genuine token and reads identity from it', async () => {
    const { pair, v } = await setup();
    const id = await v(await signToken(pair.privateKey, 'k1', good()));
    expect(id).toMatchObject({ uid: 'uid-1', email: 'ada@example.com', emailVerified: true, name: 'Ada', provider: 'google.com' });
  });
  it('rejects a token signed with someone else\'s key (a forged admin token)', async () => {
    const { other, v } = await setup();
    expect(await reason(v(await signToken(other.privateKey, 'k1', good({ email: 'admin@example.com' }))))).toBe('bad-signature');
  });
  it('rejects a changed payload', async () => {
    const { pair, v } = await setup();
    const t = (await signToken(pair.privateKey, 'k1', good())).split('.');
    t[1] = b64u(enc.encode(JSON.stringify(good({ email: 'admin@example.com' }))));
    expect(await reason(v(t.join('.')))).toBe('bad-signature');
  });
  it('rejects alg none, HS256 and a missing signature', async () => {
    const { pair, v } = await setup();
    expect(await reason(v(await signToken(pair.privateKey, 'k1', good(), { alg: 'none' })))).toBe('bad-algorithm');
    expect(await reason(v(await signToken(pair.privateKey, 'k1', good(), { alg: 'HS256' })))).toBe('bad-algorithm');
    expect(await reason(v((await signToken(pair.privateKey, 'k1', good())).split('.').slice(0, 2).join('.') + '.'))).toBe('malformed');
    expect(await reason(v('a.b'))).toBe('malformed');
    expect(await reason(v('x'.repeat(9000)))).toBe('malformed');
  });
  it('rejects expired, future, wrong audience and wrong issuer', async () => {
    const { pair, v } = await setup();
    const t = (o: Record<string, unknown>) => signToken(pair.privateKey, 'k1', good(o));
    expect(await reason(v(await t({ exp: sec - 1 })))).toBe('expired');
    expect(await reason(v(await t({ iat: sec + 3600 })))).toBe('from-the-future');
    expect(await reason(v(await t({ aud: 'other-project' })))).toBe('wrong-audience');
    expect(await reason(v(await t({ iss: 'https://securetoken.google.com/other' })))).toBe('wrong-issuer');
    expect(await reason(v(await t({ sub: '' })))).toBe('no-subject');
  });
  it('needs an email that Google has verified', async () => {
    const { pair, v } = await setup();
    expect(await reason(v(await signToken(pair.privateKey, 'k1', good({ email_verified: false }))))).toBe('email-not-verified');
    expect(await reason(v(await signToken(pair.privateKey, 'k1', good({ email: undefined }))))).toBe('no-email');
  });
  it('rejects an unknown key id', async () => {
    const { pair, v } = await setup();
    expect(await reason(v(await signToken(pair.privateKey, 'nope', good())))).toBe('unknown-key');
  });
});

describe('key cache and rotation', () => {
  it('reuses keys, and refetches once when a token names a new key, at most once a minute', async () => {
    const a = await jwkOf((await gen()).publicKey, 'k1'), b = await jwkOf((await gen()).publicKey, 'k2');
    let calls = 0, clock = 0, current: Jwk[] = [a];
    const cache = keyCache(async (): Promise<KeySet> => { calls++; return { keys: current, maxAge: 3600 }; }, () => clock);
    expect((await cache.find('k1'))?.kid).toBe('k1');
    expect((await cache.find('k1'))?.kid).toBe('k1');
    expect(calls).toBe(1);
    current = [a, b]; clock = 120_000; // Google rotates; a token with k2 arrives
    expect((await cache.find('k2'))?.kid).toBe('k2');
    expect(calls).toBe(2);
    expect(await cache.find('junk')).toBeUndefined(); // refresh floor: no new fetch within 60 s
    expect(calls).toBe(2);
    clock = 300_000; expect(await cache.find('junk')).toBeUndefined();
    expect(calls).toBe(3);
  });
});

describe('session tokens', () => {
  it('round-trips, expires, and rejects tampering and another secret', async () => {
    const { token } = await issueSession('s3cret', 'u1', NOW);
    expect((await readSession('s3cret', token, NOW + 1000))?.uid).toBe('u1');
    expect(await readSession('s3cret', token, NOW + 6 * 86400_000)).toBeNull();
    expect(await readSession('other', token, NOW)).toBeNull();
    const forged = token.replace(/^(uuda_sess_)[^.]+/, `$1${b64u(enc.encode(JSON.stringify({ uid: 'admin', iat: NOW, exp: NOW + 1e9 })))}`);
    expect(await readSession('s3cret', forged, NOW)).toBeNull();
    expect(await readSession('', token, NOW)).toBeNull();
    expect(await readSession('s3cret', 'garbage', NOW)).toBeNull();
  });
});

describe('auth routes', () => {
  const mkEnv = async () => {
    const s = await setup();
    const store = new MemoryUserStore();
    let clock = NOW;
    const env: AuthEnv & { tick: (ms: number) => void } = { store, projectId: PROJECT, sessionSecret: 'secret', superAdminEmail: 'boss@example.com', keys: s.keys, now: () => clock, tick: (ms) => { clock += ms; } };
    return { ...s, env, store };
  };
  const call = (env: AuthEnv, method: string, path: string, o: { body?: unknown; token?: string; origin?: string; cookie?: string } = {}) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (o.token) headers.authorization = `Bearer ${o.token}`;
    if (o.cookie) headers.cookie = o.cookie;
    if (o.origin) headers.origin = o.origin;
    return handleAuth(new Request(`https://app.test/api/auth/${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }), path.split('/'), env);
  };
  const login = async (m: Awaited<ReturnType<typeof mkEnv>>, claims: Record<string, unknown> = {}) => {
    const idToken = await signToken(m.pair.privateKey, 'k1', good({ iat: m.env.now() / 1000 - 5, auth_time: m.env.now() / 1000 - 5, exp: m.env.now() / 1000 + 3000, ...claims }));
    return call(m.env, 'POST', 'google', { body: { idToken } });
  };

  it('signs in, creates the user once, returns a session and sets a safe cookie', async () => {
    const m = await mkEnv();
    const r = await login(m);
    expect(r.status).toBe(200);
    const b = (await r.json()) as any;
    expect(b.isNew).toBe(true);
    expect(b.user.email).toBe('ada@example.com');
    expect(b.user.role).toBe('user');
    expect(b.user.validAfter).toBeUndefined();
    expect(r.headers.get('set-cookie')).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    expect(((await (await login(m)).json()) as any).isNew).toBe(false);
    const me = (await (await call(m.env, 'GET', 'me', { token: b.sessionToken })).json()) as any;
    expect(me.user.id).toBe('uid-1');
    expect(me.isAdminVerified).toBe(false);
    expect(((await (await call(m.env, 'GET', 'me', { cookie: `__session=${b.sessionToken}` })).json()) as any).user.id).toBe('uid-1');
  });

  it('refuses a forged token, even one naming the admin', async () => {
    const m = await mkEnv();
    const bad = await signToken(m.other.privateKey, 'k1', good({ email: 'boss@example.com', sub: 'x' }));
    const r = await call(m.env, 'POST', 'google', { body: { idToken: bad } });
    expect(r.status).toBe(401);
    expect(m.store.users.size).toBe(0);
    expect(((await (await call(m.env, 'GET', 'me', {})).json()) as any).user).toBeNull();
  });

  it('gives the admin role only to the configured address, and still keeps admin pages closed', async () => {
    const m = await mkEnv();
    const b = (await (await login(m, { email: 'boss@example.com', sub: 'boss' })).json()) as any;
    expect(b.user.role).toBe('admin');
    const me = (await (await call(m.env, 'GET', 'me', { token: b.sessionToken })).json()) as any;
    expect(me.isAdminVerified).toBe(false);
  });

  it('signing out ends old sessions but a new sign-in works at once', async () => {
    const m = await mkEnv();
    const a = (await (await login(m)).json()) as any;
    m.env.tick(5);
    await call(m.env, 'POST', 'signout', { token: a.sessionToken });
    expect(((await (await call(m.env, 'GET', 'me', { token: a.sessionToken })).json()) as any).user).toBeNull();
    m.env.tick(5);
    const b = (await (await login(m)).json()) as any;
    expect(((await (await call(m.env, 'GET', 'me', { token: b.sessionToken })).json()) as any).user.id).toBe('uid-1');
  });

  it('refuses blocked users, even with a valid token', async () => {
    const m = await mkEnv();
    const a = (await (await login(m)).json()) as any;
    m.store.users.set('uid-1', { ...m.store.users.get('uid-1')!, blocked: true });
    expect(((await (await call(m.env, 'GET', 'me', { token: a.sessionToken })).json()) as any).user).toBeNull();
    expect((await login(m)).status).toBe(403);
  });

  it('keeps the email permanent when the profile is changed, and rejects cross-site writes', async () => {
    const m = await mkEnv();
    const a = (await (await login(m)).json()) as any;
    expect((await call(m.env, 'PUT', 'profile', { token: a.sessionToken, body: { email: 'x@y.z' } })).status).toBe(400);
    const r = await call(m.env, 'PUT', 'profile', { token: a.sessionToken, body: { display_name: 'Ada L', preferences: { autoRefresh: false, defaultVoice: 'Puck' } } });
    const u = ((await r.json()) as any).user;
    expect(u.display_name).toBe('Ada L'); expect(u.preferences.autoRefresh).toBe(false); expect(u.preferences.defaultVoice).toBe('Puck'); expect(u.email).toBe('ada@example.com');
    expect((await call(m.env, 'PUT', 'profile', { token: a.sessionToken, origin: 'https://evil.test', body: { display_name: 'x' } })).status).toBe(403);
    expect((await call(m.env, 'PUT', 'profile', { body: { display_name: 'x' } })).status).toBe(401);
  });
});

describe('D1 user store', () => {
  /** A tiny stand-in for D1 that records the statements it is given */
  const fakeD1 = () => {
    const rows = new Map<string, any>(); const log: string[] = [];
    const db: D1Like = {
      exec: async (q) => { log.push('exec'); void q; },
      prepare: (q: string) => ({ bind: (...v: unknown[]) => ({
        first: async () => { log.push('read'); return rows.get(String(v[0])) ?? null; },
        run: async () => {
          log.push('write');
          if (q.startsWith('INSERT')) rows.set(String(v[0]), { id: v[0], email: v[1], display_name: v[2], photo_url: v[3], role: v[4], created_at: v[5], last_active_at: v[6], blocked: 0, prefs: v[7], valid_after: 0 });
          else if (q.startsWith('UPDATE users SET last_active_at')) { const r = rows.get(String(v[2])); r.last_active_at = v[0]; r.photo_url = v[1]; }
          else if (q.startsWith('UPDATE users SET display_name')) { const r = rows.get(String(v[2])); r.display_name = v[0]; r.prefs = v[1]; }
          else if (q.startsWith('UPDATE users SET valid_after')) { const r = rows.get(String(v[1])); r.valid_after = Math.max(r.valid_after, Number(v[0])); }
        },
      }) }),
    };
    return { db, rows, log };
  };
  it('creates once, and spares writes on repeat sign-ins within the hour', async () => {
    const { db, log } = fakeD1(); const s = new D1UserStore(db);
    const p = { id: 'u', email: 'a@b.c', name: 'A', photo: '', role: 'user' as const, now: NOW };
    expect((await s.signIn(p)).isNew).toBe(true);
    expect(log.filter((x) => x === 'exec')).toHaveLength(1); // the table is made once
    const writes = () => log.filter((x) => x === 'write').length;
    const w0 = writes();
    expect((await s.signIn({ ...p, now: NOW + 60_000 })).isNew).toBe(false);
    expect(writes()).toBe(w0); // within the hour: no write
    await s.signIn({ ...p, now: NOW + ACTIVE_WRITE_MS + 1 });
    expect(writes()).toBe(w0 + 1);
  });
  it('revokes and updates', async () => {
    const { db } = fakeD1(); const s = new D1UserStore(db);
    await s.signIn({ id: 'u', email: 'a@b.c', name: 'A', photo: '', role: 'user', now: NOW });
    await s.revokeBefore('u', 500);
    expect((await s.get('u'))?.validAfter).toBe(500);
    const u = await s.update('u', { display_name: 'New', preferences: { autoRefresh: false } });
    expect(u?.display_name).toBe('New'); expect(u?.preferences.autoRefresh).toBe(false);
    expect(await s.update('nobody', { display_name: 'x' })).toBeNull();
  });
});

describe('sign-in rate limit', () => {
  it('lets the limit through, then says how long to wait, per caller, and recovers', () => {
    let t = 0; const l = makeLimiter(3, 60_000, () => t);
    expect([l.take('a'), l.take('a'), l.take('a')]).toEqual([0, 0, 0]);
    expect(l.take('a')).toBeGreaterThan(0);
    expect(l.take('b')).toBe(0);
    t = 61_000; expect(l.take('a')).toBe(0);
  });
  it('answers 429 with Retry-After on the route', async () => {
    const s = await setup();
    const env: AuthEnv = { store: new MemoryUserStore(), projectId: PROJECT, sessionSecret: 'x', keys: s.keys, now: () => NOW, limiter: makeLimiter(2, 60_000, () => NOW), caller: () => 'ip' };
    const go = () => handleAuth(new Request('https://app.test/api/auth/google', { method: 'POST', body: JSON.stringify({ idToken: 'a.b.c' }) }), ['google'], env);
    expect((await go()).status).toBe(401); expect((await go()).status).toBe(401);
    const r = await go(); expect(r.status).toBe(429); expect(r.headers.get('retry-after')).toBe('60');
  });
});
