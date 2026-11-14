import { describe, expect, it } from 'vitest';
import { handleJob, type HandlerEnv } from './handler';
import { MemoryRepo } from './repo';

let n = 0;
const mk = (): HandlerEnv => { const e: any = { repo: new MemoryRepo(), clock: 1000, now: () => e.clock++, newKey: () => `key${(n++).toString().padStart(30, '0')}` }; return e; };
const call = (env: HandlerEnv, method: string, path: string, opts: { key?: string; body?: BodyInit; headers?: Record<string, string> } = {}) => {
  const url = new URL('https://x.test/api/jobs/J/' + path);
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.key) headers['x-job-key'] = opts.key;
  return handleJob(new Request(url, { method, headers, body: opts.body }), path.split('?')[0].split('/').filter(Boolean), env);
};
const wav = (bytes: number) => { const b = new Uint8Array(bytes); b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]); return b; };
const sha = async (d: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', d))].map((x) => x.toString(16).padStart(2, '0')).join('');
const sendPreview = async (env: HandlerEnv, key: string) => {
  const data = wav(1000);
  const { uploadId } = (await (await call(env, 'POST', 'uploads', { key, body: JSON.stringify({ kind: 'preview', name: 'p.wav', mime: 'audio/wav', size: data.length }) })).json()) as { uploadId: string };
  await call(env, 'PUT', `uploads/${uploadId}/0`, { key, body: data, headers: { 'x-chunk-sha256': await sha(data) } });
  return call(env, 'POST', `uploads/${uploadId}/complete`, { key });
};
const setup = async () => {
  const env = mk();
  const k = (await (await call(env, 'POST', 'init', { body: JSON.stringify({ title: 'T', producer: 'Ada' }) })).json()) as { producerKey: string };
  const c = (await (await call(env, 'POST', 'client-link', { key: k.producerKey })).json()) as { clientKey: string };
  return { env, p: k.producerKey, c: c.clientKey };
};
const clientThread = async (env: HandlerEnv, key: string) => ((await (await call(env, 'GET', 'thread?after=0', { key })).json()) as { messages: any[] }).messages;

describe('preview in the client thread', () => {
  it('adds the preview as a message the client can hear', async () => {
    const { env, p, c } = await setup();
    expect((await sendPreview(env, p)).status).toBe(201);
    const msgs = await clientThread(env, c);
    const pv = msgs.find((m) => m.event?.type === 'preview');
    expect(pv.attachment.name).toBe('p.wav');
    expect(pv.event.n).toBe(pv.id);
    expect((await call(env, 'GET', `audio/${pv.attachment.id}`, { key: c })).status).toBe(200);
  });

  it('lets the client approve or ask for changes to the latest preview only', async () => {
    const { env, p, c } = await setup();
    await sendPreview(env, p);
    const first = (await clientThread(env, c)).find((m) => m.event?.type === 'preview');
    await sendPreview(env, p); // replaces the first
    const old = await call(env, 'POST', 'preview/approve', { key: c, body: JSON.stringify({ n: first.id, name: 'Cy' }) });
    expect(old.status).toBe(409);
    const latest = (await clientThread(env, c)).filter((m) => m.event?.type === 'preview').pop();
    expect((await call(env, 'POST', 'preview/changes', { key: c, body: JSON.stringify({ n: latest.id, text: '' }) })).status).toBe(400);
    expect((await call(env, 'POST', 'preview/changes', { key: c, body: JSON.stringify({ n: latest.id, text: 'Softer ending', name: 'Cy' }) })).status).toBe(200);
    expect((await call(env, 'POST', 'preview/approve', { key: c, body: JSON.stringify({ n: latest.id, name: 'Cy' }) })).status).toBe(200);
    const msgs = await clientThread(env, c);
    const ev = msgs.filter((m) => m.event?.type === 'pvchanges' || m.event?.type === 'pvapproved');
    expect(ev.map((m) => m.event.type)).toEqual(['pvchanges', 'pvapproved']);
    expect(ev[0].text).toBe('Softer ending');
    // the first preview's file is gone, the message stays and says so
    expect(msgs.find((m) => m.id === first.id).attachmentExpired).toBe(true);
  });

  it('keeps others out of the decision', async () => {
    const { env, p, c } = await setup();
    await sendPreview(env, p);
    const pv = (await clientThread(env, c)).find((m) => m.event?.type === 'preview');
    expect((await call(env, 'POST', 'preview/approve', { key: p, body: JSON.stringify({ n: pv.id }) })).status).toBe(403);
  });
});
