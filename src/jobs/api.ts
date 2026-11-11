/** Calls to the jobs server (Cloudflare Worker when hosted, Express in AI Studio). */

/** `expiresAt` is when the server deletes the file (ms since epoch) */
export interface Attachment { id: string; name: string; mime: string; bytes: number; expiresAt?: number }
export interface ThreadMessage { id: number; ts: number; role: 'producer' | 'talent' | 'client'; name: string; text: string; attachment: Attachment | null; attachmentExpired?: boolean }
export interface JobInfo { title: string; script: string; notes: string; producer: string; talent?: string; targetSeconds: number | null; createdAt: number; reference: Attachment | null; /** Producer only: what the client reviews */ preview?: Attachment | null; final?: Attachment | null; released?: boolean }
/** What a reviewing client is allowed to see */
export interface ClientJobInfo { title: string; producer: string; preview: Attachment | null; /** A final file exists but is not released */ finalReady: boolean; released: boolean; final: Attachment | null }
export interface ClientThreadResponse { role: 'client'; job: ClientJobInfo; messages: ThreadMessage[]; lastId: number }
export interface ThreadResponse { role: 'producer' | 'talent' | 'client'; job: JobInfo; messages: ThreadMessage[]; lastId: number; keys?: { talent?: string; client?: string } }
export interface NewJob { title: string; script: string; notes: string; producer: string; talent?: string; targetSeconds?: number }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const BASE = '/api/jobs';

const read = async (r: Response) => {
  let body: { error?: string } & Record<string, unknown> = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw new ApiError(r.status, typeof body.error === 'string' ? body.error : r.status === 404 ? 'The jobs service is not available here.' : 'Something went wrong. Try again.');
  return body;
};
const net = async <T,>(p: Promise<T>): Promise<T> => { try { return await p; } catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(0, 'No connection. Check the internet and try again.'); } };

export const ping = async (): Promise<{ createRequiresCode: boolean; temporary: boolean } | null> => {
  try {
    const r = await fetch(`${BASE}/ping`);
    if (!r.ok) return null;
    const b = await r.json();
    return b && b.ok ? { createRequiresCode: Boolean(b.createRequiresCode), temporary: Boolean(b.temporary) } : null;
  } catch { return null; }
};

export const createJob = (job: NewJob, code?: string) =>
  net(fetch(BASE, { method: 'POST', headers: { 'content-type': 'application/json', ...(code ? { 'x-jobs-create-code': code } : {}) }, body: JSON.stringify(job) }).then(read)) as Promise<{ jobId: string; producerKey: string; talentKey: string }>;

export const getThread = (jobId: string, key: string, after = 0, thread: 'talent' | 'client' = 'talent') =>
  net(fetch(`${BASE}/${jobId}/thread?after=${after}${thread === 'client' ? '&thread=client' : ''}`, { headers: { 'x-job-key': key }, cache: 'no-store' }).then(read)) as Promise<ThreadResponse>;

/** The reviewing client's own view of the job */
export const getClientThread = (jobId: string, key: string, after = 0) =>
  net(fetch(`${BASE}/${jobId}/thread?after=${after}`, { headers: { 'x-job-key': key }, cache: 'no-store' }).then(read)) as unknown as Promise<ClientThreadResponse>;

export const postMessage = (jobId: string, key: string, name: string, text: string, thread: 'talent' | 'client' = 'talent') =>
  net(fetch(`${BASE}/${jobId}/messages${thread === 'client' ? '?thread=client' : ''}`, { method: 'POST', headers: { 'x-job-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ name, text }) }).then(read));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hex = async (d: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', d))].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Uploads begun in this page, so a retry of the same file carries on from the pieces already stored */
const begun = new WeakMap<Blob, string>();

/**
 * Sends a file in pieces. Each piece carries its SHA-256 so the server can refuse one damaged in transit, and a piece that
 * fails is retried; sending the same file again continues from the pieces the server already holds.
 */
const upload = async (jobId: string, key: string, blob: Blob, init: { kind: 'attachment' | 'reference' | 'preview' | 'final'; name: string; mime: string; who?: string; text?: string; thread?: string }, onProgress?: (f: number) => void): Promise<{ id?: number; attachment?: Attachment }> => {
  const h = { 'x-job-key': key };
  let uploadId = begun.get(blob);
  let chunkSize = 0, chunks = 0, have = new Set<number>();
  if (uploadId) {
    try {
      const st = (await net(fetch(`${BASE}/${jobId}/uploads/${uploadId}`, { headers: h, cache: 'no-store' }).then(read))) as { received: number[]; chunks: number };
      have = new Set(st.received); chunks = st.chunks;
    } catch (e) { if (e instanceof ApiError && e.status === 404) uploadId = undefined; else throw e; }
  }
  if (!uploadId) {
    const r = (await net(fetch(`${BASE}/${jobId}/uploads`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ ...init, size: blob.size }) }).then(read))) as { uploadId: string; chunkSize: number; chunks: number };
    uploadId = r.uploadId; chunkSize = r.chunkSize; chunks = r.chunks; have = new Set();
    begun.set(blob, uploadId);
  }
  if (!chunkSize) chunkSize = 1024 * 1024; // resuming: the server always cuts at 1 MB
  onProgress?.(have.size / chunks);
  for (let i = 0; i < chunks; i++) {
    if (have.has(i)) continue;
    const data = await blob.slice(i * chunkSize, Math.min(blob.size, (i + 1) * chunkSize)).arrayBuffer();
    const sum = await hex(data);
    for (let attempt = 0; ; attempt++) {
      try {
        await net(fetch(`${BASE}/${jobId}/uploads/${uploadId}/${i}`, { method: 'PUT', headers: { ...h, 'x-chunk-sha256': sum }, body: data }).then(read));
        break;
      } catch (e) {
        const retryable = !(e instanceof ApiError) || e.status === 0 || e.status === 422 || e.status >= 500;
        if (!retryable || attempt >= 4) throw e;
        await sleep(600 * 2 ** attempt);
      }
    }
    onProgress?.((i + 1) / chunks);
  }
  const done = (await net(fetch(`${BASE}/${jobId}/uploads/${uploadId}/complete`, { method: 'POST', headers: h }).then(read))) as { id?: number; attachment?: Attachment };
  begun.delete(blob);
  return done;
};

export const sendAudio = (jobId: string, key: string, blob: Blob, o: { name: string; who: string; text?: string }, onProgress?: (f: number) => void) =>
  upload(jobId, key, blob, { kind: 'attachment', name: o.name, mime: blob.type || 'audio/wav', who: o.who, text: o.text ?? '' }, onProgress);

export const sendReference = (jobId: string, key: string, file: File, onProgress?: (f: number) => void) =>
  upload(jobId, key, file, { kind: 'reference', name: file.name, mime: file.type || 'audio/wav' }, onProgress);

export const sendPreview = (jobId: string, key: string, file: File, onProgress?: (f: number) => void) =>
  upload(jobId, key, file, { kind: 'preview', name: file.name, mime: file.type || 'audio/wav' }, onProgress);

export const sendFinal = (jobId: string, key: string, file: File, onProgress?: (f: number) => void) =>
  upload(jobId, key, file, { kind: 'final', name: file.name, mime: file.type || 'audio/wav' }, onProgress);

/** Makes (or replaces) the client link; the old one stops working */
export const createClientLink = (jobId: string, key: string) => net(fetch(`${BASE}/${jobId}/client-link`, { method: 'POST', headers: { 'x-job-key': key } }).then(read)) as Promise<{ clientKey: string }>;
export const setReleased = (jobId: string, key: string, released: boolean) => net(fetch(`${BASE}/${jobId}/release`, { method: 'POST', headers: { 'x-job-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ released }) }).then(read)) as Promise<{ released: boolean }>;

export const audioUrl = (jobId: string, attId: string, key: string): string => `${BASE}/${jobId}/audio/${attId}?k=${key}`;

export const revokeTalentLink = (jobId: string, key: string) => net(fetch(`${BASE}/${jobId}/revoke`, { method: 'POST', headers: { 'x-job-key': key } }).then(read)) as Promise<{ talentKey: string }>;
export const deleteJob = (jobId: string, key: string) => net(fetch(`${BASE}/${jobId}`, { method: 'DELETE', headers: { 'x-job-key': key } }).then(read));
