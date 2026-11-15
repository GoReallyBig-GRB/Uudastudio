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

export interface FreesoundEnv {
  auth: AuthEnv;
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
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
  const url = new URL(req.url);
  const route = rest.join('/');
  const get = req.method === 'GET';

  if (route === 'config' && get) {
    return send({ enabled: env.enabled ?? !!env.apiKey, hasApiKey: !!env.apiKey, clientId: env.clientId || null });
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
      if (!env.apiKey) return userToken ? fail(401, 'Freesound did not accept your connection. Connect your account again.') : fail(503, 'The sound library is not set up on the server yet.');
      const wait = env.limits?.sharedSearch.take(me.user.id) ?? 0;
      if (wait) return busy(wait);
      r = await call(`Token ${env.apiKey}`);
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
    return send({ authUrl: `https://freesound.org/apiv2/oauth2/authorize/?client_id=${encodeURIComponent(env.clientId)}&response_type=code` });
  }

  if (route === 'oauth/token' && req.method === 'POST') {
    if (!sameSite(req)) return fail(403, 'Not allowed.');
    let code = ''; try { const b = (await req.json()) as { code?: unknown }; code = typeof b.code === 'string' ? b.code.trim() : ''; } catch { /* empty */ }
    if (!code) return fail(400, 'Authorization code is required.');
    if (!env.clientId || !env.clientSecret) return fail(500, 'Freesound sign-in is not set up on the server yet.');
    const body = new URLSearchParams({ client_id: env.clientId, client_secret: env.clientSecret, grant_type: 'authorization_code', code });
    let r: Response;
    try { r = await f('https://freesound.org/apiv2/oauth2/access_token/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() }); } catch { return fail(502, 'Could not reach Freesound. Try again shortly.'); }
    if (!r.ok) {
      // Freesound's own reply is never passed on: it becomes a sentence the user can act on
      let c = ''; try { c = String(((await r.json()) as { error?: unknown }).error ?? ''); } catch { /* not JSON */ }
      const message = c === 'invalid_grant'
        ? 'Freesound did not accept that code. Codes work once and expire after a few minutes, and an API key cannot be used here. Press "Authorize on Freesound" for a fresh code and paste it right away.'
        : c === 'invalid_client' || c === 'unauthorized_client'
        ? "Freesound did not accept this app's credentials. The server administrator needs to check the Freesound client ID and secret."
        : 'Freesound could not connect your account. Please try again.';
      return send({ error: message, code: c || undefined }, r.status === 400 ? 400 : 502);
    }
    const t = (await r.json()) as { access_token?: unknown; expires_in?: unknown; scope?: unknown };
    return send({ access_token: t.access_token, expires_in: t.expires_in, scope: t.scope });
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
