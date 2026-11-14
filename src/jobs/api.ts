/** Calls to the jobs server (Cloudflare Worker when hosted, Express in AI Studio). */
import { limitKind, limitMessage, type LimitKind } from './limits';

/** `expiresAt` is when the server deletes the file (ms since epoch) */
export interface Attachment { id: string; name: string; mime: string; bytes: number; expiresAt?: number }
/** Something the server records in a client thread when the script is shared, approved or sent back */
/** For script events `n` is the script version; for a preview it is the message that holds the preview */
export interface ThreadEvent { type: 'shared' | 'approved' | 'changes' | 'preview' | 'pvapproved' | 'pvchanges'; n: number }
export interface ThreadMessage { id: number; ts: number; role: 'producer' | 'talent' | 'client'; name: string; text: string; attachment: Attachment | null; attachmentExpired?: boolean; event?: ThreadEvent }
export interface ScriptVersionInfo { n: number; ts: number; label: string; words: number }
/** The script as shared with the client */
export interface ShareInfo { n: number; at: number; approved: boolean; approvedN: number | null; /** The shared version is the current one */ current: boolean }
export interface JobInfo { title: string; script: string; notes: string; producer: string; talent?: string; targetSeconds: number | null; createdAt: number; reference: Attachment | null; /** Producer only: what the client reviews */ preview?: Attachment | null; final?: Attachment | null; released?: boolean; scriptN?: number; versions?: ScriptVersionInfo[]; share?: ShareInfo | null }
/** What a reviewing client is allowed to see */
export interface ClientScript { n: number; text: string; at: number; approved: boolean }
export interface ClientJobInfo { title: string; producer: string; script: ClientScript | null; preview: Attachment | null; /** A final file exists but is not released */ finalReady: boolean; released: boolean; final: Attachment | null }
export interface ClientThreadResponse { role: 'client'; job: ClientJobInfo; messages: ThreadMessage[]; lastId: number }
export interface ThreadResponse { role: 'producer' | 'talent' | 'client'; job: JobInfo; messages: ThreadMessage[]; lastId: number; keys?: { talent?: string; client?: string } }
export interface NewJob { title: string; script: string; notes: string; producer: string; talent?: string; targetSeconds?: number }

export class ApiError extends Error {
  constructor(public status: number, message: string, public limit: LimitKind | null = null) { super(message); }
}

const BASE = '/api/jobs';

/** Listed by extension: a file picker told `audio/*` has to look up every audio type, which takes seconds to open on Windows */
export const AUDIO_ACCEPT = '.wav,.mp3,.m4a,.aac,.flac,.ogg,.oga,.opus,.aif,.aiff,.webm';

const read = async (r: Response) => {
  let body: { error?: string } & Record<string, unknown> = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) {
    const own = typeof body.error === 'string' ? body.error : undefined;
    throw new ApiError(r.status, limitMessage(r.status, own) ?? own ?? (r.status === 404 ? 'The jobs service is not available here.' : 'Something went wrong. Try again.'), limitKind(r.status, own));
  }
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

/** Both threads of a job in one request (producer only). Older servers lack this and answer 404. */
export interface JobSummaryResponse { talent: { messages: ThreadMessage[]; lastId: number }; client: { messages: ThreadMessage[]; lastId: number; linked: boolean } }
export const getSummary = (jobId: string, key: string) =>
  net(fetch(`${BASE}/${jobId}/summary`, { headers: { 'x-job-key': key }, cache: 'no-store' }).then(read)) as Promise<JobSummaryResponse>;

export const saveScript = (jobId: string, key: string, body: { script?: string; notes?: string; label?: string }) =>
  net(fetch(`${BASE}/${jobId}/script`, { method: 'PUT', headers: { 'x-job-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(read)) as Promise<{ n: number; changed: boolean }>;
export const getScriptVersion = (jobId: string, key: string, n: number) =>
  net(fetch(`${BASE}/${jobId}/script/versions/${n}`, { headers: { 'x-job-key': key }, cache: 'no-store' }).then(read)) as Promise<{ n: number; ts: number; label: string; script: string }>;
export const shareScript = (jobId: string, key: string) => net(fetch(`${BASE}/${jobId}/script/share`, { method: 'POST', headers: { 'x-job-key': key } }).then(read)) as Promise<{ n: number }>;
export const unshareScript = (jobId: string, key: string) => net(fetch(`${BASE}/${jobId}/script/unshare`, { method: 'POST', headers: { 'x-job-key': key } }).then(read));
/** The client's answer to the shared script */
export const approveScript = (jobId: string, key: string, n: number, name: string) =>
  net(fetch(`${BASE}/${jobId}/script/approve`, { method: 'POST', headers: { 'x-job-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ n, name }) }).then(read));
export const requestScriptChanges = (jobId: string, key: string, n: number, text: string, name: string) =>
  net(fetch(`${BASE}/${jobId}/script/changes`, { method: 'POST', headers: { 'x-job-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ n, text, name }) }).then(read));

/** The client's answer to the latest preview (`n` is the id of the preview's message) */
export const approvePreview = (jobId: string, key: string, n: number, name: string) =>
  net(fetch(`${BASE}/${jobId}/preview/approve`, { method: 'POST', headers: { 'x-job-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ n, name }) }).then(read));
export const requestPreviewChanges = (jobId: string, key: string, n: number, text: string, name: string) =>
  net(fetch(`${BASE}/${jobId}/preview/changes`, { method: 'POST', headers: { 'x-job-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ n, text, name }) }).then(read));

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
const upload = async (jobId: string, key: string, blob: Blob, init: { kind: 'attachment' | 'reference' | 'preview' | 'final'; name: string; mime: string; who?: string; text?: string; thread?: 'talent' | 'client'; seconds?: number }, onProgress?: (f: number) => void): Promise<{ id?: number; attachment?: Attachment }> => {
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
        const retryable = !(e instanceof ApiError) || (!e.limit && (e.status === 0 || e.status === 422 || e.status >= 500));
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

export const sendAudio = (jobId: string, key: string, blob: Blob, o: { name: string; who: string; text?: string; thread?: 'talent' | 'client'; /** Length of the recording, so the server can apply its length cap before the upload starts */ seconds?: number }, onProgress?: (f: number) => void) =>
  upload(jobId, key, blob, { kind: 'attachment', name: o.name, mime: blob.type || 'audio/wav', who: o.who, text: o.text ?? '', thread: o.thread, seconds: o.seconds }, onProgress);

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
