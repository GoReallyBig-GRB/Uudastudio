/** Where live events are kept: D1 on the Worker, memory for tests. */
import type { D1Full } from '../templates/store';
import type { FileMeta, LiveEventRow } from './rules';

export interface StoredFile extends FileMeta { data: Uint8Array }
export interface LiveStore {
  list(userId: string): Promise<LiveEventRow[]>;
  get(userId: string, id: string): Promise<LiveEventRow | null>;
  byToken(token: string): Promise<LiveEventRow | null>;
  save(row: LiveEventRow): Promise<void>;
  remove(userId: string, id: string): Promise<boolean>;
  count(userId: string): Promise<number>;
  files(eventId: string): Promise<FileMeta[]>;
  file(eventId: string, fileId: string): Promise<StoredFile | null>;
  addFile(eventId: string, f: StoredFile): Promise<void>;
  removeFile(eventId: string, fileId: string): Promise<boolean>;
}

export class MemoryLiveStore implements LiveStore {
  events = new Map<string, LiveEventRow>();
  blobs = new Map<string, StoredFile>();
  async list(u: string) { return [...this.events.values()].filter((e) => e.userId === u); }
  async get(u: string, id: string) { const e = this.events.get(id); return e && e.userId === u ? e : null; }
  async byToken(t: string) { return [...this.events.values()].find((e) => e.token === t) ?? null; }
  async save(r: LiveEventRow) { this.events.set(r.id, { ...r }); }
  async remove(u: string, id: string) { if (!(await this.get(u, id))) return false; this.events.delete(id); for (const k of [...this.blobs.keys()]) if (k.startsWith(`${id}/`)) this.blobs.delete(k); return true; }
  async count(u: string) { return (await this.list(u)).length; }
  async files(id: string) { return [...this.blobs.entries()].filter(([k]) => k.startsWith(`${id}/`)).map(([, f]) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, kind: f.kind })); }
  async file(id: string, fid: string) { return this.blobs.get(`${id}/${fid}`) ?? null; }
  async addFile(id: string, f: StoredFile) { this.blobs.set(`${id}/${f.id}`, f); }
  async removeFile(id: string, fid: string) { return this.blobs.delete(`${id}/${fid}`); }
}

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS live_events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, notes TEXT NOT NULL, starts_at INTEGER, activated_at INTEGER, ended_at INTEGER, participants TEXT NOT NULL, host_name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS live_events_user ON live_events (user_id)',
  'CREATE TABLE IF NOT EXISTS live_event_files (event_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (event_id, id))',
];

const toB64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (b: string) => { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };

const rowOf = (r: Record<string, unknown>): LiveEventRow => {
  let participants: LiveEventRow['participants'] = [];
  try { participants = JSON.parse(String(r.participants)); } catch { /* none */ }
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return { id: String(r.id), userId: String(r.user_id), token: String(r.token), kind: r.kind === 'quick' ? 'quick' : 'scheduled', title: String(r.title), description: String(r.description), notes: String(r.notes), startsAt: n(r.starts_at), activatedAt: n(r.activated_at), endedAt: n(r.ended_at), participants, hostName: String(r.host_name), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) };
};

/** Costs on D1's free plan: a list reads at most 100 rows; every change is one write; file bytes are only read on download */
export class D1LiveStore implements LiveStore {
  private ready: Promise<unknown> | null = null;
  constructor(private db: D1Full) {}
  private init() {
    return (this.ready ??= (async () => { for (const q of SCHEMA) await this.db.exec(q); })().catch((e) => { this.ready = null; throw e; }));
  }
  async list(u: string) { await this.init(); const { results } = await this.db.prepare('SELECT * FROM live_events WHERE user_id = ? ORDER BY COALESCE(starts_at, created_at) DESC LIMIT 100').bind(u).all(); return results.map(rowOf); }
  async get(u: string, id: string) { await this.init(); const r = await this.db.prepare('SELECT * FROM live_events WHERE user_id = ? AND id = ?').bind(u, id).first(); return r ? rowOf(r) : null; }
  async byToken(t: string) { await this.init(); const r = await this.db.prepare('SELECT * FROM live_events WHERE token = ?').bind(t).first(); return r ? rowOf(r) : null; }
  async save(r: LiveEventRow) {
    await this.init();
    await this.db.prepare('INSERT INTO live_events (id, user_id, token, kind, title, description, notes, starts_at, activated_at, ended_at, participants, host_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET title = excluded.title, description = excluded.description, notes = excluded.notes, starts_at = excluded.starts_at, activated_at = excluded.activated_at, ended_at = excluded.ended_at, participants = excluded.participants, updated_at = excluded.updated_at')
      .bind(r.id, r.userId, r.token, r.kind, r.title, r.description, r.notes, r.startsAt, r.activatedAt, r.endedAt, JSON.stringify(r.participants), r.hostName, r.createdAt, r.updatedAt).run();
  }
  async remove(u: string, id: string) {
    await this.init();
    const gone = await this.db.prepare('DELETE FROM live_events WHERE user_id = ? AND id = ? RETURNING id').bind(u, id).first();
    if (gone) await this.db.prepare('DELETE FROM live_event_files WHERE event_id = ?').bind(id).run();
    return gone !== null;
  }
  async count(u: string) { await this.init(); const r = await this.db.prepare('SELECT COUNT(*) AS n FROM live_events WHERE user_id = ?').bind(u).first<{ n: number }>(); return Number(r?.n ?? 0); }
  async files(id: string) { await this.init(); const { results } = await this.db.prepare('SELECT id, name, mime, size, kind FROM live_event_files WHERE event_id = ?').bind(id).all(); return results.map((r) => ({ id: String(r.id), name: String(r.name), mime: String(r.mime), size: Number(r.size), kind: r.kind === 'audio' ? 'audio' as const : 'doc' as const })); }
  async file(id: string, fid: string) {
    await this.init();
    const r = await this.db.prepare('SELECT * FROM live_event_files WHERE event_id = ? AND id = ?').bind(id, fid).first();
    return r ? { id: String(r.id), name: String(r.name), mime: String(r.mime), size: Number(r.size), kind: r.kind === 'audio' ? 'audio' : 'doc', data: fromB64(String(r.data)) } : null;
  }
  async addFile(id: string, f: StoredFile) { await this.init(); await this.db.prepare('INSERT INTO live_event_files (event_id, id, name, mime, size, kind, data) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, f.id, f.name, f.mime, f.size, f.kind, toB64(f.data)).run(); }
  async removeFile(id: string, fid: string) { await this.init(); return (await this.db.prepare('DELETE FROM live_event_files WHERE event_id = ? AND id = ? RETURNING id').bind(id, fid).first()) !== null; }
}
