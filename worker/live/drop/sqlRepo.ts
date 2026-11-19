import type { DropRepo, DropTake } from './service';

type Sql = { exec(q: string, ...b: unknown[]): { toArray(): Record<string, unknown>[] } };

/** Takes held for one event, as small JSON rows in the Durable Object's SQLite (the audio itself is in drop_parts or B2) */
export class SqlDropRepo implements DropRepo {
  constructor(private readonly sql: Sql) { sql.exec('CREATE TABLE IF NOT EXISTS drop_takes (id TEXT PRIMARY KEY, json TEXT NOT NULL)'); }
  get(id: string): DropTake | null { const r = this.sql.exec('SELECT json FROM drop_takes WHERE id = ?', id).toArray()[0]; return r ? (JSON.parse(String(r.json)) as DropTake) : null; }
  put(t: DropTake): void { this.sql.exec('INSERT OR REPLACE INTO drop_takes (id, json) VALUES (?, ?)', t.takeId, JSON.stringify(t)); }
  remove(id: string): void { this.sql.exec('DELETE FROM drop_takes WHERE id = ?', id); }
  all(): DropTake[] { return this.sql.exec('SELECT json FROM drop_takes').toArray().map((r) => JSON.parse(String(r.json)) as DropTake); }
}
