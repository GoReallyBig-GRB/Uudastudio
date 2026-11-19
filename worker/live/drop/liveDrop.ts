import { DurableObject } from 'cloudflare:workers';
import { B2Blob, DoBlob } from './blob';
import { DropService, type InitInput } from './service';
import { SqlDropRepo } from './sqlRepo';
import type { Backing, Route } from './plan';
import type { S3Config } from './s3';

export interface DropEnv {
  JOB_REGISTRY?: DurableObjectNamespace;
  B2_ENDPOINT?: string; B2_BUCKET?: string; B2_REGION?: string; B2_KEY_ID?: string; B2_APP_KEY?: string;
}

/** The B2 settings, or null until all five are set (the key itself only as a Worker secret) */
export const b2Config = (e: DropEnv): S3Config | null =>
  e.B2_ENDPOINT && e.B2_BUCKET && e.B2_REGION && e.B2_KEY_ID && e.B2_APP_KEY ? { endpoint: e.B2_ENDPOINT, bucket: e.B2_BUCKET, region: e.B2_REGION, keyId: e.B2_KEY_ID, appKey: e.B2_APP_KEY } : null;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/**
 * One per event. Holds the recordings guests could not send straight to the host. Only the Worker calls it, after checking who is asking.
 * Wakes only when a request arrives or when something is due to be deleted.
 */
export class LiveDrop extends DurableObject {
  private svc: DropService;
  private b2: boolean;
  constructor(ctx: DurableObjectState, private readonly e: DropEnv) {
    super(ctx, e as never);
    const cfg = b2Config(e);
    this.b2 = !!cfg;
    const registry = () => e.JOB_REGISTRY?.get(e.JOB_REGISTRY.idFromName('main'));
    const ask = async (path: string, body: unknown) => registry()?.fetch(new Request(`https://registry${path}`, { method: 'POST', body: JSON.stringify(body) }));
    this.svc = new DropService({
      repo: new SqlDropRepo(ctx.storage.sql),
      blobs: { do: new DoBlob(ctx.storage.sql), b2: cfg ? new B2Blob(cfg) : null },
      // With no registry (not expected) the object holds nothing new rather than risk the account cap
      route: async (size): Promise<Route> => {
        const r = await ask('/route', { size, b2: !!cfg });
        return r && r.ok ? ((await r.json()) as Route) : { backing: null, mode: 'do', refusal: 'The service cannot take recordings right now. Your recording is safe on this device.' };
      },
      report: async (backing: Backing, key: string, bytes: number) => { await ask(backing === 'b2' ? '/b2set' : '/set', { id: `drop:${key}`, bytes }); },
      eventId: ctx.id.toString(),
      now: Date.now,
    });
  }

  private async rearm(): Promise<void> {
    const next = await this.svc.sweep();
    if (next === null) await this.ctx.storage.deleteAlarm(); else await this.ctx.storage.setAlarm(next);
  }
  async alarm(): Promise<void> { await this.rearm(); }

  async fetch(request: Request): Promise<Response> {
    const u = new URL(request.url);
    const take = u.searchParams.get('take') ?? '';
    const n = Number(u.searchParams.get('n'));
    const reply = (r: { ok: true; value: unknown } | { ok: false; status: number; error: string }) => (r.ok ? json(r.value) : json({ error: r.error }, r.status));
    switch (`${request.method} ${u.pathname}`) {
      case 'POST /init': {
        const r = await this.svc.init({ ...((await request.json().catch(() => ({}))) as InitInput), takeId: take });
        if (r.ok) await this.ctx.storage.setAlarm(Date.now() + 7 * 24 * 3600_000 + 60_000);
        return reply(r);
      }
      case 'PUT /part': return reply(await this.svc.putPart(take, n, new Uint8Array(await request.arrayBuffer()), request.headers.get('x-sha256') ?? ''));
      case 'POST /complete': { const r = await this.svc.complete(take); if (r.ok) await this.rearm(); return reply(r); }
      case 'GET /list': return json({ takes: this.svc.list(), b2: this.b2 });
      case 'GET /part': {
        const r = await this.svc.getPart(take, n);
        return r.ok ? new Response(r.value.data, { headers: { 'content-type': 'application/octet-stream', 'x-sha256': r.value.sha, 'cache-control': 'no-store' } }) : json({ error: r.error }, r.status);
      }
      case 'POST /collected': { const r = this.svc.collected(take); if (r.ok) await this.rearm(); return reply(r); }
      default: return json({ error: 'Not found.' }, 404);
    }
  }
}
