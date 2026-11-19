import { GEAR_IDS, GOAL_IDS, type Answers, type Gear, type Goal } from './setupPlan';

/** A studio sheet link carries only the answers (a few characters), never audio or account details, and lives in the part of the address that is never sent to a server */
export const SHEET_PREFIX = '#/sheet?';
export interface SheetRequest extends Answers { name: string }

export const sheetLink = (origin: string, a: Answers, name: string): string => {
  const q = new URLSearchParams({ g: a.goal, e: a.gear, a: a.hostOnAirViaMixer ? '1' : '0', n: name.trim().slice(0, 40) });
  return `${origin.replace(/#.*$/, '').replace(/\/$/, '')}/${SHEET_PREFIX}${q.toString()}`;
};

export const isSheetHash = (hash: string): boolean => hash.startsWith(SHEET_PREFIX);

/** Reads a sheet link back; anything that is not a known answer makes the whole link invalid */
export function parseSheetHash(hash: string): SheetRequest | null {
  if (!isSheetHash(hash)) return null;
  const q = new URLSearchParams(hash.slice(SHEET_PREFIX.length));
  const goal = q.get('g'), gear = q.get('e'), a = q.get('a');
  if (!GOAL_IDS.includes(goal as Goal) || !GEAR_IDS.includes(gear as Gear) || (a !== '0' && a !== '1')) return null;
  return { goal: goal as Goal, gear: gear as Gear, hostOnAirViaMixer: a === '1', name: (q.get('n') ?? '').trim().slice(0, 40) };
}
