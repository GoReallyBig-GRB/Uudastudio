import { describe, expect, it } from 'vitest';
import { FREE_PLAN, limitSchedule, quotaFor, sessionStart, upcomingCount, weeklyUse } from './plan';
import type { LiveEventRow } from './rules';

const NOW = 1_800_000_000_000, H = 3600_000, D = 24 * H;
const ev = (id: string, o: Partial<LiveEventRow> = {}): LiveEventRow => ({ id, userId: 'u', token: id, kind: 'quick', mode: 'conversation', title: id, description: '', notes: '', startsAt: null, durationMin: null, activatedAt: null, endedAt: null, participants: [], hostName: 'h', createdAt: 0, updatedAt: 0, ...o });
const ran = (id: string, daysAgo: number, mins = 60) => ev(id, { activatedAt: NOW - daysAgo * D, endedAt: NOW - daysAgo * D + mins * 60_000 });

describe('weekly sessions', () => {
  it('counts sessions started in the last 7 days and ignores older ones', () => {
    expect(weeklyUse([ran('a', 1), ran('b', 6.5), ran('c', 8)], NOW).used).toBe(2);
  });
  it('does not count a session under 5 minutes, but counts one still running', () => {
    expect(weeklyUse([ran('short', 1, 3), ran('ok', 1, 5), ev('now', { activatedAt: NOW - 60_000 })], NOW).used).toBe(2);
  });
  it('counts a scheduled event once its time has come, and not before', () => {
    expect(sessionStart(ev('s', { kind: 'scheduled', startsAt: NOW - H }), NOW)).toBe(NOW - H);
    expect(sessionStart(ev('s', { kind: 'scheduled', startsAt: NOW + H }), NOW)).toBeNull();
  });
  it('says when the next place frees up once the week is full', () => {
    const five = [1, 2, 3, 4, 5].map((d) => ran(`e${d}`, d));
    const q = quotaFor(five, NOW);
    expect(q).toMatchObject({ used: 5, limit: 5, left: 0, sessionMinutes: 180, maxPeople: 4 });
    expect(q.resetsAt).toBe(NOW - 5 * D + 7 * D); // the oldest of the five drops out after its 7 days
    expect(quotaFor(five.slice(0, 4), NOW).resetsAt).toBeNull();
  });
  it('leaves the event being checked out of its own count', () => {
    const five = [1, 2, 3, 4, 5].map((d) => ran(`e${d}`, d));
    expect(quotaFor(five, NOW, 'e3').left).toBe(1);
  });
});

describe('upcoming events and the session clock', () => {
  it('counts events that have not ended', () => {
    expect(upcomingCount([ev('a'), ev('b', { endedAt: NOW - 1 }), ev('c', { kind: 'scheduled', startsAt: NOW + D })], NOW)).toBe(2);
    expect(FREE_PLAN.upcomingEvents).toBe(20);
  });
  it('warns 15 minutes before 3 hours and ends 10 minutes after', () => {
    expect(limitSchedule(1000)).toEqual({ warnAt: 1000 + 165 * 60_000, limitAt: 1000 + 180 * 60_000, hardAt: 1000 + 190 * 60_000 });
  });
});
