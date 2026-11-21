/**
 * Keeps the monthly relay allowance (Cloudflare gives 1,000 GB free) from ever being crossed. Relay traffic does not pass through
 * our servers, so it cannot be measured here; instead every set of relay credentials we hand out reserves its worst case, and the
 * Worker stops handing them out before the allowance is used. Without relay, calls still connect directly for most networks.
 */
import type { D1Full } from '../templates/store';

export const RELAY = {
  monthlyMb: 1_000_000,
  /** Above this share, only rooms that already hold relay credentials get more (so a session in progress is not cut off) */
  softPct: 0.8,
  /** Above this share, nobody gets relay credentials until next month */
  hardPct: 0.95,
  /** Worst case for one person: 3 other people, every stream relayed at 48 kbps, for the 3-hour session (about 194 MB) */
  reserveMb: 200,
  /** One event can reserve at most this much a month: every seat twice over, so people can rejoin, but a loop of requests cannot drain the allowance */
  roomCapMb: 200 * 4 * 2,
} as const;

export type RelayDecision = 'allow' | 'room-only-ok' | 'deny';
export function relayDecision(reservedMb: number, roomHasRelay: boolean): RelayDecision {
  if (reservedMb >= RELAY.monthlyMb * RELAY.hardPct) return 'deny';
  if (reservedMb >= RELAY.monthlyMb * RELAY.softPct) return roomHasRelay ? 'room-only-ok' : 'deny';
  return 'allow';
}

export const monthKey = (now: number): string => new Date(now).toISOString().slice(0, 7);

export interface RelayLedger {
  reserved(month: string): Promise<number>;
  roomHasRelay(month: string, eventId: string): Promise<boolean>;
  roomReserved(month: string, eventId: string): Promise<number>;
  reserve(month: string, eventId: string, mb: number): Promise<void>;
}

export class MemoryRelayLedger implements RelayLedger {
  total = new Map<string, number>(); rooms = new Set<string>();
  async reserved(m: string) { return this.total.get(m) ?? 0; }
  async roomHasRelay(m: string, id: string) { return this.rooms.has(`${m}/${id}`); }
  perRoom = new Map<string, number>();
  async roomReserved(m: string, id: string) { return this.perRoom.get(`${m}/${id}`) ?? 0; }
  async reserve(m: string, id: string, mb: number) { this.total.set(m, (this.total.get(m) ?? 0) + mb); this.rooms.add(`${m}/${id}`); this.perRoom.set(`${m}/${id}`, (this.perRoom.get(`${m}/${id}`) ?? 0) + mb); }
}

export class D1RelayLedger implements RelayLedger {
  private ready: Promise<unknown> | null = null;
  constructor(private db: D1Full) {}
  private init() { return (this.ready ??= this.db.exec('CREATE TABLE IF NOT EXISTS live_relay (month TEXT NOT NULL, scope TEXT NOT NULL, mb INTEGER NOT NULL, PRIMARY KEY (month, scope))').catch((e) => { this.ready = null; throw e; })); }
  async reserved(m: string) { await this.init(); const r = await this.db.prepare("SELECT mb FROM live_relay WHERE month = ? AND scope = 'total'").bind(m).first<{ mb: number }>(); return Number(r?.mb ?? 0); }
  async roomHasRelay(m: string, id: string) { await this.init(); return (await this.db.prepare('SELECT 1 AS x FROM live_relay WHERE month = ? AND scope = ?').bind(m, `room:${id}`).first()) !== null; }
  async roomReserved(m: string, id: string) { await this.init(); const r = await this.db.prepare('SELECT mb FROM live_relay WHERE month = ? AND scope = ?').bind(m, `room:${id}`).first<{ mb: number }>(); return Number(r?.mb ?? 0); }
  async reserve(m: string, id: string, mb: number) {
    await this.init();
    const up = 'INSERT INTO live_relay (month, scope, mb) VALUES (?, ?, ?) ON CONFLICT (month, scope) DO UPDATE SET mb = mb + excluded.mb';
    await this.db.prepare(up).bind(m, 'total', mb).run();
    await this.db.prepare(up).bind(m, `room:${id}`, mb).run();
  }
}
