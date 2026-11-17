/**
 * The live room's rules, with no sockets and no storage, so they can be tested alone. The Durable Object (liveRoom.ts) keeps the
 * sockets and calls `step` for every message; `step` says what changes and who hears what.
 *
 * Roles: one producer (the event's owner, signed in) and guests (anyone with the link). Guests wait until the producer lets them in
 * (or until the producer turns on auto-admit). Only admitted people can send each other call signalling. At most ROOM.admitted
 * people are in the call at once, the producer included.
 */
export const ROOM = {
  /** People in the call at once, producer included */
  admitted: 6,
  /** Guests waiting to be let in */
  waiting: 8,
  /** One call-signalling message (offer, answer or ICE), in bytes of JSON */
  signalBytes: 16_384,
  text: 500,
  name: 40,
  /** The shortest wait between "record" and the first sample, so every device can get ready */
  minLeadMs: 2000,
  maxLeadMs: 15_000,
  /** After the session ends, guests can still reconnect this long to hand over their recordings */
  deliveryMs: 12 * 3600_000,
} as const;

export type Role = 'producer' | 'guest';
export interface Peer { id: string; role: Role; name: string; admitted: boolean; muted: boolean; recording: boolean; joinedAt: number }
export interface Take { id: string; startAt: number; stopAt: number | null }
export interface RoomMeta { autoAdmit: boolean; take: Take | null; takes: number; markers: number; endedAt: number | null }
export const freshMeta = (): RoomMeta => ({ autoAdmit: false, take: null, takes: 0, markers: 0, endedAt: null });

export type ClientMsg =
  | { t: 'sync'; c: number }
  | { t: 'state'; muted?: boolean; recording?: boolean }
  | { t: 'signal'; to: string; data: unknown }
  | { t: 'cue'; to: string; text: string }
  | { t: 'admit'; id: string }
  | { t: 'remove'; id: string }
  | { t: 'auto'; on: boolean }
  | { t: 'record'; leadMs?: number }
  | { t: 'stop' }
  | { t: 'marker' }
  | { t: 'end' };

export type To = 'all' | 'producer' | string;
export interface Out { to: To; msg: Record<string, unknown> }
export interface StepResult {
  meta: RoomMeta;
  /** New values for the sender and for other peers, by id */
  peers: Record<string, Partial<Peer>>;
  out: Out[];
  /** Peers to disconnect (id, close reason) */
  kick: Array<{ id: string; reason: string }>;
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');
export const cleanName = (v: unknown): string => str(v, ROOM.name) || 'Guest';

export function parseClientMessage(raw: string): ClientMsg | null {
  if (raw.length > ROOM.signalBytes + 256) return null;
  let m: Record<string, unknown>;
  try { m = JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
  if (!m || typeof m !== 'object') return null;
  switch (m.t) {
    case 'sync': return typeof m.c === 'number' && Number.isFinite(m.c) ? { t: 'sync', c: m.c } : null;
    case 'state': return { t: 'state', muted: typeof m.muted === 'boolean' ? m.muted : undefined, recording: typeof m.recording === 'boolean' ? m.recording : undefined };
    case 'signal': return typeof m.to === 'string' && m.to && m.data !== undefined && JSON.stringify(m.data).length <= ROOM.signalBytes ? { t: 'signal', to: m.to, data: m.data } : null;
    case 'cue': { const text = str(m.text, ROOM.text); return typeof m.to === 'string' && m.to && text ? { t: 'cue', to: m.to, text } : null; }
    case 'admit': case 'remove': return typeof m.id === 'string' && m.id ? { t: m.t, id: m.id } : null;
    case 'auto': return typeof m.on === 'boolean' ? { t: 'auto', on: m.on } : null;
    case 'record': return { t: 'record', leadMs: typeof m.leadMs === 'number' && Number.isFinite(m.leadMs) ? m.leadMs : undefined };
    case 'stop': case 'marker': case 'end': return { t: m.t };
    default: return null;
  }
}

export interface JoinDecision { ok: boolean; admitted: boolean; error?: string }

/** Whether someone can come in, and whether straight into the call or into the waiting room */
export function decideJoin(peers: Peer[], role: Role, meta: RoomMeta, now = Date.now()): JoinDecision {
  // After the end only the hand-over of recordings is left, so anyone with the link can still connect for a while
  if (meta.endedAt) return now - meta.endedAt < ROOM.deliveryMs ? { ok: true, admitted: true } : { ok: false, admitted: false, error: 'This session has ended.' };
  const inCall = peers.filter((p) => p.admitted).length;
  const waiting = peers.filter((p) => !p.admitted).length;
  if (role === 'producer') return { ok: true, admitted: true };
  if (meta.autoAdmit && inCall < ROOM.admitted) return { ok: true, admitted: true };
  if (waiting >= ROOM.waiting) return { ok: false, admitted: false, error: 'The waiting room is full. Try again in a moment.' };
  return { ok: true, admitted: false };
}

const publicPeer = (p: Peer) => ({ id: p.id, role: p.role, name: p.name, admitted: p.admitted, muted: p.muted, recording: p.recording });
export const roster = (peers: Peer[]) => peers.map(publicPeer);

const none = (meta: RoomMeta): StepResult => ({ meta, peers: {}, out: [], kick: [] });
const err = (meta: RoomMeta, to: string, message: string): StepResult => ({ meta, peers: {}, out: [{ to, msg: { t: 'error', message } }], kick: [] });

/** One message from one peer. Pure: returns what to change and who to tell. */
export function step(meta: RoomMeta, peers: Peer[], from: Peer, msg: ClientMsg, now: number, rnd: () => string = () => Math.random().toString(36).slice(2, 10)): StepResult {
  const by = new Map(peers.map((p) => [p.id, p]));
  const producer = from.role === 'producer';
  const only = (what: string) => err(meta, from.id, `Only the producer can ${what}.`);
  // Once the session has ended only the hand-over of recordings is left: clock, status and call signalling still work
  if (meta.endedAt && msg.t !== 'sync' && msg.t !== 'state' && msg.t !== 'signal') return err(meta, from.id, 'This session has ended.');

  switch (msg.t) {
    case 'sync':
      return { ...none(meta), out: [{ to: from.id, msg: { t: 'sync', c: msg.c, s: now } }] };

    case 'state': {
      const patch: Partial<Peer> = {};
      if (msg.muted !== undefined) patch.muted = msg.muted;
      if (msg.recording !== undefined) patch.recording = msg.recording;
      return { ...none(meta), peers: { [from.id]: patch }, out: [{ to: 'all', msg: { t: 'peer', id: from.id, ...patch } }] };
    }

    case 'signal': {
      const to = by.get(msg.to);
      if (!to || (!meta.endedAt && (!from.admitted || !to.admitted))) return err(meta, from.id, 'That person is not in the call.');
      return { ...none(meta), out: [{ to: to.id, msg: { t: 'signal', from: from.id, data: msg.data } }] };
    }

    case 'cue': {
      if (!producer) return only('send cues');
      const targets = msg.to === 'all' ? 'all' : by.get(msg.to)?.id;
      if (!targets) return err(meta, from.id, 'That person is not in the room.');
      return { ...none(meta), out: [{ to: targets, msg: { t: 'cue', text: msg.text, at: now } }] };
    }

    case 'admit': {
      if (!producer) return only('let people in');
      const p = by.get(msg.id);
      if (!p || p.role !== 'guest') return err(meta, from.id, 'That person is not waiting.');
      if (p.admitted) return none(meta);
      if (peers.filter((x) => x.admitted).length >= ROOM.admitted) return err(meta, from.id, `The call is full (${ROOM.admitted} people).`);
      return { ...none(meta), peers: { [p.id]: { admitted: true } }, out: [{ to: 'all', msg: { t: 'peer', id: p.id, admitted: true } }] };
    }

    case 'remove': {
      if (!producer) return only('remove people');
      const p = by.get(msg.id);
      if (!p || p.role !== 'guest') return err(meta, from.id, 'That person is not in the room.');
      return { ...none(meta), kick: [{ id: p.id, reason: 'removed' }] };
    }

    case 'auto': {
      if (!producer) return only('change this');
      const next = { ...meta, autoAdmit: msg.on };
      const admit: Record<string, Partial<Peer>> = {};
      let seats = ROOM.admitted - peers.filter((p) => p.admitted).length;
      if (msg.on) for (const p of peers) if (!p.admitted && seats > 0) { admit[p.id] = { admitted: true }; seats--; }
      return { meta: next, peers: admit, out: [{ to: 'all', msg: { t: 'auto', on: msg.on } }, ...Object.keys(admit).map((id) => ({ to: 'all' as To, msg: { t: 'peer', id, admitted: true } }))], kick: [] };
    }

    case 'record': {
      if (!producer) return only('start recording');
      if (meta.take && meta.take.stopAt === null) return err(meta, from.id, 'A take is already running.');
      const lead = Math.min(ROOM.maxLeadMs, Math.max(ROOM.minLeadMs, msg.leadMs ?? 3000));
      const take: Take = { id: `take-${meta.takes + 1}-${rnd()}`, startAt: now + lead, stopAt: null };
      return { meta: { ...meta, take, takes: meta.takes + 1, markers: 0 }, peers: {}, out: [{ to: 'all', msg: { t: 'record', take: take.id, startAt: take.startAt, n: meta.takes + 1 } }], kick: [] };
    }

    case 'stop': {
      if (!producer) return only('stop recording');
      if (!meta.take || meta.take.stopAt !== null) return err(meta, from.id, 'Nothing is recording.');
      const take = { ...meta.take, stopAt: Math.max(now, meta.take.startAt) };
      return { meta: { ...meta, take }, peers: {}, out: [{ to: 'all', msg: { t: 'stop', take: take.id, stopAt: take.stopAt } }], kick: [] };
    }

    case 'marker': {
      if (!producer) return only('drop markers');
      if (!meta.take || meta.take.stopAt !== null || now < meta.take.startAt) return err(meta, from.id, 'Markers can be added while recording.');
      const n = meta.markers + 1;
      return { meta: { ...meta, markers: n }, peers: {}, out: [{ to: 'all', msg: { t: 'marker', take: meta.take.id, at: now, n } }], kick: [] };
    }

    case 'end': {
      if (!producer) return only('end the session');
      const take = meta.take && meta.take.stopAt === null ? { ...meta.take, stopAt: Math.max(now, meta.take.startAt) } : meta.take;
      return { meta: { ...meta, take, endedAt: now }, peers: {}, out: [{ to: 'all', msg: { t: 'ended', at: now, stopAt: take?.stopAt ?? null, take: take?.id ?? null } }], kick: [] };
    }
  }
}
