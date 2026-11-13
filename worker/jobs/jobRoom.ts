import { DurableObject } from 'cloudflare:workers';
import { RETENTION_MS, handleJob } from './handler';
import { SqlRepo } from './repo';
import { registryStorage, storageLimit, takeByteLimit, takeDurationLimit } from './storage';

const newKey = (): string => {
  const b = crypto.getRandomValues(new Uint8Array(24));
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
};

/** One voice-talent job: its script, keys, message thread and audio. One of these exists per job; it deletes itself after 60 days without activity. */
type Th = 'talent' | 'client';
type JobRoomEnv = {
  JOB_REGISTRY?: DurableObjectNamespace;
  STORAGE_LIMIT_BYTES?: string;
  MAX_TAKE_BYTES?: string;
  MAX_TAKE_SECONDS?: string;
};

export class JobRoom extends DurableObject {
  private readonly jobEnv: JobRoomEnv;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.jobEnv = env as JobRoomEnv;
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

  async fetch(request: Request): Promise<Response> {
    const parts = new URL(request.url).pathname.split('/').filter(Boolean); // api, jobs, <id>, ...rest
    const jobId = parts[2] ?? '';
    if (jobId && !(await this.ctx.storage.get<string>('__jobId'))) await this.ctx.storage.put('__jobId', jobId);
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
    const rest = parts.slice(3);
    const registryStub = this.jobEnv.JOB_REGISTRY?.get(this.jobEnv.JOB_REGISTRY.idFromName('account-storage'));
    return handleJob(request, rest, {
      repo,
      jobId,
      ...(registryStub ? { storage: registryStorage(registryStub) } : {}),
      storageLimitBytes: storageLimit(this.jobEnv.STORAGE_LIMIT_BYTES),
      maxTakeBytes: takeByteLimit(this.jobEnv.MAX_TAKE_BYTES),
      maxTakeSeconds: takeDurationLimit(this.jobEnv.MAX_TAKE_SECONDS),
      now: () => Date.now(),
      newKey,
      touch: (thread) => { void this.ctx.storage.setAlarm(Date.now() + RETENTION_MS); this.broadcast(thread); },
      closeLive: (role) => this.closeSockets(role),
      wipe: async () => { await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); },
    });
  }

  webSocketMessage(): void { /* pages only listen; pings are answered by the runtime */ }
  webSocketClose(ws: WebSocket, code: number): void { try { ws.close(code === 1005 ? 1000 : code); } catch { /* gone */ } }

  async alarm(): Promise<void> {
    const jobId = await this.ctx.storage.get<string>('__jobId');
    this.closeSockets();
    await this.ctx.storage.deleteAll();
    const registryStub = this.jobEnv.JOB_REGISTRY?.get(this.jobEnv.JOB_REGISTRY.idFromName('account-storage'));
    if (jobId && registryStub) await registryStorage(registryStub).report(jobId, 0, undefined, true);
  }
}
