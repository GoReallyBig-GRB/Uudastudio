import { userFor, type AuthEnv } from '../auth/handler';
import type { LiveStore } from './store';
import { ROOM, cleanName, type Role } from './room';
import { FREE_PLAN, quotaFor, resetText, sessionStart } from './plan';
import { stateOf, type LiveEventRow } from './rules';
import type { makeLimiter } from '../auth/rateLimit';

export type Access = { ok: true; role: Role; name: string; openedAt: number | null } | { ok: false; status: number; error: string };

/** Who may enter an event's room and as what. The owner (signed in) is the producer; anyone with the link is a guest, once the event is open. */
export function roomAccess(e: LiveEventRow | null, now: number, signedInUserId: string | null, signedInName: string, guestName: string, weekLeft = 1, weekResetsAt: number | null = null): Access {
  if (!e) return { ok: false, status: 404, error: 'This link is not valid.' };
  const state = stateOf(e, now);
  if (signedInUserId && signedInUserId === e.userId) {
    if (state === 'ended' && !(e.endedAt && now - e.endedAt < ROOM.deliveryMs)) return { ok: false, status: 410, error: 'This event has ended.' };
    if (state === 'open' && weekLeft === 0) return { ok: false, status: 403, error: `You have used your ${FREE_PLAN.sessionsPerWeek} live sessions for this week.${resetText(weekResetsAt)}` };
    return { ok: true, role: 'producer', name: cleanName(signedInName), openedAt: sessionStart(e, now) };
  }
  if (state === 'waiting') return { ok: false, status: 425, error: 'The host has not opened this event yet.' };
  if (state === 'ended' && !(e.endedAt && now - e.endedAt < ROOM.deliveryMs)) return { ok: false, status: 410, error: 'This event has ended.' };
  const name = cleanName(guestName);
  if (!guestName.trim()) return { ok: false, status: 400, error: 'Enter your name to join.' };
  return { ok: true, role: 'guest', name, openedAt: sessionStart(e, now) };
}

export interface RoomEntryEnv {
  auth: AuthEnv;
  store: LiveStore;
  rooms: DurableObjectNamespace;
  limiter?: ReturnType<typeof makeLimiter>;
}

const fail = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/** GET /api/live/room/<token>?name=...  (WebSocket upgrade) */
export async function handleRoomConnect(req: Request, token: string, env: RoomEntryEnv): Promise<Response> {
  if (req.headers.get('upgrade') !== 'websocket') return fail(426, 'Open this from the live page.');
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return fail(403, 'Not allowed.');
  const wait = env.limiter?.take(req.headers.get('cf-connecting-ip') ?? 'local') ?? 0;
  if (wait) return fail(429, `Too many attempts. Try again in ${wait} seconds.`);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) return fail(404, 'This link is not valid.');
  const e = await env.store.byToken(token);
  const me = await userFor(req, env.auth).catch(() => null);
  const now = Date.now();
  const q = e && me?.user.id === e.userId ? quotaFor(await env.store.list(e.userId), now, e.id) : null;
  const a = roomAccess(e, now, me?.user.id ?? null, me?.user.display_name ?? 'Host', new URL(req.url).searchParams.get('name') ?? '', q?.left ?? 1, q?.resetsAt ?? null);
  if (!a.ok) return fail(a.status, a.error);
  const stub = env.rooms.get(env.rooms.idFromName(e!.id));
  const headers = new Headers({ upgrade: 'websocket', 'x-room-role': a.role, 'x-room-name': a.name, 'x-room-opened-at': String(a.openedAt ?? now) });
  return stub.fetch(new Request('https://room/connect', { headers }));
}
