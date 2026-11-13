import { describe, expect, it } from 'vitest';
import { CHUNK, handleJob, type HandlerEnv } from './handler';
import { MemoryRepo } from './repo';
import { DEFAULT_MAX_TAKE_BYTES, DEFAULT_STORAGE_LIMIT, MemoryRegistryStore, Registry, STORAGE_FULL_MESSAGE, localGuard, parseSetting } from './storage';

let n = 0;
const room = (reg?: Registry, id = 'J', opts: { maxTakeBytes?: number; maxTakeSeconds?: number } = {}) => {
  const e: HandlerEnv & { clock: number } = { repo: new MemoryRepo(), clock: 1000, now: () => e.clock++, newKey: () => `key${(n++).toString().padStart(30, '0')}`, storage: reg ? localGuard(reg, id, opts) : undefined } as never;
  return e;
};
const call = (env: HandlerEnv, method: string, path: string, opts: { key?: string; body?: BodyInit; headers?: Record<string, string> } = {}) => {
  const url = new URL('https://x.test/api/jobs/J/' + path);
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.key) headers['x-job-key'] = opts.key;
  return handleJob(new Request(url, { method, headers, body: opts.body }), path.split('/').filter(Boolean), env);
};
const start = async (env: HandlerEnv) => (await (await call(env, 'POST', 'init', { body: JSON.stringify({ title: 'T' }) })).json()) as { producerKey: string; talentKey: string };
const wav = (bytes: number) => { const b = new Uint8Array(bytes); b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]); return b; };
const sha = async (d: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', d))].map((x) => x.toString(16).padStart(2, '0')).join('');
const begin = (env: HandlerEnv, key: string, size: number, extra: object = {}) => call(env, 'POST', 'uploads', { key, body: JSON.stringify({ kind: 'attachment', name: 'a.wav', mime: 'audio/wav', size, ...extra }) });
const upload = async (env: HandlerEnv, key: string, data: Uint8Array) => {
  const r = await begin(env, key, data.length);
  if (r.status !== 201) return r;
  const { uploadId } = (await r.json()) as { uploadId: string };
  for (let i = 0; i * CHUNK < data.length; i++) {
    const piece = data.slice(i * CHUNK, (i + 1) * CHUNK);
    await call(env, 'PUT', `uploads/${uploadId}/${i}`, { key, body: piece, headers: { 'x-chunk-sha256': await sha(piece) } });
  }
  return call(env, 'POST', `uploads/${uploadId}/complete`, { key });
};

describe('storage guard', () => {
  it('parses settings and falls back on bad values', () => {
    expect(parseSetting('1000', 5)).toBe(1000);
    expect(parseSetting('abc', 5)).toBe(5);
    expect(parseSetting('-3', 5)).toBe(5);
    expect(parseSetting(undefined, 5)).toBe(5);
    expect(DEFAULT_STORAGE_LIMIT).toBe(4 * 1024 ** 3);
  });

  it('refuses with 507 before the cap and says what to do', async () => {
    const reg = new Registry(new MemoryRegistryStore(), 3 * 1024 * 1024);
    const env = room(reg);
    const { talentKey } = await start(env);
    expect((await upload(env, talentKey, wav(2 * 1024 * 1024))).status).toBe(201);
    expect(reg.status().totalBytes).toBe(2 * 1024 * 1024);
    const r = await begin(env, talentKey, 2 * 1024 * 1024);
    expect(r.status).toBe(507);
    expect(((await r.json()) as { error: string }).error).toBe(STORAGE_FULL_MESSAGE);
    expect((await begin(env, talentKey, 1024 * 1024)).status).toBe(201); // exactly fits
  });

  it('counts every job together and drops a job when it is deleted', async () => {
    const reg = new Registry(new MemoryRegistryStore(), 3 * 1024 * 1024);
    const a = room(reg, 'A'), b = room(reg, 'B');
    const ka = await start(a), kb = await start(b);
    await upload(a, ka.talentKey, wav(2 * 1024 * 1024));
    expect((await begin(b, kb.talentKey, 2 * 1024 * 1024)).status).toBe(507);
    reg.set('A', 0); // what the room reports when it is deleted or wiped
    expect(reg.status().totalBytes).toBe(0);
    expect((await begin(b, kb.talentKey, 2 * 1024 * 1024)).status).toBe(201);
  });

  it('reports the new size when a job is purged or a file is removed, not per piece', async () => {
    const reg = new Registry(new MemoryRegistryStore(), 100 * 1024 * 1024);
    const env = room(reg);
    const reports: number[] = [];
    const g = env.storage!; env.storage = { ...g, report: (v) => { reports.push(v); return g.report(v); } };
    const { talentKey } = await start(env);
    reports.length = 0;
    await upload(env, talentKey, wav(2 * 1024 * 1024 + 5));
    expect(reports).toEqual([2 * 1024 * 1024 + 5]); // one report, after complete
  });

  it('applies the per-take size and length caps', async () => {
    const reg = new Registry(new MemoryRegistryStore(), 1024 ** 3);
    const env = room(reg, 'J', { maxTakeBytes: 2 * 1024 * 1024, maxTakeSeconds: 600 });
    const { talentKey } = await start(env);
    expect((await begin(env, talentKey, 2 * 1024 * 1024 + 1)).status).toBe(413);
    const long = await begin(env, talentKey, 1024, { seconds: 601 });
    expect(long.status).toBe(413);
    expect(((await long.json()) as { error: string }).error).toContain('10 minutes');
    expect((await begin(env, talentKey, 1024, { seconds: 600 })).status).toBe(201);
    expect(DEFAULT_MAX_TAKE_BYTES).toBe(300 * 1024 ** 2);
  });

  it('behaves as before when no registry is configured', async () => {
    const env = room();
    const { talentKey } = await start(env);
    expect((await upload(env, talentKey, wav(1024 * 1024 + 1))).status).toBe(201);
    expect((await begin(env, talentKey, 81 * 1024 * 1024)).status).toBe(413); // the old 80 MB per-file limit still applies
  });

  it('lets uploads through when the registry cannot be reached', async () => {
    const env = room();
    env.storage = { check: () => { throw new Error('down'); }, report: () => { throw new Error('down'); } };
    const { talentKey } = await start(env);
    expect((await upload(env, talentKey, wav(1024))).status).toBe(201);
  });

  it('reports mode and totals', () => {
    const reg = new Registry(new MemoryRegistryStore(), 1000);
    expect(reg.status()).toEqual({ totalBytes: 0, limitBytes: 1000, jobs: 0, mode: 'open' });
    reg.set('a', 1000);
    expect(reg.status().mode).toBe('full');
  });
});
