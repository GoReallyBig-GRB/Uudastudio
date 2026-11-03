import type { Clip, Project } from '../types';

/** A clip is locked when it is locked itself (solo clip) or its group is locked. */
export function isClipLocked(project: Pick<Project, 'groupSettings'>, clip: Clip): boolean {
  if (clip.groupId) return !!project.groupSettings?.[clip.groupId]?.locked;
  return !!clip.locked;
}

const SAME_FIELDS: (keyof Clip)[] = [
  'trackId', 'assetId', 'startSeconds', 'offsetSeconds', 'durationSeconds', 'gain',
  'fadeInSeconds', 'fadeOutSeconds', 'fadeShape', 'groupId', 'spliceId', 'effects',
];

/**
 * Compares two project states and returns the number of locked clips that the change would move, edit or delete
 * (0 = allowed). Mute and the group fader stay free: locking protects the edit, not the mix.
 */
export function lockViolation(prev: Project, next: Project): number {
  const after = new Map<string, Clip>();
  for (const t of next.tracks) for (const c of t.clips) after.set(c.id, c);
  let hits = 0;
  for (const t of prev.tracks) {
    for (const c of t.clips) {
      if (!isClipLocked(prev, c)) continue;
      const n = after.get(c.id);
      if (!n) { hits++; continue; }
      if (SAME_FIELDS.some((k) => !sameValue(c[k], n[k]))) hits++;
    }
  }
  return hits;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'object' && typeof b === 'object' && a && b) return JSON.stringify(a) === JSON.stringify(b);
  return false;
}
