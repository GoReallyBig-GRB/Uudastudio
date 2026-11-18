/**
 * What the free plan allows for live sessions. Every number lives here so a paid plan can raise them later.
 * Sized so that many free users stay inside Cloudflare's free limits (see claude/live-room-and-recording-plan-2026-11-17.md).
 */
import type { LiveEventRow } from './rules';

export const FREE_PLAN = {
  /** People in the call at once, the host included */
  maxPeople: 4,
  /** One live session, in minutes. The host is warned beforehand and gets a short grace to finish the take. */
  sessionMinutes: 180,
  warnBeforeMin: 15,
  graceMin: 10,
  /** Live sessions that can be started in any rolling 7 days */
  sessionsPerWeek: 5,
  /** A session shorter than this does not use up a place (a mistaken click on Go live) */
  countedAfterMin: 5,
  /** Events waiting to happen (not yet ended) one person can hold */
  upcomingEvents: 20,
} as const;

const MIN = 60_000;
const WEEK = 7 * 24 * 3600_000;

/** When a session began: the moment the host opened it, or the due time of a scheduled one that has come */
export const sessionStart = (e: Pick<LiveEventRow, 'activatedAt' | 'startsAt' | 'endedAt'>, now: number): number | null => {
  if (e.activatedAt) return e.activatedAt;
  if (e.startsAt !== null && now >= e.startsAt) return e.startsAt;
  return null;
};

/** Sessions that count against the week: started within it, and still running or at least `countedAfterMin` long */
export function weeklyUse(events: LiveEventRow[], now: number, excludeId?: string): { used: number; resetsAt: number | null } {
  const counted: number[] = [];
  for (const e of events) {
    if (e.id === excludeId) continue;
    const start = sessionStart(e, now);
    if (start === null || start <= now - WEEK || start > now) continue;
    const end = e.endedAt ?? now;
    if (e.endedAt !== null && end - start < FREE_PLAN.countedAfterMin * MIN) continue;
    counted.push(start);
  }
  counted.sort((a, b) => a - b);
  return { used: counted.length, resetsAt: counted.length >= FREE_PLAN.sessionsPerWeek ? counted[counted.length - FREE_PLAN.sessionsPerWeek] + WEEK : null };
}

export interface Quota { used: number; limit: number; left: number; resetsAt: number | null; sessionMinutes: number; maxPeople: number }
export function quotaFor(events: LiveEventRow[], now: number, excludeId?: string): Quota {
  const { used, resetsAt } = weeklyUse(events, now, excludeId);
  return { used, limit: FREE_PLAN.sessionsPerWeek, left: Math.max(0, FREE_PLAN.sessionsPerWeek - used), resetsAt, sessionMinutes: FREE_PLAN.sessionMinutes, maxPeople: FREE_PLAN.maxPeople };
}

export const upcomingCount = (events: LiveEventRow[], now: number): number => events.filter((e) => e.endedAt === null && !(e.startsAt !== null && !e.activatedAt && now >= e.startsAt + 12 * 3600_000)).length;

/** The three moments of a session's clock */
export function limitSchedule(openedAt: number, sessionMinutes: number = FREE_PLAN.sessionMinutes) {
  const limitAt = openedAt + sessionMinutes * MIN;
  return { warnAt: limitAt - FREE_PLAN.warnBeforeMin * MIN, limitAt, hardAt: limitAt + FREE_PLAN.graceMin * MIN };
}

export const resetText = (resetsAt: number | null): string => (resetsAt === null ? '' : ` The next place frees up on ${new Date(resetsAt).toUTCString().slice(0, 22)} UTC.`);
