/**
 * A token bucket: lets bursts through (call signalling sends a handful of messages at once) but not a flood.
 * Pure, with the clock passed in, so it is tested without timers.
 */
export class Bucket {
  private tokens: number;
  private last: number;
  /** Consecutive refusals; a well-behaved client never gets past a few */
  strikes = 0;
  constructor(private readonly capacity: number, private readonly perSecond: number, now: number) {
    this.tokens = capacity;
    this.last = now;
  }

  /** True when the message may go on, false when it should be dropped */
  take(now: number): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + Math.max(0, now - this.last) * this.perSecond / 1000);
    this.last = now;
    if (this.tokens >= 1) { this.tokens -= 1; this.strikes = 0; return true; }
    this.strikes++;
    return false;
  }
}

/** One bucket per connection, forgotten when it closes */
export class Buckets {
  private by = new Map<string, Bucket>();
  constructor(private readonly capacity = 120, private readonly perSecond = 40) {}
  take(id: string, now: number): { ok: boolean; strikes: number } {
    let b = this.by.get(id);
    if (!b) { b = new Bucket(this.capacity, this.perSecond, now); this.by.set(id, b); }
    return { ok: b.take(now), strikes: b.strikes };
  }
  forget(id: string): void { this.by.delete(id); }
}
