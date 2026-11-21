/**
 * The live room's rules, with no sockets and no storage, so they can be tested alone. The Durable Object (liveRoom.ts) keeps the
 * sockets and calls `step` for every message; `step` says what changes and who hears what.
 *
 * Roles: one producer (the event's owner, signed in) and guests (anyone with the link). Guests wait until the producer lets them in
 * (or until the producer turns on auto-admit). Only admitted people can send each other call signalling. At most ROOM.admitted
 * people are in the call at once, the producer included.
 */
import { FREE_PLAN, limitSchedule } from './plan';

export const ROOM = {
  /** People in the call at once, producer included */
  admitted: FREE_PLAN.maxPeople,
  /** Guests waiting to be let in */
  waiting: 8,
  /** Open connections to one room, anyone but the producer. Stops a flood of tabs, before and after the session ends. */
  sockets: 24,
  /** People the producer has removed whose names are kept so they can be invited back */
  barred: 50,
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
/** `rk` is a private hash of the browser's rejoin key. It is never sent to anyone. */
export interface Peer { id: string; role: Role; name: string; admitted: boolean; muted: boolean; recording: boolean; joinedAt: number; rk?: string }
/** Someone the producer removed. They cannot come back until invited again. */
export interface Barred { id: string; name: string; rk: string }
export interface Take { id: string; startAt: number; stopAt: number | null }
/** `limitAt` is when the session's time is up (null until the room knows when it opened); `phase` is how far the clock has got */
export interface RoomMeta { barred: Barred[]; invited: string[]; autoAdmit: boolean; take: Take | null; takes: number; markers: number; endedAt: number | null; openedAt: number | null; phase: 'none' | 'soon' | 'over'; mode: 'conversation' | 'broadcast' }
export const freshMeta = (): RoomMeta => ({ barred: [], invited: [], autoAdmit: false, take: null, takes: 0, markers: 0, endedAt: null, openedAt: null, phase: 'none', mode: 'conversation' });

/** What the session clock should do at `now`: nothing, warn, say time is up, or end the room */
export function clockStep(meta: RoomMeta, now: number): { meta: RoomMeta; out: Out[]; nextAt: number | null } {
  if (meta.endedAt || meta.openedAt === null) return { meta, out: [], nextAt: null };
  const s = limitSchedule(meta.openedAt);
  if (now >= s.hardAt) {
    const take = meta.take && meta.take.stopAt === null ? { ...meta.take, stopAt: Math.max(now, meta.take.startAt) } : meta.take;
    return { meta: { ...meta, take, endedAt: now }, out: [{ to: 'all', msg: { t: 'ended', at: now, stopAt: take?.stopAt ?? null, take: take?.id ?? null, reason: 'time' } }], nextAt: null };
  }
  if (now >= s.limitAt) return meta.phase === 'over' ? { meta, out: [], nextAt: s.hardAt } : { meta: { ...meta, phase: 'over' }, out: [{ to: 'all', msg: { t: 'limit', phase: 'over', limitAt: s.limitAt, hardAt: s.hardAt } }], nextAt: s.hardAt };
  if (now >= s.warnAt) return meta.phase === 'soon' ? { meta, out: [], nextAt: s.limitAt } : { meta: { ...meta, phase: 'soon' }, out: [{ to: 'all', msg: { t: 'limit', phase: 'soon', limitAt: s.limitAt, hardAt: s.hardAt } }], nextAt: s.limitAt };
  return { meta, out: [], nextAt: s.warnAt };
}

export type ClientMsg =
  | { t: 'sync'; c: number }
  | { t: 'state'; muted?: boolean; recording?: boolean }
  | { t: 'signal'; to: string; data: unknown }
  | { t: 'cue'; to: string; text: string }
  | { t: 'admit'; id: string }
  | { t: 'remove'; id: string }
  | { t: 'reinvite'; id: string }
  | { t: 'auto'; on: boolean }
  | { t: 'mode'; mode: 'conversation' }
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
    case 'admit': case 'remove': case 'reinvite': return typeof m.id === 'string' && m.id ? { t: m.t, id: m.id } : null;
    case 'auto': return typeof m.on === 'boolean' ? { t: 'auto', on: m.on } : null;
    // Only a step down is allowed in a live room: a broadcast that cannot keep up becomes a conversation
    case 'mode': return m.mode === 'conversation' ? { t: 'mode', mode: 'conversation' } : null;
    case 'record': return { t: 'record', leadMs: typeof m.leadMs === 'number' && Number.isFinite(m.leadMs) ? m.leadMs : undefined };
    case 'stop': case 'marker': case 'end': return { t: m.t };
    default: return null;
  }
}

export interface JoinDecision { ok: boolean; admitted: boolean; error?: string }

/** Whether someone can come in, and whether straight into the call or into the waiting room */
export function decideJoin(peers: Peer[], role: Role, meta: RoomMeta, now = Date.now()): JoinDecision {
  if (role !== 'producer' && peers.length >= ROOM.sockets) return { ok: false, admitted: false, error: 'This room is full. Try again in a moment.' };
  // After the end only the hand-over of recordings is left, so anyone with the link can still connect for a while
  if (meta.endedAt) return now - meta.endedAt < ROOM.deliveryMs ? { ok: true, admitted: true } : { ok: false, admitted: false, error: 'This session has ended.' };
  const inCall = peers.filter((p) => p.admitted).length;
  const waiting = peers.filter((p) => !p.admitted).length;
  if (role === 'producer') return { ok: true, admitted: true };
  if (meta.autoAdmit && inCall < ROOM.admitted) return { ok: true, admitted: true };
  if (waiting >= ROOM.waiting) return { ok: false, admitted: false, error: 'The waiting room is full. Try again in a moment.' };
  return { ok: true, admitted: false };
}

export const publicBarred = (list: Barred[]) => list.map((b) => ({ id: b.id, name: b.name }));
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
      // In a broadcast guests are connected to the host only, never to each other
      if (meta.mode === 'broadcast' && !producer && to.role !== 'producer') return err(meta, from.id, 'In a broadcast you are connected to the host only.');
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
      // Kept so the same browser cannot walk back in. Auto-admit goes off too, so anyone else who turns up has to be let in by hand.
      const barred = [...meta.barred.filter((b) => b.id !== p.id), { id: p.id, name: p.name, rk: p.rk ?? '' }].slice(-ROOM.barred);
      const out: Out[] = [{ to: 'producer', msg: { t: 'barred', list: publicBarred(barred) } }];
      if (meta.autoAdmit) out.push({ to: 'all', msg: { t: 'auto', on: false } });
      return { meta: { ...meta, barred, autoAdmit: false, invited: meta.invited.filter((k) => k !== p.rk) }, peers: {}, out, kick: [{ id: p.id, reason: 'removed' }] };
    }

    case 'reinvite': {
      if (!producer) return only('invite people back');
      const b = meta.barred.find((x) => x.id === msg.id);
      if (!b) return err(meta, from.id, 'That person was not removed.');
      const barred = meta.barred.filter((x) => x.id !== b.id);
      const invited = b.rk ? [...meta.invited.filter((k) => k !== b.rk), b.rk].slice(-ROOM.barred) : meta.invited;
      return { meta: { ...meta, barred, invited }, peers: {}, out: [{ to: 'producer', msg: { t: 'barred', list: publicBarred(barred) } }], kick: [] };
    }

    case 'mode': {
      if (!producer) return only('change the session type');
      if (meta.mode === 'conversation') return none(meta);
      return { meta: { ...meta, mode: 'conversation' }, peers: {}, out: [{ to: 'all', msg: { t: 'mode', mode: 'conversation' } }], kick: [] };
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
      if (meta.openedAt !== null && now >= limitSchedule(meta.openedAt).limitAt) return err(meta, from.id, `The ${FREE_PLAN.sessionMinutes / 60}-hour session limit has been reached. Finish up; the room closes shortly.`);
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
