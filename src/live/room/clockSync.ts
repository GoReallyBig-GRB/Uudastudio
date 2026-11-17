/**
 * Shared clock for the room. The server's time is the reference: each device asks "what time is it?" a few times, and the answer that
 * came back fastest is the most trustworthy (the reply spent the least time in transit, so the error is smallest).
 */
export interface SyncSample { sentAt: number; receivedAt: number; serverAt: number }

/** How far ahead of this device's clock the server is, in ms, plus how sure we are (half the round trip) */
export function estimateOffset(samples: SyncSample[]): { offsetMs: number; errorMs: number } | null {
  const good = samples.filter((s) => s.receivedAt >= s.sentAt);
  if (good.length === 0) return null;
  const best = good.reduce((a, b) => (b.receivedAt - b.sentAt < a.receivedAt - a.sentAt ? b : a));
  const rtt = best.receivedAt - best.sentAt;
  return { offsetMs: best.serverAt - (best.sentAt + rtt / 2), errorMs: rtt / 2 };
}

/** Keeps the latest samples and converts between this device's clock and the room's */
export class RoomClock {
  private samples: SyncSample[] = [];
  private offset = 0;
  private error = Infinity;
  constructor(private readonly keep = 10) {}
  add(s: SyncSample): void {
    this.samples = [...this.samples, s].slice(-this.keep);
    const e = estimateOffset(this.samples);
    if (e) { this.offset = e.offsetMs; this.error = e.errorMs; }
  }
  /** Room time now, given this device's current time */
  roomNow(localNow = Date.now()): number { return localNow + this.offset; }
  /** This device's time for a room time (for scheduling "start at") */
  toLocal(roomTime: number): number { return roomTime - this.offset; }
  get errorMs(): number { return this.error; }
  get ready(): boolean { return Number.isFinite(this.error); }
}
