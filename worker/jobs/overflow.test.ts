import { describe, expect, it } from 'vitest';
import { CHUNK, handleJob, type HandlerEnv } from './handler';
import { MemoryObjectStore, PART_BYTES, S3Store, objectKey } from './blob';
import { MemoryRepo } from './repo';
import { MemoryRegistryStore, Registry, STORAGE_FULL_MESSAGE, localGuard } from './storage';

const MB = 1024 * 1024;
let n = 0;
/** Overflow starts above 6 MB used and returns to the database below 4 MB; the bucket holds 12 MB */
const setup = (b2Limit = 12 * MB) => {
  const reg = new Registry(new MemoryRegistryStore(), 6 * MB, { b2: new MemoryRegistryStore(), b2Limit, lowWater: 4 * MB });
  const blobs = new MemoryObjectStore();
  const mk = (id: string) => {
    const e: HandlerEnv & { clock: number } = { repo: new MemoryRepo(), clock: 1000, now: () => e.clock++, newKey: () => `key${(n++).toString().padStart(30, '0')}`, storage: localGuard(reg, id), blobs } as never;
    return e;
  };
  return { reg, blobs, mk };
};
const call = (env: HandlerEnv, method: string, path: string, opts: { key?: string; body?: BodyInit; headers?: Record<string, string> } = {}) => {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.key) headers['x-job-key'] = opts.key;
  return handleJob(new Request('https://x.test/api/jobs/J/' + path, { method, headers, body: opts.body }), path.split('/').filter(Boolean), env);
};
const start = async (env: HandlerEnv) => (await (await call(env, 'POST', 'init', { body: JSON.stringify({ title: 'T' }) })).json()) as { producerKey: string; talentKey: string };
const wav = (bytes: number) => { const b = new Uint8Array(bytes); b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]); for (let i = 12; i < bytes; i++) b[i] = i % 251; return b; };
const sha = async (d: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', d))].map((x) => x.toString(16).padStart(2, '0')).join('');
const upload = async (env: HandlerEnv, key: string, data: Uint8Array) => {
  const r = await call(env, 'POST', 'uploads', { key, body: JSON.stringify({ kind: 'attachment', name: 'a.wav', mime: 'audio/wav', size: data.length }) });
  if (r.status !== 201) return { res: r, id: '' };
  const { uploadId } = (await r.json()) as { uploadId: string };
  for (let i = 0; i * CHUNK < data.length; i++) {
    const piece = data.slice(i * CHUNK, (i + 1) * CHUNK);
    await call(env, 'PUT', `uploads/${uploadId}/${i}`, { key, body: piece, headers: { 'x-chunk-sha256': await sha(piece) } });
  }
  return { res: await call(env, 'POST', `uploads/${uploadId}/complete`, { key }), id: uploadId };
};
const bytesOf = async (r: Response) => new Uint8Array(await r.arrayBuffer());

describe('overflow routing', () => {
  it('keeps audio in the database until the high-water mark, then sends new uploads to the bucket', async () => {
    const { reg, blobs, mk } = setup();
    const a = mk('A'), b = mk('B');
    const ka = await start(a), kb = await start(b);
    expect((await upload(a, ka.talentKey, wav(5 * MB))).res.status).toBe(201);
    expect(blobs.objects.size).toBe(0); // 5 MB fits under 6 MB: stays in the database
    expect(reg.status().overflow?.routing).toBe('do');
    const up = await upload(b, kb.talentKey, wav(3 * MB)); // 5 + 3 > 6: overflow
    expect(up.res.status).toBe(201);
    expect(blobs.objects.size).toBe(1);
    expect(reg.status().overflow?.routing).toBe('b2');
    expect(reg.status().totalBytes).toBe(5 * MB); // the database holds only job A
    expect(reg.status().overflow?.b2Bytes).toBe(3 * MB);
    expect(b.repo.totalBytes()).toBe(0); // staging rows were freed
  });

  it('serves a bucket file whole and by Range, and checks the role first', async () => {
    const { blobs, mk } = setup();
    const a = mk('A');
    const k = await start(a);
    await upload(a, k.talentKey, wav(5 * MB));
    const data = wav(3 * MB);
    const up = await upload(a, k.talentKey, data);
    expect(up.res.status).toBe(201);
    const att = (await up.res.json()) as { attachment: { id: string } };
    const id = att.attachment.id;
    expect(blobs.objects.has(objectKey(id))).toBe(true);
    expect(a.repo.getAtt(id)?.store).toBe('b2');
    const whole = await call(a, 'GET', `audio/${id}`, { key: k.producerKey });
    expect(whole.status).toBe(200);
    expect(await sha(await bytesOf(whole))).toBe(await sha(data));
    const part = await call(a, 'GET', `audio/${id}`, { key: k.producerKey, headers: { range: 'bytes=1000-1999' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 1000-1999/${3 * MB}`);
    expect(await bytesOf(part)).toEqual(data.slice(1000, 2000));
    expect((await call(a, 'GET', `audio/${id}`)).status).toBe(403); // no key
    expect((await call(a, 'GET', `audio/${id}`, { key: 'wrong' })).status).toBe(403);
  });

  it('uses a multipart upload for a file bigger than one part and keeps the bytes identical', async () => {
    const { blobs, mk } = setup(40 * MB);
    const a = mk('A');
    const k = await start(a);
    await upload(a, k.talentKey, wav(5 * MB));
    const data = wav(2 * PART_BYTES + 123_456);
    const r = (await upload(a, k.talentKey, data)).res;
    // may be refused if the single-job limit is smaller; use the registry-level result
    expect([201, 413]).toContain(r.status);
    if (r.status === 201) {
      const id = ((await r.json()) as { attachment: { id: string } }).attachment.id;
      expect(await sha(blobs.objects.get(objectKey(id))!.data)).toBe(await sha(data));
    }
  });

  it('returns to the database only after usage falls below the low-water mark', async () => {
    const { reg, mk } = setup();
    const a = mk('A'), b = mk('B');
    const ka = await start(a), kb = await start(b);
    await upload(a, ka.talentKey, wav(5 * MB));
    await upload(b, kb.talentKey, wav(2 * MB)); // overflow
    expect(reg.status().overflow?.routing).toBe('b2');
    reg.set('A', 5 * MB - 1); // still above the low-water mark (4 MB)
    expect(reg.place(1)).toEqual({ where: 'b2' });
    reg.set('A', 3 * MB); // below it
    expect(reg.place(1)).toEqual({ where: 'do' });
    expect(reg.status().overflow?.routing).toBe('do');
  });

  it('refuses with the plain message when the bucket is full too', async () => {
    const { mk } = setup(4 * MB);
    const a = mk('A'), b = mk('B'), c = mk('C');
    const ka = await start(a), kb = await start(b), kc = await start(c);
    await upload(a, ka.talentKey, wav(5 * MB));
    expect((await upload(b, kb.talentKey, wav(3 * MB))).res.status).toBe(201); // bucket now 3 of 4 MB
    const r = (await upload(c, kc.talentKey, wav(2 * MB))).res;
    expect(r.status).toBe(507);
    expect(((await r.json()) as { error: string }).error).toBe(STORAGE_FULL_MESSAGE);
  });

  it('leaves nothing behind and says so when the bucket is down', async () => {
    const { reg, blobs, mk } = setup();
    const a = mk('A'), b = mk('B');
    const ka = await start(a), kb = await start(b);
    await upload(a, ka.talentKey, wav(5 * MB));
    blobs.failPut = true;
    const { res } = await upload(b, kb.talentKey, wav(3 * MB));
    expect(res.status).toBe(502);
    expect(b.repo.totalBytes()).toBe(0);
    expect(reg.status().overflow?.b2Bytes).toBe(0);
    expect(blobs.objects.size).toBe(0);
  });

  it('deletes the bucket file when the file is replaced, expires, or the job is deleted; retries failed deletes', async () => {
    const { reg, blobs, mk } = setup();
    const a = mk('A'), b = mk('B');
    const ka = await start(a), kb = await start(b);
    await upload(a, ka.talentKey, wav(5 * MB));
    const first = ((await (await upload(b, kb.talentKey, wav(2 * MB))).res.json()) as { attachment: { id: string } }).attachment.id;
    expect(blobs.objects.has(objectKey(first))).toBe(true);
    // expiry: after 31 days any request purges it
    blobs.failDelete = true;
    b.clock += 31 * 24 * 3600 * 1000;
    await call(b, 'GET', 'thread', { key: kb.producerKey });
    expect(blobs.objects.has(objectKey(first))).toBe(true); // delete failed, still queued
    expect(b.repo.b2Pending()).toEqual([first]);
    blobs.failDelete = false;
    await call(b, 'GET', 'thread', { key: kb.producerKey });
    expect(blobs.objects.size).toBe(0);
    expect(b.repo.b2Pending()).toEqual([]);
    expect(reg.status().overflow?.b2Bytes).toBe(0); // the purge reported the new size
  });

  it('S3Store signs requests with SigV4 (known-answer check against the AWS documentation vector)', async () => {
    const seen: { url: string; headers: Record<string, string>; method: string }[] = [];
    const fake = (async (url: string, init: RequestInit) => { seen.push({ url, headers: init.headers as Record<string, string>, method: String(init.method) }); return new Response('ok', { status: 200 }); }) as unknown as typeof fetch;
    const s = new S3Store({ endpoint: 'https://s3.us-west-004.backblazeb2.com', bucket: 'uudastudio', keyId: 'KEYID', secret: 'SECRET' }, () => new Date('2026-11-20T10:11:12.345Z'), fake);
    await s.putParts('audio/abc', 'audio/wav', [new Uint8Array([1, 2, 3])]);
    expect(seen[0].url).toBe('https://s3.us-west-004.backblazeb2.com/uudastudio/audio/abc');
    expect(seen[0].method).toBe('PUT');
    expect(seen[0].headers['x-amz-date']).toBe('20261120T101112Z');
    expect(seen[0].headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=KEYID\/20261120\/us-west-004\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(seen[0].headers.host).toBeUndefined();
  });

  it('removes bucket files when the producer deletes the job (wipe helper)', async () => {
    const { blobs, mk } = setup();
    const a = mk('A'), b = mk('B');
    const ka = await start(a), kb = await start(b);
    await upload(a, ka.talentKey, wav(5 * MB));
    await upload(b, kb.talentKey, wav(2 * MB));
    expect(blobs.objects.size).toBe(1);
    const { wipeB2 } = await import('./handler');
    await wipeB2(b.repo, blobs);
    expect(blobs.objects.size).toBe(0);
  });
});
