/** Calls to the jobs server (Cloudflare Worker when hosted, Express in AI Studio). */

export interface Attachment { id: string; name: string; mime: string; bytes: number }
export interface ThreadMessage { id: number; ts: number; role: 'producer' | 'talent'; name: string; text: string; attachment: Attachment | null }
export interface JobInfo { title: string; script: string; notes: string; producer: string; talent?: string; targetSeconds: number | null; createdAt: number; reference: Attachment | null }
export interface ThreadResponse { role: 'producer' | 'talent'; job: JobInfo; messages: ThreadMessage[]; lastId: number; keys?: { talent?: string } }
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

export const getThread = (jobId: string, key: string, after = 0) =>
  net(fetch(`${BASE}/${jobId}/thread?after=${after}`, { headers: { 'x-job-key': key }, cache: 'no-store' }).then(read)) as Promise<ThreadResponse>;

export const postMessage = (jobId: string, key: string, name: string, text: string) =>
  net(fetch(`${BASE}/${jobId}/messages`, { method: 'POST', headers: { 'x-job-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ name, text }) }).then(read));

/** Uploads a file with progress (fetch cannot report upload progress, so this uses XMLHttpRequest) */
const put = (url: string, key: string, blob: Blob, onProgress?: (fraction: number) => void): Promise<{ id?: number }> =>
  new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('x-job-key', key);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    x.onerror = () => reject(new ApiError(0, 'No connection. Check the internet and try again.'));
    x.onabort = () => reject(new ApiError(0, 'The upload was cancelled.'));
    x.onload = () => {
      let b: { error?: string; id?: number } = {};
      try { b = JSON.parse(x.responseText); } catch { /* not JSON */ }
      if (x.status >= 200 && x.status < 300) resolve(b);
      else reject(new ApiError(x.status, b.error ?? 'The file could not be sent. Try again.'));
    };
    x.send(blob);
  });

export const sendAudio = (jobId: string, key: string, blob: Blob, o: { name: string; who: string; text?: string }, onProgress?: (f: number) => void) =>
  put(`${BASE}/${jobId}/attachments?name=${encodeURIComponent(o.name)}&mime=${encodeURIComponent(blob.type || 'audio/wav')}&who=${encodeURIComponent(o.who)}&text=${encodeURIComponent(o.text ?? '')}`, key, blob, onProgress);

export const sendReference = (jobId: string, key: string, file: File, onProgress?: (f: number) => void) =>
  put(`${BASE}/${jobId}/reference?name=${encodeURIComponent(file.name)}&mime=${encodeURIComponent(file.type || 'audio/wav')}`, key, file, onProgress);

export const audioUrl = (jobId: string, attId: string, key: string): string => `${BASE}/${jobId}/audio/${attId}?k=${key}`;

export const revokeTalentLink = (jobId: string, key: string) => net(fetch(`${BASE}/${jobId}/revoke`, { method: 'POST', headers: { 'x-job-key': key } }).then(read)) as Promise<{ talentKey: string }>;
export const deleteJob = (jobId: string, key: string) => net(fetch(`${BASE}/${jobId}`, { method: 'DELETE', headers: { 'x-job-key': key } }).then(read));
