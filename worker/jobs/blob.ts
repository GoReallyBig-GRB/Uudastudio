/**
 * Overflow storage for audio: an S3-compatible bucket (Backblaze B2) used when the Durable Object
 * storage is nearly full. Host-neutral: only fetch and Web Crypto, so it runs in a Worker and in tests.
 * The bucket is private. Audio is only ever read through the Worker, which checks the link's role first.
 */

/** S3 multipart parts must be at least 5 MiB, except the last */
export const PART_BYTES = 5 * 1024 * 1024;

export interface ObjectStore {
  /** Stores the pieces, in order, as one object. Every piece but the last must be at least PART_BYTES. */
  putParts(key: string, mime: string, pieces: Iterable<Uint8Array>): Promise<void>;
  /** Bytes start..end (inclusive) of an object, as a stream */
  get(key: string, start: number, end: number): Promise<ReadableStream<Uint8Array>>;
  /** Deleting something that is not there is not an error */
  delete(key: string): Promise<void>;
}

/** The bucket key for a stored file */
export const objectKey = (attId: string): string => `audio/${attId}`;

export interface S3Config { endpoint: string; bucket: string; keyId: string; secret: string; region?: string }

/** Reads the bucket settings from Worker variables and secrets; undefined when any is missing */
export const s3ConfigFrom = (env: { B2_ENDPOINT?: string; B2_BUCKET?: string; B2_KEY_ID?: string; B2_APPLICATION_KEY?: string; B2_REGION?: string }): S3Config | undefined => {
  const { B2_ENDPOINT: endpoint, B2_BUCKET: bucket, B2_KEY_ID: keyId, B2_APPLICATION_KEY: secret } = env;
  if (!endpoint || !bucket || !keyId || !secret) return undefined;
  return { endpoint: endpoint.replace(/\/+$/, ''), bucket, keyId, secret, region: env.B2_REGION };
};

const te = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array): string => [...new Uint8Array(b as ArrayBuffer)].map((x) => x.toString(16).padStart(2, '0')).join('');
const bytesOf = (d: Uint8Array | string): Uint8Array => (typeof d === 'string' ? te.encode(d) : d);
const sha256 = async (d: Uint8Array | string): Promise<string> => hex(await crypto.subtle.digest('SHA-256', bytesOf(d) as BufferSource));
const hmac = async (key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> => {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, te.encode(msg));
};
const rfc3986 = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export class S3Store implements ObjectStore {
  private region: string;
  private host: string;
  constructor(private cfg: S3Config, private clock: () => Date = () => new Date(), private fetcher: typeof fetch = (...a) => fetch(...a)) {
    const u = new URL(cfg.endpoint);
    this.host = u.host;
    this.region = cfg.region || /^s3\.([^.]+)\./.exec(u.host)?.[1] || 'us-east-1';
  }

  /** Signs and sends one request (AWS Signature Version 4, path style) */
  private async send(method: string, key: string, query: Record<string, string>, body: Uint8Array | undefined, extra: Record<string, string> = {}): Promise<Response> {
    const path = `/${rfc3986(this.cfg.bucket)}/${key.split('/').map(rfc3986).join('/')}`;
    const q = Object.keys(query).sort().map((k) => `${rfc3986(k)}=${rfc3986(query[k])}`).join('&');
    const now = this.clock().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const day = now.slice(0, 8);
    const payload = await sha256(body ?? '');
    const headers: Record<string, string> = { ...extra, host: this.host, 'x-amz-content-sha256': payload, 'x-amz-date': now };
    const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]));
    const canonical = [method, path, q, ...names.map((n) => `${n}:${lower[n]}`), '', names.join(';'), payload].join('\n');
    const scope = `${day}/${this.region}/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', now, scope, await sha256(canonical)].join('\n');
    let k: ArrayBuffer = await hmac(te.encode('AWS4' + this.cfg.secret), day);
    for (const part of [this.region, 's3', 'aws4_request']) k = await hmac(k, part);
    const signature = hex(await hmac(k, toSign));
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.cfg.keyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
    delete headers.host; // the runtime sets Host from the URL
    return this.fetcher(`${this.cfg.endpoint}${path}${q ? '?' + q : ''}`, { method, headers, body: body as BodyInit | undefined });
  }

  /** One retry: a network blip or a 5xx from the bucket should not lose a recording */
  private async sendRetry(method: string, key: string, query: Record<string, string>, body: Uint8Array | undefined, extra: Record<string, string> = {}): Promise<Response> {
    let res: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { res = await this.send(method, key, query, body, extra); } catch (e) { if (attempt === 1) throw e; continue; }
      if (res.status < 500) return res;
      await res.arrayBuffer().catch(() => undefined);
    }
    return res as Response;
  }

  async putParts(key: string, mime: string, pieces: Iterable<Uint8Array>): Promise<void> {
    const list = pieces[Symbol.iterator]();
    const first = list.next();
    if (first.done) throw new Error('nothing to store');
    const second = list.next();
    if (second.done) {
      const r = await this.sendRetry('PUT', key, {}, first.value, { 'content-type': mime });
      if (!r.ok) throw new Error(`bucket refused the file (${r.status})`);
      await r.arrayBuffer().catch(() => undefined);
      return;
    }
    const start = await this.sendRetry('POST', key, { uploads: '' }, undefined, { 'content-type': mime });
    const text = await start.text();
    const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(text)?.[1];
    if (!start.ok || !uploadId) throw new Error(`bucket would not start the upload (${start.status})`);
    try {
      const etags: string[] = [];
      let n = 0;
      for (let cur: IteratorResult<Uint8Array> = first, nxt: IteratorResult<Uint8Array> = second; !cur.done; cur = nxt, nxt = nxt.done ? nxt : list.next()) {
        n++;
        const r = await this.sendRetry('PUT', key, { partNumber: String(n), uploadId }, cur.value);
        await r.arrayBuffer().catch(() => undefined);
        const etag = r.headers.get('etag');
        if (!r.ok || !etag) throw new Error(`bucket refused part ${n} (${r.status})`);
        etags.push(etag);
      }
      const xml = `<CompleteMultipartUpload>${etags.map((e, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${e}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
      const done = await this.sendRetry('POST', key, { uploadId }, te.encode(xml), { 'content-type': 'application/xml' });
      const doneText = await done.text();
      if (!done.ok || /<Error>/.test(doneText)) throw new Error(`bucket would not finish the upload (${done.status})`);
    } catch (e) {
      try { const a = await this.send('DELETE', key, { uploadId }, undefined); await a.arrayBuffer().catch(() => undefined); } catch { /* the bucket's lifecycle rule clears unfinished uploads */ }
      throw e;
    }
  }

  async get(key: string, start: number, end: number): Promise<ReadableStream<Uint8Array>> {
    const r = await this.sendRetry('GET', key, {}, undefined, { range: `bytes=${start}-${end}` });
    if ((r.status !== 206 && r.status !== 200) || !r.body) { await r.arrayBuffer().catch(() => undefined); throw new Error(`bucket could not read the file (${r.status})`); }
    return r.body;
  }

  async delete(key: string): Promise<void> {
    const r = await this.sendRetry('DELETE', key, {}, undefined);
    await r.arrayBuffer().catch(() => undefined);
    if (!r.ok && r.status !== 404) throw new Error(`bucket would not delete the file (${r.status})`);
  }
}

/** In-memory bucket for tests */
export class MemoryObjectStore implements ObjectStore {
  objects = new Map<string, { mime: string; data: Uint8Array }>();
  failPut = false;
  failGet = false;
  failDelete = false;
  async putParts(key: string, mime: string, pieces: Iterable<Uint8Array>) {
    if (this.failPut) throw new Error('bucket down');
    const parts = [...pieces];
    parts.forEach((p, i) => { if (i < parts.length - 1 && p.length < PART_BYTES) throw new Error('part too small'); });
    const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { data.set(p, o); o += p.length; }
    this.objects.set(key, { mime, data });
  }
  async get(key: string, start: number, end: number) {
    if (this.failGet) throw new Error('bucket down');
    const o = this.objects.get(key);
    if (!o) throw new Error('missing');
    const slice = o.data.slice(start, end + 1);
    return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(slice); c.close(); } });
  }
  async delete(key: string) {
    if (this.failDelete) throw new Error('bucket down');
    this.objects.delete(key);
  }
}
