import { DurableObject } from 'cloudflare:workers';
import { DEFAULT_B2_LIMIT, DEFAULT_LOW_WATER, DEFAULT_STORAGE_LIMIT, Registry, SqlRegistryStore, parseSetting } from './storage';
import { s3ConfigFrom } from './blob';

/**
 * One object for the whole account. Remembers how many audio bytes each job holds so uploads can be
 * refused before Cloudflare's free 5 GB cap. Advisory: if the real cap is hit, writes fail on their own.
 * Called only when an upload starts, finishes or a job changes size or is deleted, never per poll.
 */
export class JobRegistry extends DurableObject {
  private reg: Registry;
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    const e = env as { STORAGE_LIMIT_BYTES?: string; STORAGE_LOW_WATER_BYTES?: string; B2_LIMIT_BYTES?: string };
    const overflow = s3ConfigFrom(env as never) ? { b2: new SqlRegistryStore(ctx.storage.sql, 'usage_b2'), b2Limit: parseSetting(e.B2_LIMIT_BYTES, DEFAULT_B2_LIMIT), lowWater: parseSetting(e.STORAGE_LOW_WATER_BYTES, DEFAULT_LOW_WATER) } : undefined;
    this.reg = new Registry(new SqlRegistryStore(ctx.storage.sql), parseSetting(e.STORAGE_LIMIT_BYTES, DEFAULT_STORAGE_LIMIT), overflow);
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
    if (path === '/status') return new Response(JSON.stringify(this.reg.status()), { headers: h });
    if (request.method !== 'POST') return new Response('{"error":"Not found."}', { status: 404, headers: h });
    const b = (await request.json().catch(() => ({}))) as { id?: string; bytes?: number; size?: number };
    if (path === '/set-b2' && typeof b.id === 'string' && typeof b.bytes === 'number') { this.reg.setB2(b.id, b.bytes); return new Response('{"ok":true}', { headers: h }); }
    if (path === '/place' && typeof b.size === 'number') return new Response(JSON.stringify(this.reg.place(b.size)), { headers: h });
    if (path === '/set' && typeof b.id === 'string' && typeof b.bytes === 'number') { this.reg.set(b.id, b.bytes); return new Response('{"ok":true}', { headers: h }); }
    if (path === '/check' && typeof b.size === 'number') return new Response(JSON.stringify({ refusal: this.reg.check(b.size) }), { headers: h });
    return new Response('{"error":"Bad request."}', { status: 400, headers: h });
  }
}
