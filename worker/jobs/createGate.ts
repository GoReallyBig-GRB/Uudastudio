/**
 * Limits how many jobs can be created per day, per network address and in total. Host-neutral.
 * It lives in the account-wide registry object, so the count is shared by every Worker instance and survives restarts.
 * Addresses are stored only as a salted-day SHA-256 digest, never as the address itself.
 */
export const DEFAULT_JOBS_PER_ADDRESS_PER_DAY = 100;
export const DEFAULT_JOBS_PER_DAY = 500;
export const CREATE_LIMIT_MESSAGE = 'Too many jobs were started from your network today. Try again tomorrow, or ask the studio for access.';

export interface GateStore {
  /** Adds one to the count for (day, key) and returns the new count */
  bump(day: string, key: string): number;
  /** Count without adding */
  peek(day: string, key: string): number;
  /** Forgets every day before `day` */
  prune(day: string): void;
}

export class MemoryGateStore implements GateStore {
  private m = new Map<string, number>();
  bump(day: string, key: string) { const k = `${day}|${key}`; const n = (this.m.get(k) ?? 0) + 1; this.m.set(k, n); return n; }
  peek(day: string, key: string) { return this.m.get(`${day}|${key}`) ?? 0; }
  prune(day: string) { for (const k of [...this.m.keys()]) if (k.split('|')[0] < day) this.m.delete(k); }
}

type Sql = { exec(q: string, ...b: unknown[]): { toArray(): Record<string, unknown>[] } };
export class SqlGateStore implements GateStore {
  constructor(private sql: Sql) { sql.exec('CREATE TABLE IF NOT EXISTS creations (day TEXT NOT NULL, k TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, k))'); }
  bump(day: string, key: string) {
    this.sql.exec('INSERT INTO creations (day, k, n) VALUES (?, ?, 1) ON CONFLICT (day, k) DO UPDATE SET n = n + 1', day, key);
    return this.peek(day, key);
  }
  peek(day: string, key: string) { return Number(this.sql.exec('SELECT n FROM creations WHERE day = ? AND k = ?', day, key).toArray()[0]?.n ?? 0); }
  prune(day: string) { this.sql.exec('DELETE FROM creations WHERE day < ?', day); }
}

const digest = async (s: string): Promise<string> => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');

export type GateResult = { ok: true } | { ok: false; refusal: string; retryAfterSeconds: number };

export class CreateGate {
  constructor(private store: GateStore, private perAddress = DEFAULT_JOBS_PER_ADDRESS_PER_DAY, private perDay = DEFAULT_JOBS_PER_DAY, private now: () => number = Date.now) {}

  /** Call once per job-creation attempt. Counts the attempt when it is allowed. */
  async take(address: string): Promise<GateResult> {
    const t = this.now();
    const day = new Date(t).toISOString().slice(0, 10);
    const wait = Math.max(1, Math.ceil((Date.parse(day) + 24 * 3600_000 - t) / 1000));
    this.store.prune(day);
    const key = 'a:' + (await digest(`${day}|${address || 'unknown'}`));
    // Check both before counting either, so a refused attempt does not use up anyone's allowance
    if (this.store.peek(day, key) >= this.perAddress || this.store.peek(day, '*') >= this.perDay) return { ok: false, refusal: CREATE_LIMIT_MESSAGE, retryAfterSeconds: wait };
    this.store.bump(day, key);
    this.store.bump(day, '*');
    return { ok: true };
  }
}
