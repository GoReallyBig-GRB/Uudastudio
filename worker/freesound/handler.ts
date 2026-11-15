/**
 * Freesound on the Worker: a thin proxy so the API key and the OAuth client secret never reach the browser.
 *   GET  /api/freesound/config          public: is it on, and the public client id
 *   GET  /api/freesound/search          signed-in users only, CC0 sounds only. Uses the person's own Freesound token when they have connected one, else Uuda's shared key
 *   GET  /api/freesound/oauth/url       the page where the user approves Uuda on Freesound
 *   POST /api/freesound/oauth/token     swaps the one-time code for the user's own Freesound token
 *   GET  /api/freesound/download/:id    streams the original file, using the user's own Freesound token
 * Secrets are Worker secrets: FREESOUND_API_KEY and FREESOUND_CLIENT_SECRET. FREESOUND_CLIENT_ID is a plain variable.
 * The download is passed straight through (never read into memory), so it costs almost no CPU.
 */
import { userFor, type AuthEnv } from '../auth/handler';
import type { Limiter } from '../auth/rateLimit';
import type { TokenStore, FreesoundTokens } from './tokens';

export interface FreesoundEnv {
  auth: AuthEnv;
  /** Freesound's "Client Secret" and "API key" are the same string. Either name works; if both are set the client secret wins. */
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
  /** Where each person's connection (refresh token) is kept. Without it, connecting works but does not last. */
  tokens?: TokenStore;
  now?: () => number;
  enabled?: boolean;
  /** Test seam: defaults to the global fetch */
  fetchFn?: typeof fetch;
  /** `search`: per person when they search with their own Freesound token; `sharedSearch`: tighter, when the request has to use Uuda's shared key */
  limits?: { search: Limiter; sharedSearch: Limiter; other: Limiter };
}

const H = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
const send = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...H, ...extra } });
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => send({ error, ...extra }, status);
const sameSite = (req: Request) => { const o = req.headers.get('origin'); return !o || o === new URL(req.url).origin; };

const FIELDS = 'id,name,tags,description,duration,license,username,url,previews,images,filesize,type,samplerate';
const int = (v: string | null, d: number, lo: number, hi: number) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, n)) : d; };
const num = (v: string | null, d: number) => { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) && n >= 0 ? n : d; };

export const handleFreesound = async (req: Request, rest: string[], env: FreesoundEnv): Promise<Response> => {
  const f = env.fetchFn ?? fetch;
  const secret = env.clientSecret || env.apiKey;
  const now = env.now ?? Date.now;
  const url = new URL(req.url);
  const route = rest.join('/');
  const get = req.method === 'GET';

  if (route === 'config' && get) {
    return send({ enabled: env.enabled ?? !!secret, hasApiKey: !!secret, clientId: env.clientId || null });
  }

  // Everything else needs a signed-in user. Cookie only: the Authorization header here is the user's Freesound token.
  const me = await userFor(req, env.auth, true);
  if (!me) return fail(401, 'Sign in to use the sound library.');

  if (route === 'search' && get) {
    // A connected person searches with their own Freesound token: their own quota, tied to their own account.
    // Anyone else (or an expired token) goes through Uuda's shared key, with a tighter per-person cap so one person cannot use up the shared quota.
    const a = req.headers.get('authorization') ?? '';
    const userToken = a.startsWith('Bearer ') && a.length > 10 ? a.slice(7).trim() : '';
    const q = url.searchParams;
    // Only CC0 (public domain) sounds are ever returned
    const filter = ['license:"Creative Commons 0"'];
    const tag = (q.get('tag') ?? '').trim();
    if (tag) filter.push(`tag:"${tag.replace(/["\\]/g, '')}"`);
    if (q.get('minDuration') || q.get('maxDuration')) filter.push(`duration:[${num(q.get('minDuration'), 0)} TO ${num(q.get('maxDuration'), 300)}]`);
    const sort = ['score', 'duration_desc', 'duration_asc', 'created_desc', 'created_asc', 'downloads_desc', 'rating_desc'].includes(q.get('sort') ?? '') ? q.get('sort')! : 'score';
    const u = new URL('https://freesound.org/apiv2/search/text/');
    u.searchParams.set('query', (q.get('query') ?? '').slice(0, 200) || '*');
    u.searchParams.set('filter', filter.join(' '));
    u.searchParams.set('sort', sort);
    u.searchParams.set('page', String(int(q.get('page'), 1, 1, 1000)));
    u.searchParams.set('page_size', String(int(q.get('pageSize'), 15, 1, 50)));
    u.searchParams.set('fields', FIELDS);
    const call = async (authorization: string) => { try { return await f(u.toString(), { headers: { Authorization: authorization } }); } catch { return null; } };
    const busy = (wait: number) => fail(429, `Too many searches. Try again in ${wait} seconds.`, { rateLimited: true });

    let r: Response | null = null;
    let via: 'user' | 'shared' = 'shared';
    if (userToken) {
      const wait = env.limits?.search.take(me.user.id) ?? 0;
      if (wait) return busy(wait);
      r = await call(`Bearer ${userToken}`);
      if (r && (r.status === 401 || r.status === 403)) r = null; // expired or revoked: fall back to the shared key
      else via = 'user';
    }
    if (!r && via === 'shared') {
      if (!secret) return userToken ? fail(401, 'Freesound did not accept your connection. Connect your account again.') : fail(503, 'The sound library is not set up on the server yet.');
      const wait = env.limits?.sharedSearch.take(me.user.id) ?? 0;
      if (wait) return busy(wait);
      r = await call(`Token ${secret}`);
    }
    if (!r) return fail(502, 'Could not reach Freesound. Try again shortly.');
    const remaining = r.headers.get('X-RateLimit-Remaining'); const reset = r.headers.get('X-RateLimit-Reset');
    if (r.status === 429) return send({ error: 'Freesound is busy right now (60 searches a minute, 2,000 a day). Wait a moment and try again.', rateLimited: true, resetSeconds: reset ? parseInt(reset, 10) : 60 }, 429);
    if (!r.ok) return fail(r.status === 404 ? 404 : 502, 'Freesound could not complete that search.');
    const data = (await r.json()) as Record<string, unknown>;
    return send({ ...data, rateLimitRemaining: remaining ? parseInt(remaining, 10) : null, rateLimitReset: reset ? parseInt(reset, 10) : null, via });
  }

  const wait = env.limits?.other.take(me.user.id) ?? 0;
  if (wait) return fail(429, `Too many requests. Try again in ${wait} seconds.`);

  if (route === 'oauth/url' && get) {
    if (!env.clientId) return fail(500, 'Freesound sign-in is not set up on the server yet.');
    // `state` comes back unchanged on Freesound's redirect; the browser checks it so only a sign-in this person started is accepted
    const state = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return send({ authUrl: `https://freesound.org/apiv2/oauth2/authorize/?client_id=${encodeURIComponent(env.clientId)}&response_type=code&state=${state}`, state });
  }

  // Freesound's token address, for both the first connection (code) and renewals (refresh token)
  const tokenCall = async (params: Record<string, string>) => {
    if (!env.clientId || !secret) return { kind: 'setup' as const };
    let r: Response;
    try { r = await f('https://freesound.org/apiv2/oauth2/access_token/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.clientId, client_secret: secret, ...params }).toString() }); } catch { return { kind: 'network' as const }; }
    if (!r.ok) { let c = ''; try { c = String(((await r.json()) as { error?: unknown }).error ?? ''); } catch { /* not JSON */ } return { kind: 'refused' as const, status: r.status, code: c }; }
    const t = (await r.json()) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown };
    if (typeof t.access_token !== 'string' || !t.access_token) return { kind: 'refused' as const, status: 502, code: '' };
    const seconds = Number(t.expires_in) > 0 ? Number(t.expires_in) : 86400;
    return { kind: 'ok' as const, access: t.access_token, refresh: typeof t.refresh_token === 'string' ? t.refresh_token : '', seconds, scope: t.scope };
  };

  if (route === 'oauth/token' && req.method === 'POST') {
    if (!sameSite(req)) return fail(403, 'Not allowed.');
    let code = ''; try { const b = (await req.json()) as { code?: unknown }; code = typeof b.code === 'string' ? b.code.trim() : ''; } catch { /* empty */ }
    if (!code) return fail(400, 'Authorization code is required.');
    const t = await tokenCall({ grant_type: 'authorization_code', code });
    if (t.kind === 'setup') return fail(500, 'Freesound sign-in is not set up on the server yet.');
    if (t.kind === 'network') return fail(502, 'Could not reach Freesound. Try again shortly.');
    if (t.kind === 'refused') {
      // Freesound's own reply is never passed on: it becomes a sentence the user can act on
      const message = t.code === 'invalid_grant'
        ? 'Freesound did not accept that code. Codes work once and expire after a few minutes, and an API key cannot be used here. Press "Authorize on Freesound" for a fresh code and paste it right away.'
        : t.code === 'invalid_client' || t.code === 'unauthorized_client'
        ? "Freesound did not accept this app's credentials. The server administrator needs to check the Freesound client ID and secret."
        : 'Freesound could not connect your account. Please try again.';
      return send({ error: message, code: t.code || undefined }, t.status === 400 ? 400 : 502);
    }
    // Remember the connection so it renews itself. The access token lasts a little less than Freesound says, so it is renewed early.
    if (env.tokens && t.refresh) await env.tokens.put(me.user.id, { refresh: t.refresh, access: t.access, expires: now() + t.seconds * 1000 });
    return send({ access_token: t.access, expires_in: t.seconds, scope: t.scope, lasting: !!(env.tokens && t.refresh) });
  }

  // The person's current connection. Gives a working access token, renewing it first if it is about to run out.
  if (route === 'oauth/session' && req.method === 'POST') {
    if (!sameSite(req)) return fail(403, 'Not allowed.');
    if (!env.tokens) return send({ connected: false });
    const rec = await env.tokens.get(me.user.id);
    if (!rec) return send({ connected: false });
    const left = rec.expires - now();
    if (left > 5 * 60_000) return send({ connected: true, access_token: rec.access, expires_in: Math.floor(left / 1000) });
    const t = await tokenCall({ grant_type: 'refresh_token', refresh_token: rec.refresh });
    if (t.kind === 'network' || t.kind === 'setup') return fail(502, 'Could not reach Freesound. Try again shortly.');
    if (t.kind === 'refused') {
      // Two tabs may renew at the same moment; the second is refused because the first already replaced the refresh token.
      const cur = await env.tokens.get(me.user.id);
      if (cur && cur.refresh !== rec.refresh && cur.expires - now() > 60_000) return send({ connected: true, access_token: cur.access, expires_in: Math.floor((cur.expires - now()) / 1000) });
      await env.tokens.delete(me.user.id); // revoked on Freesound, or too old: the person connects again
      return send({ connected: false, expired: true });
    }
    const next: FreesoundTokens = { refresh: t.refresh || rec.refresh, access: t.access, expires: now() + t.seconds * 1000 };
    await env.tokens.put(me.user.id, next);
    return send({ connected: true, access_token: next.access, expires_in: t.seconds });
  }

  if (route === 'oauth/session' && req.method === 'DELETE') {
    if (!sameSite(req)) return fail(403, 'Not allowed.');
    if (env.tokens) await env.tokens.delete(me.user.id);
    return send({ connected: false });
  }

  if (rest[0] === 'download' && rest.length === 2 && get) {
    const id = rest[1];
    if (!/^\d{1,12}$/.test(id)) return fail(400, 'Invalid sound id.');
    const auth = req.headers.get('authorization') ?? '';
    if (!auth.startsWith('Bearer ') || auth.length < 10) return fail(401, 'A connected Freesound user access token is required to download original sound files.');
    let r: Response;
    try { r = await f(`https://freesound.org/apiv2/sounds/${id}/download/`, { headers: { Authorization: `Bearer ${auth.slice(7)}` } }); } catch { return fail(502, 'Could not reach Freesound. Try again shortly.'); }
    if (r.status === 429) return send({ error: 'Freesound download limit reached (30 a minute, 500 a day). Wait a moment and try again.', rateLimited: true }, 429);
    if (r.status === 401 || r.status === 403) return fail(401, 'Freesound did not accept your connection. Connect your account again.');
    if (!r.ok || !r.body) return fail(r.status === 404 ? 404 : 502, 'Could not download that sound from Freesound.');
    // Passed straight through, never read into memory
    return new Response(r.body, { status: 200, headers: { 'content-type': r.headers.get('content-type') || 'audio/wav', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
  }

  return fail(404, 'Not found.');
};
