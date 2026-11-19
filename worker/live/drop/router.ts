import { chooseBacking, type Backing, type Route } from './plan';

type Sql = { exec(q: string, ...b: unknown[]): { toArray(): Record<string, unknown>[] } };

/**
 * Lives inside the account-wide registry object. Remembers which store new files are going to (so the 80% / 65% gap holds between calls)
 * and how much B2 holds. The Durable Object total is passed in: it is the registry's own count of everything in Durable Object storage.
 */
export class DropRouter {
  constructor(private readonly sql: Sql, private readonly doTotal: () => number) {
    sql.exec('CREATE TABLE IF NOT EXISTS b2usage (id TEXT PRIMARY KEY, bytes INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  }
  private mode(): Backing { const r = this.sql.exec("SELECT v FROM kv WHERE k = 'dropMode'").toArray()[0]; return r?.v === 'b2' ? 'b2' : 'do'; }
  b2Total(): number { return Number(this.sql.exec('SELECT COALESCE(SUM(bytes), 0) AS n FROM b2usage').toArray()[0].n); }
  setB2(id: string, bytes: number): void {
    if (bytes > 0) this.sql.exec('INSERT OR REPLACE INTO b2usage (id, bytes) VALUES (?, ?)', id, Math.floor(bytes));
    else this.sql.exec('DELETE FROM b2usage WHERE id = ?', id);
  }
  route(size: number, b2Configured: boolean): Route & { doTotal: number; b2Total: number } {
    const doTotal = this.doTotal(), b2Total = this.b2Total();
    const r = chooseBacking({ prev: this.mode(), size, doTotal, b2Configured, b2Total });
    this.sql.exec("INSERT OR REPLACE INTO kv (k, v) VALUES ('dropMode', ?)", r.mode);
    return { ...r, doTotal, b2Total };
  }
}
