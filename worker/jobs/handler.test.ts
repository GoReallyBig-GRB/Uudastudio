import { describe, expect, it } from 'vitest';
import { CHUNK, LIMITS, handleJob, looksLikeAudio, type HandlerEnv } from './handler';
import { MemoryRepo } from './repo';

let n = 0;
const mk = (): HandlerEnv & { clock: number } => {
  const e: any = { repo: new MemoryRepo(), clock: 1000, now: () => e.clock++, newKey: () => `key${(n++).toString().padStart(30, '0')}` };
  return e;
};
const call = (env: HandlerEnv, method: string, path: string, opts: { key?: string; body?: BodyInit; headers?: Record<string, string> } = {}) => {
  const url = new URL('https://x.test/api/jobs/J/' + path);
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.key) headers['x-job-key'] = opts.key;
  return handleJob(new Request(url, { method, headers, body: opts.body, ...(opts.body && typeof opts.body !== 'string' ? { duplex: 'half' } : {}) } as any), url.pathname.replace('/api/jobs/J/', '').split('/').filter(Boolean), env);
};
const wav = (bytes: number) => { const b = new Uint8Array(bytes); b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]); for (let i = 12; i < bytes; i++) b[i] = i % 251; return b; };
const create = async (env: HandlerEnv) => (await (await call(env, 'POST', 'init', { body: JSON.stringify({ title: 'Intro', script: 'Hello', notes: 'warm', producer: 'Ada', targetSeconds: 30 }) })).json()) as { producerKey: string; talentKey: string };

describe('job creation and access', () => {
  it('creates a job with a producer key and a talent key, once', async () => {
    const env = mk();
    const k = await create(env);
    expect(k.producerKey).not.toBe(k.talentKey);
    expect((await call(env, 'POST', 'init', { body: '{}' })).status).toBe(409);
  });
  it('refuses a missing or wrong key, and shows the talent no keys', async () => {
    const env = mk(); const k = await create(env);
    expect((await call(env, 'GET', 'thread')).status).toBe(403);
    expect((await call(env, 'GET', 'thread', { key: 'nope' })).status).toBe(403);
    const t = await (await call(env, 'GET', 'thread', { key: k.talentKey })).json() as any;
    expect(t.role).toBe('talent'); expect(t.keys).toBeUndefined(); expect(t.job.notes).toBe('warm'); expect(t.job.targetSeconds).toBe(30);
    const p = await (await call(env, 'GET', 'thread', { key: k.producerKey })).json() as any;
    expect(p.keys.talent).toBe(k.talentKey);
  });
  it('a job that does not exist says so', async () => {
    expect((await call(mk(), 'GET', 'thread', { key: 'x' })).status).toBe(404);
  });
});

describe('messages', () => {
  it('both sides write and read in order, and "after" only returns new ones', async () => {
    const env = mk(); const k = await create(env);
    await call(env, 'POST', 'messages', { key: k.talentKey, body: JSON.stringify({ name: 'Tolu', text: 'Ready' }) });
    await call(env, 'POST', 'messages', { key: k.producerKey, body: JSON.stringify({ text: 'Go ahead' }) });
    const all = await (await call(env, 'GET', 'thread', { key: k.producerKey })).json() as any;
    expect(all.messages.map((m: any) => [m.role, m.name, m.text])).toEqual([['talent', 'Tolu', 'Ready'], ['producer', 'Ada', 'Go ahead']]);
    const later = await (await call(env, 'GET', `thread?after=${all.messages[0].id}`, { key: k.talentKey })).json() as any;
    expect(later.messages).toHaveLength(1); expect(later.lastId).toBe(all.lastId);
  });
  it('rejects empty text and caps length', async () => {
    const env = mk(); const k = await create(env);
    expect((await call(env, 'POST', 'messages', { key: k.talentKey, body: JSON.stringify({ text: '  ' }) })).status).toBe(400);
    await call(env, 'POST', 'messages', { key: k.talentKey, body: JSON.stringify({ text: 'x'.repeat(LIMITS.text + 50) }) });
    const t = await (await call(env, 'GET', 'thread', { key: k.talentKey })).json() as any;
    expect(t.messages[0].text.length).toBe(LIMITS.text);
  });
});

describe('audio attachments', () => {
  it('stores a take in pieces, lists it in the thread and serves it back byte for byte, including ranges', async () => {
    const env = mk(); const k = await create(env);
    const file = wav(CHUNK * 2 + 12345);
    const up = await call(env, 'PUT', 'attachments?name=take-1.wav&mime=audio/wav&who=Tolu&text=Take%201', { key: k.talentKey, body: file });
    expect(up.status).toBe(201);
    const t = await (await call(env, 'GET', 'thread', { key: k.producerKey })).json() as any;
    const att = t.messages[0].attachment;
    expect([t.messages[0].text, att.name, att.bytes]).toEqual(['Take 1', 'take-1.wav', file.length]);
    const full = new Uint8Array(await (await call(env, 'GET', `audio/${att.id}`, { key: k.producerKey })).arrayBuffer());
    expect(full.length).toBe(file.length); expect(full.every((v, i) => v === file[i])).toBe(true);
    const r = await call(env, 'GET', `audio/${att.id}`, { key: k.producerKey, headers: { range: `bytes=${CHUNK - 5}-${CHUNK + 4}` } });
    expect([r.status, r.headers.get('content-range')]).toEqual([206, `bytes ${CHUNK - 5}-${CHUNK + 4}/${file.length}`]);
    const part = new Uint8Array(await r.arrayBuffer());
    expect(Array.from(part)).toEqual(Array.from(file.subarray(CHUNK - 5, CHUNK + 5)));
    const tail = new Uint8Array(await (await call(env, 'GET', `audio/${att.id}`, { key: k.talentKey, headers: { range: 'bytes=-10' } })).arrayBuffer());
    expect(Array.from(tail)).toEqual(Array.from(file.subarray(file.length - 10)));
    expect((await call(env, 'GET', `audio/${att.id}`, { key: k.talentKey, headers: { range: `bytes=${file.length + 5}-` } })).status).toBe(416);
  });
  it('needs a valid key to download', async () => {
    const env = mk(); const k = await create(env);
    await call(env, 'PUT', 'attachments?name=a.wav', { key: k.talentKey, body: wav(2000) });
    const t = await (await call(env, 'GET', 'thread', { key: k.talentKey })).json() as any;
    expect((await call(env, 'GET', `audio/${t.messages[0].attachment.id}`)).status).toBe(403);
  });
  it('refuses things that are not audio, empty files and files over the limit', async () => {
    const env = mk(); const k = await create(env);
    expect((await call(env, 'PUT', 'attachments?name=a.exe', { key: k.talentKey, body: new Uint8Array(500).fill(7) })).status).toBe(415);
    expect((await call(env, 'PUT', 'attachments?name=a.wav', { key: k.talentKey, body: new Uint8Array(0) })).status).toBe(400);
    expect((await call(env, 'PUT', 'attachments?name=a.wav', { key: k.talentKey, body: wav(100), headers: { 'content-length': String(LIMITS.attachmentBytes + 1) } })).status).toBe(413);
    expect(env.repo.messageCount()).toBe(0);
    expect(env.repo.totalBytes()).toBe(0);
  });
  it('the job has a storage cap and a refused upload leaves nothing behind', async () => {
    const env = mk(); const k = await create(env);
    const saved = LIMITS.jobBytes; (LIMITS as any).jobBytes = 3000;
    try {
      expect((await call(env, 'PUT', 'attachments?name=a.wav', { key: k.talentKey, body: wav(2000) })).status).toBe(201);
      expect((await call(env, 'PUT', 'attachments?name=b.wav', { key: k.talentKey, body: wav(2000) })).status).toBe(413);
      expect(env.repo.totalBytes()).toBe(2000);
    } finally { (LIMITS as any).jobBytes = saved; }
  });
  it('only the producer adds the reference, and a new one replaces the old', async () => {
    const env = mk(); const k = await create(env);
    expect((await call(env, 'PUT', 'reference?name=r.wav', { key: k.talentKey, body: wav(1000) })).status).toBe(403);
    await call(env, 'PUT', 'reference?name=r1.wav', { key: k.producerKey, body: wav(1000) });
    const first = (await (await call(env, 'GET', 'thread', { key: k.talentKey })).json() as any).job.reference;
    await call(env, 'PUT', 'reference?name=r2.wav', { key: k.producerKey, body: wav(1500) });
    const second = (await (await call(env, 'GET', 'thread', { key: k.talentKey })).json() as any).job.reference;
    expect([first.name, second.name, second.bytes]).toEqual(['r1.wav', 'r2.wav', 1500]);
    expect(env.repo.getAtt(first.id)).toBeNull();
    expect((await call(env, 'GET', `audio/${second.id}`, { key: k.talentKey })).status).toBe(200);
  });
  it('recognises real audio headers', () => {
    expect(looksLikeAudio(wav(20))).toBe(true);
    expect(looksLikeAudio(new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(true);
    expect(looksLikeAudio(new TextEncoder().encode('<html><body>hi</body>'))).toBe(false);
  });
});

describe('revoke and delete', () => {
  it('revoking gives a new talent link and the old one stops working', async () => {
    const env = mk(); const k = await create(env);
    expect((await call(env, 'POST', 'revoke', { key: k.talentKey })).status).toBe(403);
    const r = await (await call(env, 'POST', 'revoke', { key: k.producerKey })).json() as any;
    expect((await call(env, 'GET', 'thread', { key: k.talentKey })).status).toBe(403);
    expect((await call(env, 'GET', 'thread', { key: r.talentKey })).status).toBe(200);
  });
  it('delete asks the host to wipe, producer only', async () => {
    const env = mk(); let wiped = false; env.wipe = () => { wiped = true; };
    const k = await create(env);
    expect((await call(env, 'DELETE', '', { key: k.talentKey })).status).toBe(403);
    expect((await call(env, 'DELETE', '', { key: k.producerKey })).status).toBe(200);
    expect(wiped).toBe(true);
  });
});
