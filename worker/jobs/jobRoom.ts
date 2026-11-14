import { DurableObject } from 'cloudflare:workers';
import { RETENTION_MS, handleJob } from './handler';
import { SqlRepo } from './repo';
import { DEFAULT_MAX_TAKE_BYTES, DEFAULT_MAX_TAKE_SECONDS, parseSetting, type StorageGuard } from './storage';

const newKey = (): string => {
  const b = crypto.getRandomValues(new Uint8Array(24));
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
};

/** One voice-talent job: its script, keys, message thread and audio. One of these exists per job; it deletes itself after 60 days without activity. */
type Th = 'talent' | 'client';

type RoomEnv = { JOB_REGISTRY?: DurableObjectNamespace; MAX_TAKE_BYTES?: string; MAX_TAKE_SECONDS?: string };

export class JobRoom extends DurableObject {
  private roomEnv: RoomEnv;
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.roomEnv = (env ?? {}) as RoomEnv;
    // Answered by the runtime without waking this object, so a quiet open page costs nothing
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /** Tells every open page that something changed; pages then fetch what they need. Talent hear about their thread, the client about theirs, the producer about both. */
  private broadcast(thread?: Th): void {
    const msg = JSON.stringify({ t: 'changed', th: thread ?? 'job' });
    for (const ws of this.ctx.getWebSockets()) {
      const role = (ws.deserializeAttachment() as { role?: string } | null)?.role;
      if (thread && role && role !== 'producer' && role !== thread) continue;
      try { ws.send(msg); } catch { /* closing */ }
    }
  }

  private closeSockets(role?: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (role && (ws.deserializeAttachment() as { role?: string } | null)?.role !== role) continue;
      try { ws.close(4001, 'link changed'); } catch { /* already closed */ }
    }
  }

  /** Talks to the account-wide registry; absent when the binding is not configured */
  private guard(jobId: string): StorageGuard | undefined {
    const ns = this.roomEnv.JOB_REGISTRY;
    if (!ns) return undefined;
    const stub = ns.get(ns.idFromName('main'));
    const post = (path: string, body: object) => stub.fetch(new Request(`https://registry${path}`, { method: 'POST', body: JSON.stringify(body) }));
    return {
      maxTakeBytes: parseSetting(this.roomEnv.MAX_TAKE_BYTES, DEFAULT_MAX_TAKE_BYTES),
      maxTakeSeconds: parseSetting(this.roomEnv.MAX_TAKE_SECONDS, DEFAULT_MAX_TAKE_SECONDS),
      check: async (size) => ((await (await post('/check', { size })).json()) as { refusal: string | null }).refusal,
      report: async (bytes) => { if (bytes !== this.lastReported) { this.lastReported = bytes; await post('/set', { id: jobId, bytes }); } },
    };
  }
  private lastReported = -1;
  private jobId = '';

  async fetch(request: Request): Promise<Response> {
    const repo = new SqlRepo(this.ctx.storage.sql);
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      const key = new URL(request.url).searchParams.get('k') || '';
      const found = key ? repo.getKeys().find((k) => !k.revoked && k.key === key) : undefined;
      if (!found || !repo.getJob()) return new Response('Not allowed', { status: 403 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ role: found.role });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    const parts = new URL(request.url).pathname.split('/').filter(Boolean); // api, jobs, <id>, ...rest
    const rest = parts.slice(3);
    const id = parts[2] ?? '';
    if (id && this.jobId !== id) { this.jobId = id; this.ctx.storage.kv.put('jobId', id); } // kept so the alarm knows which job to report as emptied
    const guard = this.guard(id);
    return handleJob(request, rest, {
      storage: guard,
      repo,
      now: () => Date.now(),
      newKey,
      touch: (thread) => { void this.ctx.storage.setAlarm(Date.now() + RETENTION_MS); this.broadcast(thread); },
      closeLive: (role) => this.closeSockets(role),
      wipe: async () => { await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); this.lastReported = -1; try { await guard?.report(0); } catch { /* advisory */ } },
    });
  }

  webSocketMessage(): void { /* pages only listen; pings are answered by the runtime */ }
  webSocketClose(ws: WebSocket, code: number): void { try { ws.close(code === 1005 ? 1000 : code); } catch { /* gone */ } }

  async alarm(): Promise<void> {
    this.closeSockets();
    const id = this.jobId || String(this.ctx.storage.kv.get('jobId') ?? '');
    await this.ctx.storage.deleteAll();
    this.lastReported = -1;
    try { if (id) await this.guard(id)?.report(0); } catch { /* advisory */ }
  }
}
