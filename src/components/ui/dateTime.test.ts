import { describe, expect, it } from 'vitest';
import { hour12, monthGrid, onDay, sameDay, withTime } from './dateTime';

describe('date and time picker arithmetic', () => {
  it('lays a month on 42 cells starting on Monday', () => {
    const g = monthGrid(2026, 10); // November 2026 starts on a Sunday
    expect(g).toHaveLength(42);
    expect(g[0].date.getDay()).toBe(1);
    expect(g.filter((c) => c.inMonth)).toHaveLength(30);
    expect(g[6].date.getDate()).toBe(1);
  });
  it('can start the week on Sunday', () => {
    expect(monthGrid(2026, 10, 0)[0].date.getDate()).toBe(1);
  });
  it('moves a moment to another day without changing the time', () => {
    const at = new Date(2026, 10, 16, 14, 30).getTime();
    const moved = new Date(onDay(at, new Date(2026, 11, 5)));
    expect([moved.getMonth(), moved.getDate(), moved.getHours(), moved.getMinutes()]).toEqual([11, 5, 14, 30]);
  });
  it('reads and sets 12-hour time including noon and midnight', () => {
    const base = new Date(2026, 10, 16, 0, 0).getTime();
    expect(hour12(withTime(base, 12, 0, false))).toEqual({ h: 12, pm: false });
    expect(new Date(withTime(base, 12, 0, false)).getHours()).toBe(0);
    expect(new Date(withTime(base, 12, 0, true)).getHours()).toBe(12);
    expect(new Date(withTime(base, 2, 45, true)).getHours()).toBe(14);
    expect(sameDay(new Date(base), new Date(withTime(base, 11, 59, true)))).toBe(true);
  });
});
