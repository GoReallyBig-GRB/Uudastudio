/**
 * Where a guest's full-quality recording is held when it cannot go straight to the host, and for how long.
 * Rules agreed with the owner (deployment plan 5.4a): Durable Object storage first; new uploads go to B2 once the Durable Object holds 80% of its
 * 5 GB account cap, and come back when it is under 65% (the gap stops routing flipping at one number). Files are deleted 24 hours after the host has them.
 * Host-neutral: no Cloudflare imports, so it is tested directly.
 */

export const DO_CAP_BYTES = 5 * 1024 ** 3;
export const HIGH_WATER = 0.8;
export const LOW_WATER = 0.65;
/** Backblaze's free allowance is 10 GB; stay clear of it */
export const B2_CAP_BYTES = 9 * 1024 ** 3;
/** Beyond this a take is refused up front: 3 hours of stereo 24-bit at 48 kHz is about 3 GB, so this fits one mono hour-long guest with room to spare */
export const MAX_FILE_BYTES = 2 * 1024 ** 3;
export const PART_BYTES = 5 * 1024 * 1024;
export const KEEP_AFTER_COLLECTED_MS = 24 * 3600_000;
export const KEEP_IF_NOT_COLLECTED_MS = 7 * 24 * 3600_000;

export type Backing = 'do' | 'b2';

export const FULL_MESSAGE = 'The service has no room for more recordings right now. Your recording is safe on this device and the host has the session backup.';

/** Routing with a gap: switch to B2 at the high mark, return to the Durable Object only below the low mark */
export function nextBacking(prev: Backing, doTotal: number, cap = DO_CAP_BYTES, high = HIGH_WATER, low = LOW_WATER): Backing {
  if (prev === 'do') return doTotal >= cap * high ? 'b2' : 'do';
  return doTotal < cap * low ? 'do' : 'b2';
}

export interface RouteInput { prev: Backing; size: number; doTotal: number; b2Configured: boolean; b2Total: number; doCap?: number; b2Cap?: number }
export interface Route { backing: Backing | null; /** What the routing mode is now (remember it for next time) */ mode: Backing; refusal: string | null }

/** Chooses where one new file goes, or refuses */
export function chooseBacking(i: RouteInput): Route {
  const doCap = i.doCap ?? DO_CAP_BYTES, b2Cap = i.b2Cap ?? B2_CAP_BYTES;
  if (!Number.isFinite(i.size) || i.size <= 0 || i.size > MAX_FILE_BYTES) return { backing: null, mode: i.prev, refusal: 'This recording is too large to hold. Your recording is safe on this device.' };
  const mode = i.b2Configured ? nextBacking(i.prev, i.doTotal, doCap) : 'do';
  const doFits = i.doTotal + i.size <= doCap * HIGH_WATER;
  const doFitsLast = i.doTotal + i.size <= doCap * 0.95; // when there is nowhere else, the room above the mark is used
  const b2Fits = i.b2Configured && i.b2Total + i.size <= b2Cap;
  if (mode === 'do') {
    if (doFits || (!i.b2Configured && doFitsLast)) return { backing: 'do', mode, refusal: null };
    if (b2Fits) return { backing: 'b2', mode: 'b2', refusal: null };
    return doFitsLast ? { backing: 'do', mode, refusal: null } : { backing: null, mode, refusal: FULL_MESSAGE };
  }
  if (b2Fits) return { backing: 'b2', mode, refusal: null };
  return doFitsLast ? { backing: 'do', mode, refusal: null } : { backing: null, mode, refusal: FULL_MESSAGE };
}

/** When a stored take can be deleted */
export const expiresAt = (uploadedAt: number, collectedAt: number | null): number => (collectedAt !== null ? collectedAt + KEEP_AFTER_COLLECTED_MS : uploadedAt + KEEP_IF_NOT_COLLECTED_MS);

export const partsFor = (bytes: number, partBytes = PART_BYTES): number => Math.max(1, Math.ceil(bytes / partBytes));
