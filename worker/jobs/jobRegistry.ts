import { DurableObject } from 'cloudflare:workers';
import { DEFAULT_STORAGE_LIMIT, Registry, SqlRegistryStore, parseSetting } from './storage';

/**
 * One object for the whole account. Remembers how many audio bytes each job holds so uploads can be
 * refused before Cloudflare's free 5 GB cap. Advisory: if the real cap is hit, writes fail on their own.
 * Called only when an upload starts, finishes or a job changes size or is deleted, never per poll.
 */
export class JobRegistry extends DurableObject {
  private reg: Registry;
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.reg = new Registry(new SqlRegistryStore(ctx.storage.sql), parseSetting((env as { STORAGE_LIMIT_BYTES?: string }).STORAGE_LIMIT_BYTES, DEFAULT_STORAGE_LIMIT));
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
    if (path === '/status') return new Response(JSON.stringify(this.reg.status()), { headers: h });
    if (request.method !== 'POST') return new Response('{"error":"Not found."}', { status: 404, headers: h });
    const b = (await request.json().catch(() => ({}))) as { id?: string; bytes?: number; size?: number };
    if (path === '/set' && typeof b.id === 'string' && typeof b.bytes === 'number') { this.reg.set(b.id, b.bytes); return new Response('{"ok":true}', { headers: h }); }
    if (path === '/check' && typeof b.size === 'number') return new Response(JSON.stringify({ refusal: this.reg.check(b.size) }), { headers: h });
    return new Response('{"error":"Bad request."}', { status: 400, headers: h });
  }
}
