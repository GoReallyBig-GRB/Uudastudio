import { cleanName, decideJoin, freshMeta, parseClientMessage, roster, step, type Out, type Peer, type Role, type RoomMeta } from './room';

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
  storage: { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void> };
}

/**
 * The live room's behaviour: who is in the room lives in each socket's attachment and the recording state in storage, so both survive
 * the object being put to sleep. All decisions are in room.ts; this only applies them to sockets.
 */
export class RoomHost {
  constructor(private readonly ctx: HostState, private readonly makePair: () => { client: HostSocket; server: HostSocket }, private readonly uid: () => string = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12)) {}

  private peers(): Array<{ ws: HostSocket; peer: Peer }> {
    const out: Array<{ ws: HostSocket; peer: Peer }> = [];
    for (const ws of this.ctx.getWebSockets()) {
      const peer = ws.deserializeAttachment() as Peer | null;
      if (peer?.id) out.push({ ws, peer });
    }
    return out;
  }

  private async meta(): Promise<RoomMeta> { return (await this.ctx.storage.get<RoomMeta>('meta')) ?? freshMeta(); }
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
  async connect(role: Role, rawName: string, now: number): Promise<HostSocket> {
    const name = cleanName(rawName);
    const meta = await this.meta();
    const list = this.peers();
    const { client, server } = this.makePair();
    this.ctx.acceptWebSocket(server);

    const decision = decideJoin(list.map((l) => l.peer), role, meta, now);
    if (!decision.ok) {
      this.send(server, { t: 'error', message: decision.error });
      server.close(4003, 'not allowed');
      return client;
    }
    // One producer at a time: a new connection (another tab, a reconnect) takes over
    if (role === 'producer') for (const { ws, peer } of list) if (peer.role === 'producer') { try { ws.close(4001, 'replaced'); } catch { /* gone */ } }

    const id = this.uid();
    const peer: Peer = { id, role, name, admitted: decision.admitted, muted: false, recording: false, joinedAt: now };
    server.serializeAttachment(peer);
    const others = list.filter((l) => !(role === 'producer' && l.peer.role === 'producer')).map((l) => l.peer);
    this.send(server, { t: 'welcome', id, role, admitted: peer.admitted, now, autoAdmit: meta.autoAdmit, take: meta.take, endedAt: meta.endedAt, peers: roster(others) });
    this.deliver([{ to: 'all', msg: { t: 'joined', peer: roster([peer])[0] } }], list);
    return client;
  }

  async message(ws: HostSocket, data: string | ArrayBuffer, now: number): Promise<void> {
    if (typeof data !== 'string') return;
    const from = ws.deserializeAttachment() as Peer | null;
    if (!from?.id) return;
    const msg = parseClientMessage(data);
    if (!msg) { this.send(ws, { t: 'error', message: 'That message was not understood.' }); return; }
    const meta = await this.meta();
    const list = this.peers();
    const r = step(meta, list.map((l) => l.peer), from, msg, now);
    if (r.meta !== meta) await this.ctx.storage.put('meta', r.meta);
    for (const l of list) {
      const patch = r.peers[l.peer.id];
      if (patch) { l.peer = { ...l.peer, ...patch }; l.ws.serializeAttachment(l.peer); }
    }
    this.deliver(r.out, list);
    for (const k of r.kick) {
      const l = list.find((x) => x.peer.id === k.id);
      if (l) { this.send(l.ws, { t: 'removed' }); try { l.ws.close(4002, k.reason); } catch { /* gone */ } }
    }
  }

  closed(ws: HostSocket, code: number): void {
    const peer = ws.deserializeAttachment() as Peer | null;
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch { /* already closed */ }
    // A producer replaced by their own new connection is not "left"
    if (peer?.id && code !== 4001) this.deliver([{ to: 'all', msg: { t: 'left', id: peer.id } }], this.peers().filter((l) => l.ws !== ws));
  }
}
