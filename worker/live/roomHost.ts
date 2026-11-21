import { limitSchedule } from './plan';
import { clockStep, cleanName, decideJoin, freshMeta, parseClientMessage, publicBarred, roster, step, ROOM, type JoinDecision, type Out, type Peer, type Role, type RoomMeta } from './room';
import { Buckets } from './bucket';

/** A browser's private rejoin key: random, kept in that browser, never shown to anyone. Only a hash of it is stored. */
const REJOIN_KEY = /^[A-Za-z0-9_-]{16,64}$/;
const hashKey = async (k: string): Promise<string> => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`uuda-room:${k}`)))].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
/** Seats remembered for a rejoin: the person keeps their id, and a place already given in the call */
type Seats = Record<string, { id: string; admitted: boolean }>;
const MAX_SEATS = 64;

/** The parts of a Durable Object state and of a WebSocket that the room uses, so the room can be tested without Cloudflare. */
export interface HostSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(v: unknown): void;
  deserializeAttachment(): unknown;
}
export interface HostState {
  getWebSockets(): HostSocket[];
  acceptWebSocket(ws: HostSocket): void;
  storage: { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void>; setAlarm(at: number): Promise<void> };
}

/**
 * The live room's behaviour: who is in the room lives in each socket's attachment and the recording state in storage, so both survive
 * the object being put to sleep. All decisions are in room.ts; this only applies them to sockets.
 */
export class RoomHost {
  /** Messages per connection; held in memory, so a flood is caught while it is happening (a sleeping room has nothing to flood) */
  private readonly rate = new Buckets();
  constructor(private readonly ctx: HostState, private readonly makePair: () => { client: HostSocket; server: HostSocket }, private readonly uid: () => string = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12)) {}

  private peers(): Array<{ ws: HostSocket; peer: Peer }> {
    const out: Array<{ ws: HostSocket; peer: Peer }> = [];
    for (const ws of this.ctx.getWebSockets()) {
      const peer = ws.deserializeAttachment() as Peer | null;
      if (peer?.id) out.push({ ws, peer });
    }
    return out;
  }

  private async meta(): Promise<RoomMeta> { return { ...freshMeta(), ...((await this.ctx.storage.get<RoomMeta>('meta')) ?? {}) }; }
  private async seats(): Promise<Seats> { return (await this.ctx.storage.get<Seats>('seats')) ?? {}; }
  private async saveSeat(rk: string, seat: { id: string; admitted: boolean } | null): Promise<void> {
    const all = await this.seats();
    if (seat) all[rk] = seat; else delete all[rk];
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SEATS))) delete all[k];
    await this.ctx.storage.put('seats', all);
  }
  private send(ws: HostSocket, msg: unknown): void { try { ws.send(JSON.stringify(msg)); } catch { /* closing */ } }

  private deliver(out: Out[], list: Array<{ ws: HostSocket; peer: Peer }>): void {
    // Things about recording go to people in the call; presence changes go to everyone in the room
    const callOnly = new Set(['record', 'stop', 'marker', 'cue']);
    for (const o of out) {
      for (const { ws, peer } of list) {
        const hit = o.to === 'all' ? (callOnly.has(String(o.msg.t)) ? peer.admitted : true) : o.to === 'producer' ? peer.role === 'producer' : o.to === peer.id;
        if (hit) this.send(ws, o.msg);
      }
    }
  }

  /** A new connection. Returns the browser's end of the socket pair. */
  async connect(role: Role, rawName: string, now: number, openedAt: number | null = null, mode: 'conversation' | 'broadcast' = 'conversation', rejoinKey = ''): Promise<HostSocket> {
    const name = cleanName(rawName);
    const rk = role === 'guest' && REJOIN_KEY.test(rejoinKey) ? await hashKey(rejoinKey) : '';
    let meta = await this.meta();
    if (meta.openedAt === null && openedAt !== null) {
      // The first connection tells the room when the session began, so its clock can start
      // The type is set once, when the room first opens; after that only the host can step it down
      meta = { ...meta, openedAt, mode };
      await this.ctx.storage.put('meta', meta);
      const next = clockStep(meta, now).nextAt;
      if (next) await this.ctx.storage.setAlarm(next);
    }
    const list = this.peers();
    const { client, server } = this.makePair();
    this.ctx.acceptWebSocket(server);

    const seat = rk ? (await this.seats())[rk] : undefined;
    // The same person's older connection (a reconnect before the room noticed the drop) does not count against the room
    const others0 = list.filter((l) => !(seat && l.peer.id === seat.id)).map((l) => l.peer);
    const inCall = others0.filter((p) => p.admitted).length;
    // A guest the producer removed stays out until invited back, even in a new tab. One who was already in the call, or was invited back, keeps their place.
    const barred = !!rk && meta.barred.some((b) => b.rk === rk);
    const invited = !!rk && meta.invited.includes(rk);
    const keepPlace = !meta.endedAt && !barred && inCall < ROOM.admitted && ((seat?.admitted ?? false) || invited);
    const decision: JoinDecision = barred ? { ok: false, admitted: false, error: 'The host removed you from this session. Ask them to invite you back.' } : keepPlace ? { ok: true, admitted: true } : decideJoin(others0, role, meta, now);
    if (!decision.ok) {
      this.send(server, { t: 'error', message: decision.error });
      server.close(4003, 'not allowed');
      return client;
    }
    // One producer at a time: a new connection (another tab, a reconnect) takes over
    if (role === 'producer') for (const { ws, peer } of list) if (peer.role === 'producer') { try { ws.close(4001, 'replaced'); } catch { /* gone */ } }

    const id = seat?.id ?? this.uid();
    // The same browser reconnecting before the room noticed the old connection die: the new one takes over
    for (const { ws, peer } of list) if (peer.id === id && role === 'guest') { try { ws.close(4001, 'replaced'); } catch { /* gone */ } }
    const peer: Peer = { id, role, name, admitted: decision.admitted, muted: false, recording: false, joinedAt: now, ...(rk ? { rk } : {}) };
    server.serializeAttachment(peer);
    if (rk) await this.saveSeat(rk, { id, admitted: decision.admitted });
    if (invited) await this.ctx.storage.put('meta', { ...meta, invited: meta.invited.filter((k) => k !== rk) });
    const others = list.filter((l) => l.peer.id !== id && !(role === 'producer' && l.peer.role === 'producer')).map((l) => l.peer);
    this.send(server, { t: 'welcome', id, role, mode: meta.mode, ...(role === 'producer' ? { barred: publicBarred(meta.barred) } : {}), admitted: peer.admitted, now, autoAdmit: meta.autoAdmit, take: meta.take, endedAt: meta.endedAt, limit: meta.openedAt === null ? null : { phase: meta.phase, ...limitSchedule(meta.openedAt) }, peers: roster(others) });
    this.deliver([{ to: 'all', msg: { t: 'joined', peer: roster([peer])[0] } }], list);
    return client;
  }

  async message(ws: HostSocket, data: string | ArrayBuffer, now: number): Promise<void> {
    if (typeof data !== 'string') return;
    const from = ws.deserializeAttachment() as Peer | null;
    if (!from?.id) return;
    const rate = this.rate.take(from.id, now);
    if (!rate.ok) {
      // Over the limit: drop the message. A client that keeps going is cut off and has to reconnect.
      if (rate.strikes === 1) this.send(ws, { t: 'error', message: 'You are sending too fast. Slow down.' });
      if (rate.strikes >= 30) { try { ws.close(4008, 'too many messages'); } catch { /* gone */ } }
      return;
    }
    const msg = parseClientMessage(data);
    if (!msg) { this.send(ws, { t: 'error', message: 'That message was not understood.' }); return; }
    const meta = await this.meta();
    const list = this.peers();
    const r = step(meta, list.map((l) => l.peer), from, msg, now);
    if (r.meta !== meta) await this.ctx.storage.put('meta', r.meta);
    for (const l of list) {
      const patch = r.peers[l.peer.id];
      if (patch) {
        l.peer = { ...l.peer, ...patch };
        l.ws.serializeAttachment(l.peer);
        if (patch.admitted && l.peer.rk) await this.saveSeat(l.peer.rk, { id: l.peer.id, admitted: true });
      }
    }
    this.deliver(r.out, list);
    for (const k of r.kick) {
      const l = list.find((x) => x.peer.id === k.id);
      if (l) {
        if (l.peer.rk) await this.saveSeat(l.peer.rk, null);
        this.send(l.ws, { t: 'removed' });
        try { l.ws.close(4002, k.reason); } catch { /* gone */ }
      }
    }
  }

  /** The session clock rang: warn, say time is up, or end the room */
  async alarm(now: number): Promise<void> {
    const meta = await this.meta();
    const r = clockStep(meta, now);
    if (r.meta !== meta) await this.ctx.storage.put('meta', r.meta);
    this.deliver(r.out, this.peers());
    if (r.nextAt) await this.ctx.storage.setAlarm(r.nextAt);
  }

  closed(ws: HostSocket, code: number): void {
    const peer = ws.deserializeAttachment() as Peer | null;
    if (peer?.id) this.rate.forget(peer.id);
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch { /* already closed */ }
    // A producer replaced by their own new connection is not "left"
    if (peer?.id && code !== 4001) this.deliver([{ to: 'all', msg: { t: 'left', id: peer.id } }], this.peers().filter((l) => l.ws !== ws));
  }
}
