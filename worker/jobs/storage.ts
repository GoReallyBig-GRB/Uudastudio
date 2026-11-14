/**
 * Storage guard. Cloudflare's free Durable Object storage is 5 GB for the whole account, so the
 * job layer tracks how many audio bytes every job holds and refuses new uploads before the cap.
 * Host-neutral and free of Cloudflare imports so it can be tested and reused by the Express twin.
 */

/** 80% of the 5 GB account cap; the rest absorbs uploads in flight, metadata and counter lag */
export const DEFAULT_STORAGE_LIMIT = 4 * 1024 ** 3;
/** One take (about 30 minutes of mono 48 kHz 24-bit WAV is 259 MB) */
export const DEFAULT_MAX_TAKE_BYTES = 300 * 1024 ** 2;
/** Declared length of one take */
export const DEFAULT_MAX_TAKE_SECONDS = 2 * 3600;

export const STORAGE_FULL_MESSAGE = 'The service has no room for more audio right now. Your recording is safe on this device. Save the file and send it yourself, or try again later.';

/** Reads a positive number from a Worker variable; anything else gives the default */
export const parseSetting = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/** A refusal message when `size` more bytes would pass the limit, otherwise null */
export const refusalFor = (total: number, size: number, limit: number): string | null => (total + size > limit ? STORAGE_FULL_MESSAGE : null);

/** What a job's handler asks before it accepts audio, and tells afterwards */
export interface StorageGuard {
  maxTakeBytes?: number;
  maxTakeSeconds?: number;
  /** A refusal message if `size` more bytes do not fit, otherwise null */
  check(size: number): Promise<string | null> | string | null;
  /** This job's current audio bytes (a value, not an increment, so it cannot drift) */
  report(bytes: number): Promise<void> | void;
}

/** jobId -> current audio bytes. The total is the sum of the map. */
export interface RegistryStore {
  set(id: string, bytes: number): void;
  total(): number;
  jobs(): number;
}

export class MemoryRegistryStore implements RegistryStore {
  private m = new Map<string, number>();
  set(id: string, bytes: number) { if (bytes > 0) this.m.set(id, Math.floor(bytes)); else this.m.delete(id); }
  total() { let n = 0; for (const v of this.m.values()) n += v; return n; }
  jobs() { return this.m.size; }
}

/** The shape of Cloudflare's `ctx.storage.sql` that this needs */
type Sql = { exec(q: string, ...b: unknown[]): { toArray(): Record<string, unknown>[] } };

export class SqlRegistryStore implements RegistryStore {
  constructor(private sql: Sql) { sql.exec('CREATE TABLE IF NOT EXISTS usage (id TEXT PRIMARY KEY, bytes INTEGER NOT NULL)'); }
  set(id: string, bytes: number) {
    if (bytes > 0) this.sql.exec('INSERT OR REPLACE INTO usage (id, bytes) VALUES (?, ?)', id, Math.floor(bytes));
    else this.sql.exec('DELETE FROM usage WHERE id = ?', id);
  }
  total() { return Number(this.sql.exec('SELECT COALESCE(SUM(bytes), 0) AS n FROM usage').toArray()[0].n); }
  jobs() { return Number(this.sql.exec('SELECT COUNT(*) AS n FROM usage').toArray()[0].n); }
}

export interface StorageStatus { totalBytes: number; limitBytes: number; jobs: number; mode: 'open' | 'full' }

/** The registry's rules, independent of where it runs */
export class Registry {
  constructor(private store: RegistryStore, readonly limit: number) {}
  set(id: string, bytes: number) { this.store.set(id, bytes); }
  check(size: number): string | null { return refusalFor(this.store.total(), size, this.limit); }
  status(): StorageStatus {
    const totalBytes = this.store.total();
    return { totalBytes, limitBytes: this.limit, jobs: this.store.jobs(), mode: totalBytes >= this.limit ? 'full' : 'open' };
  }
}

/** A guard backed directly by a Registry in the same process (tests, Express) */
export const localGuard = (reg: Registry, jobId: string, opts: { maxTakeBytes?: number; maxTakeSeconds?: number } = {}): StorageGuard => ({
  ...opts,
  check: (size) => reg.check(size),
  report: (bytes) => reg.set(jobId, bytes),
});
