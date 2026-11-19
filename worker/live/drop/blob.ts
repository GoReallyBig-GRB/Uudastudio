import { signRequest, type S3Config } from './s3';
import type { Backing } from './plan';

/** Where the pieces of a take are kept. Two kinds: Durable Object storage and B2. */
export interface BlobStore {
  readonly kind: Backing;
  /** Starts a take; returns a handle to use for the rest (B2's upload id, empty for the Durable Object) */
  begin(key: string): Promise<string>;
  /** Stores one numbered part; returns a tag for it (B2's ETag) */
  putPart(key: string, handle: string, n: number, data: Uint8Array): Promise<string>;
  getPart(key: string, handle: string, n: number, partBytes: number, totalBytes: number): Promise<Uint8Array | null>;
  /** Called once every part is in */
  complete(key: string, handle: string, tags: string[]): Promise<void>;
  /** Deletes everything for a take, finished or not */
  remove(key: string, handle: string, done: boolean): Promise<void>;
}

export class MemoryBlob implements BlobStore {
  readonly parts = new Map<string, Uint8Array>();
  completed = new Set<string>();
  constructor(readonly kind: Backing = 'do') {}
  async begin(): Promise<string> { return this.kind === 'b2' ? `up-${Math.random().toString(36).slice(2)}` : ''; }
  async putPart(key: string, _h: string, n: number, data: Uint8Array): Promise<string> { this.parts.set(`${key}:${n}`, data.slice()); return `tag${n}`; }
  async getPart(key: string, _h: string, n: number): Promise<Uint8Array | null> { return this.parts.get(`${key}:${n}`) ?? null; }
  async complete(key: string): Promise<void> { this.completed.add(key); }
  async remove(key: string): Promise<void> { for (const k of [...this.parts.keys()]) if (k.startsWith(`${key}:`)) this.parts.delete(k); this.completed.delete(key); }
  bytes(): number { let n = 0; for (const v of this.parts.values()) n += v.length; return n; }
}

type Sql = { exec(q: string, ...b: unknown[]): { toArray(): Record<string, unknown>[] } };

/** Parts stored as rows in the Durable Object's own SQLite */
export class DoBlob implements BlobStore {
  readonly kind = 'do' as const;
  constructor(private readonly sql: Sql) { sql.exec('CREATE TABLE IF NOT EXISTS drop_parts (k TEXT NOT NULL, n INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (k, n))'); }
  async begin(): Promise<string> { return ''; }
  async putPart(key: string, _h: string, n: number, data: Uint8Array): Promise<string> { this.sql.exec('INSERT OR REPLACE INTO drop_parts (k, n, data) VALUES (?, ?, ?)', key, n, data); return `do${n}`; }
  async getPart(key: string, _h: string, n: number): Promise<Uint8Array | null> {
    const r = this.sql.exec('SELECT data FROM drop_parts WHERE k = ? AND n = ?', key, n).toArray()[0];
    if (!r) return null;
    const d = r.data as ArrayBuffer | Uint8Array;
    return d instanceof Uint8Array ? d : new Uint8Array(d);
  }
  async complete(): Promise<void> { /* nothing to join: parts are read one at a time */ }
  async remove(key: string): Promise<void> { this.sql.exec('DELETE FROM drop_parts WHERE k = ?', key); }
}

/** Parts sent to a Backblaze B2 bucket through its S3-compatible interface, as one multipart upload per take */
export class B2Blob implements BlobStore {
  readonly kind = 'b2' as const;
  constructor(private readonly cfg: S3Config, private readonly fetchFn: typeof fetch = fetch, private readonly now: () => Date = () => new Date()) {}

  private host(): string { return new URL(this.cfg.endpoint).host; }
  private path(key: string): string { return `/${this.cfg.bucket}/${key}`; }
  private async call(method: string, key: string, query: Record<string, string>, body?: Uint8Array | string, extra: Record<string, string> = {}): Promise<Response> {
    const hash = body === undefined ? 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' : method === 'PUT' ? 'UNSIGNED-PAYLOAD' : await (await import('./s3')).sha256Hex(body);
    const headers = await signRequest({ method, host: this.host(), path: this.path(key), query, headers: extra, payloadHash: hash, region: this.cfg.region, keyId: this.cfg.keyId, appKey: this.cfg.appKey, now: this.now() });
    const qs = Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const url = `${this.cfg.endpoint.replace(/\/$/, '')}${this.path(key).split('/').map(encodeURIComponent).join('/')}${qs ? `?${qs}` : ''}`;
    delete headers.host;
    return this.fetchFn(url, { method, headers, body: body as BodyInit | undefined });
  }

  async begin(key: string): Promise<string> {
    const r = await this.call('POST', key, { uploads: '' });
    if (!r.ok) throw new Error(`B2 refused to start (${r.status})`);
    const m = /<UploadId>([^<]+)<\/UploadId>/.exec(await r.text());
    if (!m) throw new Error('B2 gave no upload id');
    return m[1];
  }
  async putPart(key: string, handle: string, n: number, data: Uint8Array): Promise<string> {
    const r = await this.call('PUT', key, { partNumber: String(n + 1), uploadId: handle }, data);
    if (!r.ok) throw new Error(`B2 refused a part (${r.status})`);
    return r.headers.get('etag') ?? '';
  }
  async getPart(key: string, _h: string, n: number, partBytes: number, totalBytes: number): Promise<Uint8Array | null> {
    const from = n * partBytes, to = Math.min(totalBytes, from + partBytes) - 1;
    const r = await this.call('GET', key, {}, undefined, { range: `bytes=${from}-${to}` });
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  }
  async complete(key: string, handle: string, tags: string[]): Promise<void> {
    const xml = `<CompleteMultipartUpload>${tags.map((t, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${t}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
    const r = await this.call('POST', key, { uploadId: handle }, xml);
    if (!r.ok) throw new Error(`B2 could not finish (${r.status})`);
  }
  async remove(key: string, handle: string, done: boolean): Promise<void> {
    await (done ? this.call('DELETE', key, {}) : this.call('DELETE', key, { uploadId: handle })).catch(() => undefined);
  }
}
