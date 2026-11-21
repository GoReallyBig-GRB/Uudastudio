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
  /** Where a new file of `size` bytes goes, or a refusal. Present only when overflow storage is set up. */
  place?(size: number): Promise<Placement> | Placement;
  /** This job's current bytes in the overflow bucket */
  reportB2?(bytes: number): Promise<void> | void;
}

export type Placement = { where: 'do' | 'b2' } | { refusal: string };

/** jobId -> current audio bytes. The total is the sum of the map. */
export interface RegistryStore {
  set(id: string, bytes: number): void;
  total(): number;
  jobs(): number;
  /** Where new files go right now; 'do' until the high-water mark, then 'b2' until usage falls below the low-water mark */
  mode(): 'do' | 'b2';
  setMode(m: 'do' | 'b2'): void;
}

export class MemoryRegistryStore implements RegistryStore {
  private m = new Map<string, number>();
  private md: 'do' | 'b2' = 'do';
  mode() { return this.md; }
  setMode(m: 'do' | 'b2') { this.md = m; }
  set(id: string, bytes: number) { if (bytes > 0) this.m.set(id, Math.floor(bytes)); else this.m.delete(id); }
  total() { let n = 0; for (const v of this.m.values()) n += v; return n; }
  jobs() { return this.m.size; }
}

/** The shape of Cloudflare's `ctx.storage.sql` that this needs */
type Sql = { exec(q: string, ...b: unknown[]): { toArray(): Record<string, unknown>[] } };

export class SqlRegistryStore implements RegistryStore {
  /** `table` must be a fixed name from this code, never user input */
  constructor(private sql: Sql, private table = 'usage') {
    sql.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, bytes INTEGER NOT NULL)`);
    sql.exec('CREATE TABLE IF NOT EXISTS registry_meta (k TEXT PRIMARY KEY, v TEXT)');
  }
  set(id: string, bytes: number) {
    if (bytes > 0) this.sql.exec(`INSERT OR REPLACE INTO ${this.table} (id, bytes) VALUES (?, ?)`, id, Math.floor(bytes));
    else this.sql.exec(`DELETE FROM ${this.table} WHERE id = ?`, id);
  }
  total() { return Number(this.sql.exec(`SELECT COALESCE(SUM(bytes), 0) AS n FROM ${this.table}`).toArray()[0].n); }
  jobs() { return Number(this.sql.exec(`SELECT COUNT(*) AS n FROM ${this.table}`).toArray()[0].n); }
  mode(): 'do' | 'b2' { return this.sql.exec("SELECT v FROM registry_meta WHERE k = 'mode'").toArray()[0]?.v === 'b2' ? 'b2' : 'do'; }
  setMode(m: 'do' | 'b2') { this.sql.exec("INSERT OR REPLACE INTO registry_meta (k, v) VALUES ('mode', ?)", m); }
}

export interface StorageStatus {
  totalBytes: number; limitBytes: number; jobs: number; mode: 'open' | 'full';
  /** Present only when overflow storage is set up */
  overflow?: { enabled: true; routing: 'do' | 'b2'; lowWaterBytes: number; b2Bytes: number; b2LimitBytes: number; b2Jobs: number };
}

/** The overflow bucket's free tier is 10 GB; stop well before it */
export const DEFAULT_B2_LIMIT = 9 * 1024 ** 3;
/** Return to the job database when its usage falls below this: 65% of the 5 GB cap, so routing does not flap around the high-water mark */
export const DEFAULT_LOW_WATER = Math.floor(3.25 * 1024 ** 3);

export interface OverflowOptions { b2: RegistryStore; b2Limit?: number; lowWater?: number }

/** The registry's rules, independent of where it runs */
export class Registry {
  private b2Limit: number;
  private lowWater: number;
  constructor(private store: RegistryStore, readonly limit: number, private overflow?: OverflowOptions) {
    this.b2Limit = overflow?.b2Limit ?? DEFAULT_B2_LIMIT;
    // The low-water mark must sit below the high-water mark or routing would flap
    this.lowWater = Math.min(overflow?.lowWater ?? DEFAULT_LOW_WATER, Math.floor(limit * 0.8125));
  }
  set(id: string, bytes: number) { this.store.set(id, bytes); }
  setB2(id: string, bytes: number) { this.overflow?.b2.set(id, bytes); }
  check(size: number): string | null { return refusalFor(this.store.total(), size, this.limit); }
  /** Decides where one new file goes. Without overflow storage this is the plain limit check. */
  place(size: number): Placement {
    const o = this.overflow;
    if (!o) { const r = this.check(size); return r ? { refusal: r } : { where: 'do' }; }
    const total = this.store.total();
    let mode = this.store.mode();
    if (mode === 'do' && total + size > this.limit) mode = 'b2';
    else if (mode === 'b2' && total + size <= this.lowWater) mode = 'do';
    if (mode !== this.store.mode()) this.store.setMode(mode);
    if (mode === 'do') return { where: 'do' };
    return o.b2.total() + size > this.b2Limit ? { refusal: STORAGE_FULL_MESSAGE } : { where: 'b2' };
  }
  status(): StorageStatus {
    const totalBytes = this.store.total();
    const base: StorageStatus = { totalBytes, limitBytes: this.limit, jobs: this.store.jobs(), mode: totalBytes >= this.limit ? 'full' : 'open' };
    const o = this.overflow;
    if (!o) return base;
    const b2Bytes = o.b2.total();
    // Full only when neither store can take more
    return { ...base, mode: totalBytes >= this.limit && b2Bytes >= this.b2Limit ? 'full' : 'open', overflow: { enabled: true, routing: this.store.mode(), lowWaterBytes: this.lowWater, b2Bytes, b2LimitBytes: this.b2Limit, b2Jobs: o.b2.jobs() } };
  }
}

/** A guard backed directly by a Registry in the same process (tests, Express) */
export const localGuard = (reg: Registry, jobId: string, opts: { maxTakeBytes?: number; maxTakeSeconds?: number } = {}): StorageGuard => ({
  ...opts,
  check: (size) => reg.check(size),
  report: (bytes) => reg.set(jobId, bytes),
  place: (size) => reg.place(size),
  reportB2: (bytes) => reg.setB2(jobId, bytes),
});
