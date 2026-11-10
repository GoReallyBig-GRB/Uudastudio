/**
 * Storage behind one job. The job rules (handler.ts) only talk to this small interface, so the same rules run on a
 * Cloudflare Durable Object (SqlRepo) and on the Express server used in AI Studio (MemoryRepo), and are tested without either.
 */

export type Role = 'producer' | 'talent';

export interface JobRow {
  title: string;
  script: string;
  notes: string;
  producer: string;
  /** Who will record it, if the producer said (shown to them, so they are never asked for their name) */
  talent?: string;
  targetSeconds: number | null;
  createdAt: number;
  referenceAtt: string | null;
}
export interface KeyRow { role: Role; key: string; revoked: boolean }
export interface AttRow { id: string; name: string; mime: string; bytes: number; ts: number }
export interface MsgRow { id: number; ts: number; thread: string; role: Role; name: string; text: string; att: string | null }

/** A file being sent piece by piece. Its pieces are stored as chunks under the same id the finished attachment will have. */
export interface UploadRow { id: string; kind: 'attachment' | 'reference'; name: string; mime: string; who: string; text: string; thread: string; role: Role; size: number; ts: number }

export interface JobRepo {
  ensure(): void;
  getJob(): JobRow | null;
  putJob(job: JobRow): void;
  setReference(attId: string | null): void;
  getKeys(): KeyRow[];
  setKey(role: Role, key: string): void;
  revokeKey(role: Role): void;
  addMessage(m: Omit<MsgRow, 'id'>): number;
  messagesAfter(thread: string, after: number, limit: number): MsgRow[];
  messageCount(): number;
  lastMessageId(thread: string): number;
  addAtt(a: AttRow): void;
  getAtt(id: string): AttRow | null;
  /** Total bytes of every attachment held for this job */
  totalBytes(): number;
  putChunk(att: string, idx: number, data: Uint8Array): void;
  getChunk(att: string, idx: number): Uint8Array | null;
  deleteAtt(id: string): void;
  putUpload(u: UploadRow): void;
  getUpload(id: string): UploadRow | null;
  deleteUpload(id: string): void;
  /** Which pieces of a file are stored, in order */
  chunkIndexes(att: string): number[];
}

export class MemoryRepo implements JobRepo {
  private job: JobRow | null = null;
  private keys = new Map<Role, KeyRow>();
  private msgs: MsgRow[] = [];
  private atts = new Map<string, AttRow>();
  private chunks = new Map<string, Uint8Array>();
  private ups = new Map<string, UploadRow>();
  private nextId = 1;
  ensure() {}
  getJob() { return this.job ? { ...this.job } : null; }
  putJob(job: JobRow) { this.job = { ...job }; }
  setReference(attId: string | null) { if (this.job) this.job.referenceAtt = attId; }
  getKeys() { return [...this.keys.values()].map((k) => ({ ...k })); }
  setKey(role: Role, key: string) { this.keys.set(role, { role, key, revoked: false }); }
  revokeKey(role: Role) { const k = this.keys.get(role); if (k) k.revoked = true; }
  addMessage(m: Omit<MsgRow, 'id'>) { const id = this.nextId++; this.msgs.push({ ...m, id }); return id; }
  messagesAfter(thread: string, after: number, limit: number) { return this.msgs.filter((m) => m.thread === thread && m.id > after).slice(0, limit).map((m) => ({ ...m })); }
  messageCount() { return this.msgs.length; }
  lastMessageId(thread: string) { return this.msgs.filter((m) => m.thread === thread).reduce((n, m) => Math.max(n, m.id), 0); }
  addAtt(a: AttRow) { this.atts.set(a.id, { ...a }); }
  getAtt(id: string) { const a = this.atts.get(id); return a ? { ...a } : null; }
  totalBytes() { let n = 0; for (const c of this.chunks.values()) n += c.length; return n; }
  putChunk(att: string, idx: number, data: Uint8Array) { this.chunks.set(`${att}:${idx}`, data.slice()); }
  getChunk(att: string, idx: number) { return this.chunks.get(`${att}:${idx}`) ?? null; }
  putUpload(u: UploadRow) { this.ups.set(u.id, { ...u }); }
  getUpload(id: string) { const u = this.ups.get(id); return u ? { ...u } : null; }
  deleteUpload(id: string) { this.ups.delete(id); }
  chunkIndexes(att: string) { return [...this.chunks.keys()].filter((k) => k.startsWith(`${att}:`)).map((k) => Number(k.slice(att.length + 1))).sort((a, b) => a - b); }
  deleteAtt(id: string) {
    this.atts.delete(id);
    for (const k of [...this.chunks.keys()]) if (k.startsWith(`${id}:`)) this.chunks.delete(k);
  }
}

/** What both Cloudflare's `ctx.storage.sql` and a test adapter provide */
export interface Sql {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
}

const asBytes = (v: unknown): Uint8Array => (v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBuffer));
const asBuffer = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

export class SqlRepo implements JobRepo {
  constructor(private sql: Sql) { this.ensure(); }
  ensure() {
    const q = (s: string) => this.sql.exec(s);
    q('CREATE TABLE IF NOT EXISTS job (id INTEGER PRIMARY KEY CHECK (id = 1), title TEXT, script TEXT, notes TEXT, producer TEXT, target INTEGER, created INTEGER, reference_att TEXT)');
    // Jobs made before talent names existed lack this column; adding it twice throws, which is fine
    try { q('ALTER TABLE job ADD COLUMN talent TEXT'); } catch { /* already there */ }
    q('CREATE TABLE IF NOT EXISTS keys (role TEXT PRIMARY KEY, key TEXT, revoked INTEGER)');
    q('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, thread TEXT, role TEXT, name TEXT, text TEXT, att TEXT)');
    q('CREATE TABLE IF NOT EXISTS atts (id TEXT PRIMARY KEY, name TEXT, mime TEXT, bytes INTEGER, ts INTEGER)');
    q('CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, json TEXT)');
    q('CREATE TABLE IF NOT EXISTS blobs (att TEXT, idx INTEGER, data BLOB, PRIMARY KEY (att, idx))');
  }
  getJob(): JobRow | null {
    const r = this.sql.exec('SELECT * FROM job WHERE id = 1').toArray()[0];
    if (!r) return null;
    return { title: String(r.title), script: String(r.script), notes: String(r.notes), producer: String(r.producer), ...(r.talent ? { talent: String(r.talent) } : {}), targetSeconds: r.target == null ? null : Number(r.target), createdAt: Number(r.created), referenceAtt: r.reference_att == null ? null : String(r.reference_att) };
  }
  putJob(j: JobRow) { this.sql.exec('INSERT OR REPLACE INTO job (id, title, script, notes, producer, talent, target, created, reference_att) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)', j.title, j.script, j.notes, j.producer, j.talent ?? null, j.targetSeconds, j.createdAt, j.referenceAtt); }
  setReference(attId: string | null) { this.sql.exec('UPDATE job SET reference_att = ? WHERE id = 1', attId); }
  getKeys(): KeyRow[] { return this.sql.exec('SELECT role, key, revoked FROM keys').toArray().map((r) => ({ role: r.role as Role, key: String(r.key), revoked: Number(r.revoked) === 1 })); }
  setKey(role: Role, key: string) { this.sql.exec('INSERT OR REPLACE INTO keys (role, key, revoked) VALUES (?, ?, 0)', role, key); }
  revokeKey(role: Role) { this.sql.exec('UPDATE keys SET revoked = 1 WHERE role = ?', role); }
  addMessage(m: Omit<MsgRow, 'id'>): number {
    const r = this.sql.exec('INSERT INTO messages (ts, thread, role, name, text, att) VALUES (?, ?, ?, ?, ?, ?) RETURNING id', m.ts, m.thread, m.role, m.name, m.text, m.att).toArray()[0];
    return Number(r.id);
  }
  messagesAfter(thread: string, after: number, limit: number): MsgRow[] {
    return this.sql.exec('SELECT * FROM messages WHERE thread = ? AND id > ? ORDER BY id LIMIT ?', thread, after, limit).toArray().map((r) => ({ id: Number(r.id), ts: Number(r.ts), thread: String(r.thread), role: r.role as Role, name: String(r.name), text: String(r.text), att: r.att == null ? null : String(r.att) }));
  }
  messageCount() { return Number(this.sql.exec('SELECT COUNT(*) AS n FROM messages').toArray()[0].n); }
  lastMessageId(thread: string) { return Number(this.sql.exec('SELECT COALESCE(MAX(id), 0) AS n FROM messages WHERE thread = ?', thread).toArray()[0].n); }
  addAtt(a: AttRow) { this.sql.exec('INSERT OR REPLACE INTO atts (id, name, mime, bytes, ts) VALUES (?, ?, ?, ?, ?)', a.id, a.name, a.mime, a.bytes, a.ts); }
  getAtt(id: string): AttRow | null {
    const r = this.sql.exec('SELECT * FROM atts WHERE id = ?', id).toArray()[0];
    return r ? { id: String(r.id), name: String(r.name), mime: String(r.mime), bytes: Number(r.bytes), ts: Number(r.ts) } : null;
  }
  totalBytes() { return Number(this.sql.exec('SELECT COALESCE(SUM(LENGTH(data)), 0) AS n FROM blobs').toArray()[0].n); }
  putChunk(att: string, idx: number, data: Uint8Array) { this.sql.exec('INSERT OR REPLACE INTO blobs (att, idx, data) VALUES (?, ?, ?)', att, idx, asBuffer(data)); }
  getChunk(att: string, idx: number): Uint8Array | null {
    const r = this.sql.exec('SELECT data FROM blobs WHERE att = ? AND idx = ?', att, idx).toArray()[0];
    return r ? asBytes(r.data) : null;
  }
  putUpload(u: UploadRow) { this.sql.exec('INSERT OR REPLACE INTO uploads (id, json) VALUES (?, ?)', u.id, JSON.stringify(u)); }
  getUpload(id: string): UploadRow | null {
    const r = this.sql.exec('SELECT json FROM uploads WHERE id = ?', id).toArray()[0];
    if (!r) return null;
    try { return JSON.parse(String(r.json)) as UploadRow; } catch { return null; }
  }
  deleteUpload(id: string) { this.sql.exec('DELETE FROM uploads WHERE id = ?', id); }
  chunkIndexes(att: string): number[] { return this.sql.exec('SELECT idx FROM blobs WHERE att = ? ORDER BY idx', att).toArray().map((r) => Number(r.idx)); }
  deleteAtt(id: string) {
    this.sql.exec('DELETE FROM blobs WHERE att = ?', id);
    this.sql.exec('DELETE FROM atts WHERE id = ?', id);
  }
}
