import { userFor, type AuthEnv } from '../../auth/handler';
import type { LiveStore } from '../store';
import { stateOf } from '../rules';
import { ROOM } from '../room';
import { TAKE_ID, checkTicket, makeTicket } from './ticket';

export interface DropRouteEnv {
  auth: AuthEnv;
  store: LiveStore;
  drops: DurableObjectNamespace;
  secret: string;
  now?: () => number;
  /** Seconds to wait if this caller is asking too often, else 0 */
  limit?: (ip: string) => number;
}

const H = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const fail = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: H });
const MAX_PART = 5 * 1024 * 1024 + 1024;

/**
 * /api/live/drop/<token>/...
 * Guests (event link + a ticket for that take): init, part, complete.   The host (signed in as the event's owner): list, part, collected.
 * The ticket is handed out while the guest is still in the room and works for 8 days, so a recording can go up after the event ends.
 */
export async function handleDrop(req: Request, rest: string[], env: DropRouteEnv): Promise<Response> {
  const now = (env.now ?? Date.now)();
  const [token = '', action = ''] = rest;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) return fail(404, 'This link is not valid.');
  const wait = env.limit?.(req.headers.get('cf-connecting-ip') ?? 'local') ?? 0;
  if (wait) return fail(429, `Too many requests. Try again in ${wait} seconds.`);
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return fail(403, 'Not allowed.');
  const e = await env.store.byToken(token).catch(() => null);
  if (!e) return fail(404, 'This link is not valid.');
  const stub = env.drops.get(env.drops.idFromName(e.id));
  const u = new URL(req.url);
  const take = u.searchParams.get('take') ?? '';
  const inner = (path: string, init?: RequestInit) => stub.fetch(new Request(`https://drop${path}${path.includes('?') ? '' : take ? `?take=${encodeURIComponent(take)}` : ''}`, init));
  const pass = async (r: Response) => new Response(r.body, { status: r.status, headers: { ...H, 'content-type': r.headers.get('content-type') ?? H['content-type'], ...(r.headers.get('x-sha256') ? { 'x-sha256': r.headers.get('x-sha256') as string } : {}) } });

  // Host
  if ((req.method === 'GET' && (action === 'list' || action === 'part')) || (req.method === 'POST' && action === 'collected')) {
    const me = await userFor(req, env.auth).catch(() => null);
    if (!me || me.user.id !== e.userId) return fail(401, 'Sign in as the host to collect recordings.');
    if (action === 'list') return pass(await inner('/list'));
    if (!TAKE_ID.test(take)) return fail(400, 'Which recording?');
    if (action === 'part') return pass(await inner(`/part?take=${encodeURIComponent(take)}&n=${encodeURIComponent(u.searchParams.get('n') ?? '')}`));
    return pass(await inner('/collected', { method: 'POST' }));
  }

  // Guest
  if (!TAKE_ID.test(take) && action !== 'ticket') return fail(400, 'Which recording?');
  if (action === 'ticket' && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as { takeId?: unknown };
    if (typeof body.takeId !== 'string' || !TAKE_ID.test(body.takeId)) return fail(400, 'Which recording?');
    const state = stateOf(e, now);
    if (state === 'waiting' || (state === 'ended' && !(e.endedAt && now - e.endedAt < ROOM.deliveryMs))) return fail(410, 'This event is over.');
    return new Response(JSON.stringify({ ticket: await makeTicket(env.secret, e.id, body.takeId, now) }), { headers: H });
  }
  if (!(await checkTicket(env.secret, e.id, take, req.headers.get('x-drop-ticket') ?? '', now))) return fail(401, 'This upload is not allowed.');
  if (action === 'init' && req.method === 'POST') {
    const text = await req.text();
    if (text.length > 2000) return fail(413, 'Too large.');
    return pass(await inner('/init', { method: 'POST', body: text }));
  }
  if (action === 'part' && req.method === 'PUT') {
    const n = u.searchParams.get('n') ?? '';
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_PART) return fail(413, 'That part is too large.');
    return pass(await inner(`/part?take=${encodeURIComponent(take)}&n=${encodeURIComponent(n)}`, { method: 'PUT', body: buf, headers: { 'x-sha256': req.headers.get('x-sha256') ?? '' } }));
  }
  if (action === 'complete' && req.method === 'POST') return pass(await inner('/complete', { method: 'POST' }));
  return fail(404, 'Not found.');
}
