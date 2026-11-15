/**
 * A small per-isolate limiter for sign-in attempts. It uses memory, not D1, so it costs no database writes.
 * Each Worker instance counts for itself, which is enough to stop a script hammering one address.
 */
export interface Limiter { take(key: string): number }

/** Returns a function that gives 0 when the attempt is allowed, or the seconds to wait when it is not */
export const makeLimiter = (max: number, windowMs: number, now: () => number = Date.now): Limiter => {
  const hits = new Map<string, number[]>();
  return {
    take(key: string) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      if (recent.length >= max) { hits.set(key, recent); return Math.max(1, Math.ceil((recent[0] + windowMs - t) / 1000)); }
      recent.push(t); hits.set(key, recent);
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k); // keep memory bounded
      return 0;
    },
  };
};
