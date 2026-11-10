/**
 * The rules of one job: who may read and write, what a message is, how audio is stored and served.
 * Host-neutral (Web Request and Response only) so it runs inside a Cloudflare Durable Object and inside Express.
 */
import type { JobRepo, JobRow, MsgRow, Role } from './repo';

export const LIMITS = {
  title: 120,
  script: 20000,
  notes: 6000,
  producer: 60,
  talent: 60,
  name: 60,
  text: 4000,
  /** One audio file */
  attachmentBytes: 80 * 1024 * 1024,
  /** All audio of one job */
  jobBytes: 300 * 1024 * 1024,
  messages: 1000,
  page: 200,
};
/** Bytes per stored piece; each piece is one database row, which must stay under 2 MB */
export const CHUNK = 1024 * 1024;
/** A job with no activity for this long is deleted */
export const FILE_TTL_MS = 30 * 24 * 3600 * 1000;
export const RETENTION_MS = FILE_TTL_MS;

export interface HandlerEnv {
  repo: JobRepo;
  now: () => number;
  /** A fresh unguessable key (128 bits or more) */
  newKey: () => string;
  /** Called after any change, to push back the deletion date */
  touch?: () => void;
  /** Deletes the whole job */
  wipe?: () => void | Promise<void>;
}

const H = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: H });
const fail = (status: number, error: string) => json({ error }, status);

const same = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v : '').replace(/\u0000/g, '').slice(0, max);

/** The first bytes of a real audio file: WAV, MP3, Ogg, FLAC, M4A/MP4, WebM */
export const looksLikeAudio = (b: Uint8Array): boolean => {
  if (b.length < 12) return false;
  const s = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
  return (
    (s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE') ||
    s(0, 3) === 'ID3' ||
    (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) ||
    s(0, 4) === 'OggS' ||
    s(0, 4) === 'fLaC' ||
    s(4, 4) === 'ftyp' ||
    (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3)
  );
};

const safeMime = (m: string): string => (/^audio\/[a-z0-9.+-]{1,40}$/i.test(m) ? m.toLowerCase() : 'application/octet-stream');
const safeName = (n: string): string => n.replace(/[^\w.\- ()]/g, '_').slice(0, 100) || 'audio';

const roleOf = (req: Request, repo: JobRepo): Role | null => {
  const url = new URL(req.url);
  const key = req.headers.get('x-job-key') || url.searchParams.get('k') || '';
  if (!key) return null;
  for (const k of repo.getKeys()) if (!k.revoked && same(k.key, key)) return k.role;
  return null;
};

/** Deletes audio older than FILE_TTL_MS (the messages stay, marked as expired) */
const purgeExpired = (repo: JobRepo, now: number) => {
  const gone = repo.attsBefore(now - FILE_TTL_MS);
  if (!gone.length) return;
  const j = repo.getJob();
  for (const id of gone) { if (j?.referenceAtt === id) repo.setReference(null); repo.deleteAtt(id); }
};

const pubAtt = (a: { id: string; name: string; mime: string; bytes: number; ts: number }) => ({ id: a.id, name: a.name, mime: a.mime, bytes: a.bytes, expiresAt: a.ts + FILE_TTL_MS });

const publicJob = (j: JobRow, repo: JobRepo) => {
  const ref = j.referenceAtt ? repo.getAtt(j.referenceAtt) : null;
  return {
    title: j.title, script: j.script, notes: j.notes, producer: j.producer, talent: j.talent ?? '', targetSeconds: j.targetSeconds, createdAt: j.createdAt,
    reference: ref ? pubAtt(ref) : null,
  };
};

const publicMsg = (m: MsgRow, repo: JobRepo) => {
  const a = m.att ? repo.getAtt(m.att) : null;
  return { id: m.id, ts: m.ts, role: m.role, name: m.name, text: m.text, attachment: a ? pubAtt(a) : null, attachmentExpired: !!m.att && !a };
};

const threadFor = (role: Role, url: URL): string => (role === 'talent' ? 'talent' : url.searchParams.get('thread') === 'client' ? 'client' : 'talent');

/** Reads a request body into pieces of CHUNK bytes and stores them. Returns the byte count, or an error. */
const storeStream = async (req: Request, repo: JobRepo, attId: string, max: number, room: number): Promise<{ bytes: number; head: Uint8Array } | { error: string; status: number }> => {
  if (!req.body) return { error: 'No file was sent.', status: 400 };
  const reader = req.body.getReader();
  const buf = new Uint8Array(CHUNK);
  let fill = 0, idx = 0, total = 0;
  let head = new Uint8Array(0);
  const flush = () => {
    if (fill === 0) return;
    const piece = buf.slice(0, fill);
    if (idx === 0) head = piece.slice(0, 16);
    repo.putChunk(attId, idx++, piece);
    fill = 0;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) { await reader.cancel(); repo.deleteAtt(attId); return { error: `That file is too large. The limit is ${Math.floor(max / 1048576)} MB.`, status: 413 }; }
      if (total > room) { await reader.cancel(); repo.deleteAtt(attId); return { error: 'This job has no storage left for more audio.', status: 413 }; }
      let o = 0;
      while (o < value.length) {
        const n = Math.min(CHUNK - fill, value.length - o);
        buf.set(value.subarray(o, o + n), fill);
        fill += n; o += n;
        if (fill === CHUNK) flush();
      }
    }
    flush();
  } catch {
    repo.deleteAtt(attId);
    return { error: 'The upload was interrupted. Try again.', status: 400 };
  }
  if (total === 0) return { error: 'The file is empty.', status: 400 };
  if (!looksLikeAudio(head)) { repo.deleteAtt(attId); return { error: 'That does not look like an audio file.', status: 415 }; }
  return { bytes: total, head };
};

const serveAudio = (req: Request, repo: JobRepo, attId: string): Response => {
  const att = repo.getAtt(attId);
  if (!att) return fail(404, 'Not found.');
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
  let start = 0, end = att.bytes - 1, status = 200;
  if (range && (range[1] !== '' || range[2] !== '')) {
    if (range[1] === '') { start = Math.max(0, att.bytes - Number(range[2])); }
    else { start = Number(range[1]); if (range[2] !== '') end = Math.min(end, Number(range[2])); }
    if (start > end || start >= att.bytes) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${att.bytes}` } });
    status = 206;
  }
  const first = Math.floor(start / CHUNK), last = Math.floor(end / CHUNK);
  let next = first;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (next > last) { controller.close(); return; }
      const c = repo.getChunk(attId, next);
      if (!c) { controller.error(new Error('missing piece')); return; }
      const from = next === first ? start - first * CHUNK : 0;
      const to = next === last ? end - last * CHUNK + 1 : c.length;
      controller.enqueue(c.subarray(from, to));
      next++;
    },
  });
  const headers: Record<string, string> = {
    'content-type': safeMime(att.mime), 'content-length': String(end - start + 1), 'accept-ranges': 'bytes', 'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff', 'content-disposition': `inline; filename="${safeName(att.name)}"`,
  };
  if (status === 206) headers['content-range'] = `bytes ${start}-${end}/${att.bytes}`;
  return new Response(req.method === 'HEAD' ? null : body, { status, headers });
};

/** Handles one request for one job. `rest` is the path after the job id, split on "/". */
export const handleJob = async (req: Request, rest: string[], env: HandlerEnv): Promise<Response> => {
  const { repo, now } = env;
  const url = new URL(req.url);
  const route = rest[0] ?? '';

  if (route === 'init' && req.method === 'POST') {
    if (repo.getJob()) return fail(409, 'This job already exists.');
    let b: Record<string, unknown>;
    try { b = (await req.json()) as Record<string, unknown>; } catch { return fail(400, 'Bad request.'); }
    const target = Number(b.targetSeconds);
    repo.putJob({
      title: clip(b.title, LIMITS.title).trim() || 'Voice recording', script: clip(b.script, LIMITS.script), notes: clip(b.notes, LIMITS.notes),
      producer: clip(b.producer, LIMITS.producer).trim(), talent: clip(b.talent, LIMITS.talent).trim(), targetSeconds: Number.isFinite(target) && target > 0 ? Math.min(Math.round(target), 6 * 3600) : null,
      createdAt: now(), referenceAtt: null,
    });
    const producerKey = env.newKey(), talentKey = env.newKey();
    repo.setKey('producer', producerKey);
    repo.setKey('talent', talentKey);
    env.touch?.();
    return json({ producerKey, talentKey }, 201);
  }

  const job = repo.getJob();
  if (!job) return fail(404, 'This job does not exist or has been deleted.');
  const role = roleOf(req, repo);
  if (!role) return fail(403, 'This link is not valid any more. Ask the producer for a new one.');
  purgeExpired(repo, now());

  if (route === 'thread' && req.method === 'GET') {
    const thread = threadFor(role, url);
    const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
    const keys = role === 'producer' ? Object.fromEntries(repo.getKeys().filter((k) => !k.revoked).map((k) => [k.role, k.key])) : undefined;
    return json({ role, job: publicJob(job, repo), messages: repo.messagesAfter(thread, after, LIMITS.page).map((m) => publicMsg(m, repo)), lastId: repo.lastMessageId(thread), keys });
  }

  if (route === 'messages' && req.method === 'POST') {
    let b: Record<string, unknown>;
    try { b = (await req.json()) as Record<string, unknown>; } catch { return fail(400, 'Bad request.'); }
    const text = clip(b.text, LIMITS.text).trim();
    if (!text) return fail(400, 'Type a message first.');
    if (repo.messageCount() >= LIMITS.messages) return fail(429, 'This thread is full.');
    const id = repo.addMessage({ ts: now(), thread: threadFor(role, url), role, name: clip(b.name, LIMITS.name).trim() || (role === 'producer' ? job.producer || 'Producer' : 'Talent'), text, att: null });
    env.touch?.();
    return json({ id }, 201);
  }

  if ((route === 'attachments' || route === 'reference') && req.method === 'PUT') {
    if (route === 'reference' && role !== 'producer') return fail(403, 'Only the producer can add a reference.');
    if (repo.messageCount() >= LIMITS.messages) return fail(429, 'This thread is full.');
    const declared = Number(req.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > LIMITS.attachmentBytes) return fail(413, `That file is too large. The limit is ${LIMITS.attachmentBytes / 1048576} MB.`);
    const attId = env.newKey();
    const stored = await storeStream(req, repo, attId, LIMITS.attachmentBytes, LIMITS.jobBytes - repo.totalBytes());
    if ('error' in stored) return fail(stored.status, stored.error);
    const name = safeName(url.searchParams.get('name') || 'audio');
    const ts = now();
    repo.addAtt({ id: attId, name, mime: safeMime(url.searchParams.get('mime') || 'audio/wav'), bytes: stored.bytes, ts });
    if (route === 'reference') {
      if (job.referenceAtt) repo.deleteAtt(job.referenceAtt);
      repo.setReference(attId);
      env.touch?.();
      return json({ attachment: { id: attId, name, bytes: stored.bytes, expiresAt: ts + FILE_TTL_MS } }, 201);
    }
    const id = repo.addMessage({ ts: now(), thread: threadFor(role, url), role, name: clip(url.searchParams.get('who'), LIMITS.name).trim() || (role === 'producer' ? job.producer || 'Producer' : 'Talent'), text: clip(url.searchParams.get('text'), LIMITS.text).trim(), att: attId });
    env.touch?.();
    return json({ id, attachment: { id: attId, name, bytes: stored.bytes, expiresAt: ts + FILE_TTL_MS } }, 201);
  }

  if (route === 'uploads') {
    const bad = (e: string, s = 400) => fail(s, e);
    if (req.method === 'POST' && !rest[1]) {
      let b: Record<string, unknown>;
      try { b = (await req.json()) as Record<string, unknown>; } catch { return bad('Bad request.'); }
      const kind = b.kind === 'reference' ? 'reference' : 'attachment';
      if (kind === 'reference' && role !== 'producer') return bad('Only the producer can add a reference.', 403);
      if (repo.messageCount() >= LIMITS.messages) return bad('This thread is full.', 429);
      const size = Math.floor(Number(b.size));
      if (!Number.isFinite(size) || size <= 0) return bad('The file is empty.');
      if (size > LIMITS.attachmentBytes) return bad(`That file is too large. The limit is ${LIMITS.attachmentBytes / 1048576} MB.`, 413);
      if (size > LIMITS.jobBytes - repo.totalBytes()) return bad('This job has no room left for more audio.', 413);
      const id = env.newKey();
      repo.putUpload({ id, kind, name: safeName(clip(b.name, 120) || 'audio'), mime: safeMime(clip(b.mime, 60) || 'audio/wav'), who: clip(b.who, LIMITS.name).trim(), text: clip(b.text, LIMITS.text).trim(), thread: threadFor(role, new URL(`http://x/?thread=${b.thread === 'client' ? 'client' : 'talent'}`)), role, size, ts: now() });
      return json({ uploadId: id, chunkSize: CHUNK, chunks: Math.ceil(size / CHUNK) }, 201);
    }
    const up = rest[1] ? repo.getUpload(rest[1]) : null;
    if (!up || up.role !== role) return bad('That upload was not found. Send the file again.', 404);
    const count = Math.ceil(up.size / CHUNK);
    if (req.method === 'GET' && !rest[2]) return json({ received: repo.chunkIndexes(up.id), chunks: count });
    if (req.method === 'PUT' && rest[2] !== undefined && rest[2] !== 'complete') {
      const idx = Number(rest[2]);
      if (!Number.isInteger(idx) || idx < 0 || idx >= count) return bad('Bad piece number.');
      const data = new Uint8Array(await req.arrayBuffer());
      const want = idx === count - 1 ? up.size - idx * CHUNK : CHUNK;
      if (data.length !== want) return bad('That piece is the wrong size. Send it again.', 422);
      const sum = (req.headers.get('x-chunk-sha256') || '').toLowerCase();
      const got = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map((x) => x.toString(16).padStart(2, '0')).join('');
      if (sum !== got) return bad('That piece was damaged on the way. Send it again.', 422);
      repo.putChunk(up.id, idx, data);
      return json({ ok: true, idx });
    }
    if (req.method === 'POST' && rest[2] === 'complete') {
      const have = repo.chunkIndexes(up.id);
      if (have.length !== count || have.some((v, i) => v !== i)) return json({ error: 'Some of the file did not arrive. Send it again.', received: have }, 409);
      const first = repo.getChunk(up.id, 0);
      if (!first || !looksLikeAudio(first)) { repo.deleteAtt(up.id); repo.deleteUpload(up.id); return bad('That does not look like an audio file.', 415); }
      const ts = now();
      repo.addAtt({ id: up.id, name: up.name, mime: up.mime, bytes: up.size, ts });
      repo.deleteUpload(up.id);
      const att = { id: up.id, name: up.name, bytes: up.size, expiresAt: ts + FILE_TTL_MS };
      if (up.kind === 'reference') {
        if (job.referenceAtt) repo.deleteAtt(job.referenceAtt);
        repo.setReference(up.id);
        env.touch?.();
        return json({ attachment: att }, 201);
      }
      const id = repo.addMessage({ ts: now(), thread: up.thread, role, name: up.who || (role === 'producer' ? job.producer || 'Producer' : 'Talent'), text: up.text, att: up.id });
      env.touch?.();
      return json({ id, attachment: att }, 201);
    }
    return bad('Not found.', 404);
  }

  if (route === 'audio' && (req.method === 'GET' || req.method === 'HEAD') && rest[1]) return serveAudio(req, repo, rest[1]);

  if (route === 'revoke' && req.method === 'POST') {
    if (role !== 'producer') return fail(403, 'Only the producer can do that.');
    repo.revokeKey('talent');
    const talentKey = env.newKey();
    repo.setKey('talent', talentKey);
    env.touch?.();
    return json({ talentKey });
  }

  if (route === '' && req.method === 'DELETE') {
    if (role !== 'producer') return fail(403, 'Only the producer can do that.');
    await env.wipe?.();
    return json({ ok: true });
  }

  return fail(404, 'Not found.');
};
