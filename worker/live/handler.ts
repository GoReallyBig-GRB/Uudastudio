/**
 * /api/live on the Worker.
 * Producer (signed in): list, create, change, delete, open/end an event, add or remove files.
 * Guest (link only): read one event by its secret token, and download its files.
 */
import { userFor, type AuthEnv } from '../auth/handler';
import type { Limiter } from '../auth/rateLimit';
import { FREE_PLAN, quotaFor, resetText, upcomingCount } from './plan';
import { LIMITS, cleanFileName, fileKindOf, liveElsewhere, randomId, stateOf, timeClash, validateEvent, type LiveEventRow } from './rules';
import type { LiveStore } from './store';

export interface LiveEnv {
  auth: AuthEnv; store: LiveStore; now?: () => number;
  limits?: { producer: Limiter; guest: Limiter };
}

const H = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
const send = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...H, ...extra } });
const fail = (status: number, error: string, extra: Record<string, string> = {}) => send({ error }, status, extra);
const sameSite = (req: Request) => { const o = req.headers.get('origin'); return !o || o === new URL(req.url).origin; };

const view = async (e: LiveEventRow, store: LiveStore, now: number) => ({
  id: e.id, token: e.token, kind: e.kind, mode: e.mode, title: e.title, description: e.description, notes: e.notes, startsAt: e.startsAt, durationMin: e.durationMin,
  activatedAt: e.activatedAt, endedAt: e.endedAt, participants: e.participants, state: stateOf(e, now), files: await store.files(e.id), createdAt: e.createdAt,
});

export const handleLive = async (req: Request, rest: string[], env: LiveEnv): Promise<Response> => {
  const now = (env.now ?? Date.now)();
  const m = req.method;

  // Guests: GET /api/live/join/<token> and /api/live/join/<token>/files/<id>
  if (rest[0] === 'join') {
    const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
    const wait = env.limits?.guest.take(`g:${ip}`) ?? 0;
    if (wait) return fail(429, `Too many requests. Try again in ${wait} seconds.`, { 'retry-after': String(wait) });
    if (m !== 'GET' || !rest[1] || rest[1].length < 16) return fail(404, 'This link is not valid.');
    try {
      const e = await env.store.byToken(rest[1]);
      if (!e) return fail(404, 'This link is not valid.');
      if (rest[2] === 'files' && rest[3]) {
        const f = await env.store.file(e.id, rest[3]);
        if (!f) return fail(404, 'File not found.');
        return new Response(f.data, { headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${f.name.replace(/"/g, '')}"`, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=300' } });
      }
      return send({ title: e.title, description: e.description, notes: e.notes, startsAt: e.startsAt, durationMin: e.durationMin, host: e.hostName, state: stateOf(e, now), now, files: await env.store.files(e.id) });
    } catch { return fail(500, 'Could not load this event.'); }
  }

  const me = await userFor(req, env.auth);
  if (!me) return fail(401, 'Sign in to schedule live events.');
  const uid = me.user.id;
  const wait = env.limits?.producer.take(uid) ?? 0;
  if (wait) return fail(429, `Too many requests. Try again in ${wait} seconds.`, { 'retry-after': String(wait) });
  if (m !== 'GET' && !sameSite(req)) return fail(403, 'Not allowed.');

  try {
    if (rest[0] !== 'events') return fail(404, 'Not found.');
    if (rest.length === 1 && m === 'GET') {
      const rows = await env.store.list(uid);
      return send({ now, quota: quotaFor(rows, now), events: await Promise.all(rows.map((e) => view(e, env.store, now))) });
    }
    if (rest.length === 1 && m === 'POST') {
      let body: unknown; try { body = await req.json(); } catch { return fail(400, 'An event is required.'); }
      const v = validateEvent(body, now);
      if (!v.ok) return fail(400, v.error);
      if ((await env.store.count(uid)) >= LIMITS.events) return fail(409, `You can keep up to ${LIMITS.events} events. Delete old ones first.`);
      const others = await env.store.list(uid);
      if (upcomingCount(others, now) >= FREE_PLAN.upcomingEvents) return fail(409, `You can hold ${FREE_PLAN.upcomingEvents} upcoming events. End or delete some first.`);
      if (v.value.kind === 'quick') { const q = quotaFor(others, now); if (q.left === 0) return fail(409, `You have used your ${q.limit} live sessions for this week.${resetText(q.resetsAt)}`); }
      if (v.value.kind === 'quick') { const live = liveElsewhere(others, null, now); if (live) return fail(409, `"${live.title}" is live right now. End it before starting another.`); }
      else if (v.value.startsAt !== null) { const c = timeClash(others, null, v.value.startsAt, v.value.durationMin, now); if (c) return fail(409, `That time overlaps "${c.title}". Two live events cannot run at the same time.`); }
      const row: LiveEventRow = { id: randomId(9), userId: uid, token: randomId(18), ...v.value, activatedAt: v.value.kind === 'quick' ? now : null, endedAt: null, hostName: me.user.display_name.slice(0, 80), createdAt: now, updatedAt: now };
      await env.store.save(row);
      return send(await view(row, env.store, now), 201);
    }
    const id = rest[1];
    if (!id) return fail(404, 'Not found.');
    const e = await env.store.get(uid, id);
    if (!e) return fail(404, 'Event not found.');

    if (rest.length === 2 && m === 'GET') return send(await view(e, env.store, now));
    if (rest.length === 2 && m === 'PUT') {
      let body: unknown; try { body = await req.json(); } catch { return fail(400, 'An event is required.'); }
      const v = validateEvent({ ...(body as object), kind: e.kind }, now);
      if (!v.ok) return fail(400, v.error);
      if (e.kind === 'scheduled' && v.value.startsAt !== null && stateOf(e, now) !== 'ended') { const c = timeClash(await env.store.list(uid), e.id, v.value.startsAt, v.value.durationMin, now); if (c) return fail(409, `That time overlaps "${c.title}". Two live events cannot run at the same time.`); }
      const next = { ...e, mode: stateOf(e, now) === 'open' ? e.mode : v.value.mode, title: v.value.title, description: v.value.description, notes: v.value.notes, startsAt: e.kind === 'quick' ? null : v.value.startsAt, durationMin: v.value.durationMin, participants: v.value.participants, updatedAt: now };
      await env.store.save(next);
      return send(await view(next, env.store, now));
    }
    if (rest.length === 2 && m === 'DELETE') { await env.store.remove(uid, id); return send({ ok: true }); }
    if (rest.length === 3 && rest[2] === 'activate' && m === 'POST') {
      let body: { open?: boolean } = {}; try { body = await req.json(); } catch { /* default: open */ }
      if (body.open !== false) {
        const all = await env.store.list(uid);
        const live = liveElsewhere(all, e.id, now); if (live) return fail(409, `"${live.title}" is live right now. End it before opening this one.`);
        if (e.endedAt) return fail(409, 'This event has ended. Create a new one to go live again.');
        if (stateOf(e, now) !== 'open') { const q = quotaFor(all, now, e.id); if (q.left === 0) return fail(409, `You have used your ${q.limit} live sessions for this week.${resetText(q.resetsAt)}`); }
      }
      const next = body.open === false ? { ...e, endedAt: now, updatedAt: now } : { ...e, activatedAt: now, endedAt: null, updatedAt: now };
      await env.store.save(next);
      return send(await view(next, env.store, now));
    }
    if (rest.length === 3 && rest[2] === 'files' && m === 'POST') {
      const name = cleanFileName(new URL(req.url).searchParams.get('name') ?? '');
      const kind = fileKindOf(name);
      if (!name || !kind) return fail(400, 'Attach a document (PDF, Word, text, slides, sheet) or an audio file (MP3, WAV, M4A, OGG).');
      const declared = Number(req.headers.get('content-length') ?? 0);
      if (declared > LIMITS.fileBytes) return fail(413, `A file can be up to ${Math.round(LIMITS.fileBytes / 1000)} KB.`);
      if ((await env.store.files(id)).length >= LIMITS.files) return fail(409, `An event can carry ${LIMITS.files} files.`);
      const data = new Uint8Array(await req.arrayBuffer());
      if (data.length === 0) return fail(400, 'That file is empty.');
      if (data.length > LIMITS.fileBytes) return fail(413, `A file can be up to ${Math.round(LIMITS.fileBytes / 1000)} KB.`);
      const meta = { id: randomId(6), name, mime: 'application/octet-stream', size: data.length, kind };
      await env.store.addFile(id, { ...meta, data });
      return send(meta, 201);
    }
    if (rest.length === 4 && rest[2] === 'files' && m === 'DELETE') { await env.store.removeFile(id, rest[3]); return send({ ok: true }); }
  } catch { return fail(500, 'Could not complete that. Try again.'); }
  return fail(404, 'Not found.');
};
