/** Calendar arithmetic for the date and time picker. No screen, so it can be tested alone. */

export interface Cell { date: Date; inMonth: boolean }

/** 42 cells (6 weeks) for a month, starting on the chosen weekday (1 = Monday) */
export const monthGrid = (year: number, month: number, weekStart = 1): Cell[] => {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  return Array.from({ length: 42 }, (_, i) => { const d = new Date(year, month, 1 - lead + i); return { date: d, inMonth: d.getMonth() === month }; });
};

export const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** The same moment on another calendar day */
export const onDay = (ms: number, day: Date): number => { const d = new Date(ms); d.setFullYear(day.getFullYear(), day.getMonth(), day.getDate()); return d.getTime(); };

export const hour12 = (ms: number): { h: number; pm: boolean } => { const h = new Date(ms).getHours(); return { h: h % 12 === 0 ? 12 : h % 12, pm: h >= 12 }; };

export const withTime = (ms: number, h12: number, minute: number, pm: boolean): number => {
  const d = new Date(ms);
  d.setHours((h12 % 12) + (pm ? 12 : 0), minute, 0, 0);
  return d.getTime();
};

export const startOfDay = (ms: number): number => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
