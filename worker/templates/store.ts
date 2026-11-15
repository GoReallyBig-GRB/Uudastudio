/**
 * Where templates are kept on the Worker: Cloudflare D1, or memory for tests.
 * Same three calls as the Express stores, so the rules in server/templateService.ts are shared.
 * Costs on D1's free plan: a list reads at most 50 rows; a save is 1 write; a delete is 1 write.
 */
import type { D1Like } from '../auth/users';
import type { StoredTemplate, TemplateStore } from '../../server/templateService';

/** D1Like plus the one call a list needs */
export interface D1Full extends D1Like {
  prepare(q: string): { bind(...v: unknown[]): { first<T = Record<string, unknown>>(): Promise<T | null>; run(): Promise<unknown>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }> } };
}

const SCHEMA = 'CREATE TABLE IF NOT EXISTS templates (user_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, size_bytes INTEGER NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, id))';
const iso = (ms: number) => new Date(ms).toISOString();

export class MemoryTemplateStore implements TemplateStore {
  rows = new Map<string, StoredTemplate>();
  constructor(private now: () => number = Date.now) {}
  async saveTemplate(userId: string, id: string, name: string, data: unknown) {
    const old = this.rows.get(`${userId}/${id}`);
    const t = iso(this.now());
    const row: StoredTemplate = { id, user_id: userId, name, size_bytes: new TextEncoder().encode(JSON.stringify(data)).length, data, created_at: old?.created_at ?? t, updated_at: t };
    this.rows.set(`${userId}/${id}`, row);
    return row;
  }
  async getTemplatesForUser(userId: string) { return [...this.rows.values()].filter((r) => r.user_id === userId).sort((a, b) => b.updated_at.localeCompare(a.updated_at)); }
  async deleteTemplate(userId: string, id: string) { return this.rows.delete(`${userId}/${id}`); }
}

const fromRow = (r: Record<string, unknown>): StoredTemplate => {
  let data: unknown = null;
  try { data = JSON.parse(String(r.data)); } catch { /* left empty; the browser re-checks every template */ }
  return { id: String(r.id), user_id: String(r.user_id), name: String(r.name), size_bytes: Number(r.size_bytes) || 0, data, created_at: iso(Number(r.created_at)), updated_at: iso(Number(r.updated_at)) };
};

export class D1TemplateStore implements TemplateStore {
  private ready: Promise<unknown> | null = null;
  constructor(private db: D1Full, private now: () => number = Date.now) {}
  private init() { return (this.ready ??= this.db.exec(SCHEMA).catch((e) => { this.ready = null; throw e; })); }
  async saveTemplate(userId: string, id: string, name: string, data: unknown) {
    await this.init();
    const json = JSON.stringify(data);
    const t = this.now();
    // One statement: a new row, or the same row updated (its creation time is kept)
    const r = await this.db.prepare('INSERT INTO templates (user_id, id, name, size_bytes, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, id) DO UPDATE SET name = excluded.name, size_bytes = excluded.size_bytes, data = excluded.data, updated_at = excluded.updated_at RETURNING *').bind(userId, id, name, new TextEncoder().encode(json).length, json, t, t).first();
    if (!r) throw new Error('template not saved');
    return fromRow(r);
  }
  async getTemplatesForUser(userId: string) {
    await this.init();
    const { results } = await this.db.prepare('SELECT * FROM templates WHERE user_id = ? ORDER BY updated_at DESC LIMIT 60').bind(userId).all();
    return results.map(fromRow);
  }
  async deleteTemplate(userId: string, id: string) {
    await this.init();
    return (await this.db.prepare('DELETE FROM templates WHERE user_id = ? AND id = ? RETURNING id').bind(userId, id).first()) !== null;
  }
}
