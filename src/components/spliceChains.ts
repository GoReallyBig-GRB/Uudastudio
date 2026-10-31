/**
 * Spliced clips: pieces of one clip that were edited in place (a part deleted, silenced or lowered) and still touch end
 * to end. They share a `spliceId`, and while they touch they behave as ONE clip, so editing a long track never leaves it
 * in dozens of separate clips. An explicit Split ends the join. The audio is never copied; every piece points at the
 * same source, so this works the same for short clips and for long audio kept on disk.
 *
 * Pure and framework-free so the rules can be unit-tested without a browser.
 */
import type { Clip, Track } from '../types';

/** Two pieces touch when one ends within this many seconds of where the next begins. */
export const SEAM_EPS = 1e-5;

export interface Seams {
  /** Another piece of the same clip touches this piece's start */
  left: boolean;
  /** Another piece of the same clip touches this piece's end */
  right: boolean;
}

const byStart = (a: Clip, b: Clip) => a.startSeconds - b.startSeconds;

/** Chains on one track: arrays of touching pieces, in time order (a lone piece is not a chain). */
export const chainsOnTrack = (clips: readonly Clip[]): Clip[][] => {
  const byId = new Map<string, Clip[]>();
  for (const c of clips) {
    if (!c.spliceId) continue;
    const list = byId.get(c.spliceId);
    if (list) list.push(c); else byId.set(c.spliceId, [c]);
  }
  const chains: Clip[][] = [];
  for (const list of byId.values()) {
    if (list.length < 2) continue;
    list.sort(byStart);
    let current: Clip[] = [list[0]];
    for (let i = 1; i < list.length; i++) {
      const prev = current[current.length - 1];
      if (Math.abs(prev.startSeconds + prev.durationSeconds - list[i].startSeconds) <= SEAM_EPS) {
        current.push(list[i]);
      } else {
        if (current.length > 1) chains.push(current);
        current = [list[i]];
      }
    }
    if (current.length > 1) chains.push(current);
  }
  return chains;
};

/** For every piece that touches a neighbour of its own clip, which side(s) touch. Pieces with no join are absent. */
export const seamFlags = (clips: readonly Clip[]): Map<string, Seams> => {
  const out = new Map<string, Seams>();
  for (const chain of chainsOnTrack(clips)) {
    chain.forEach((c, i) => out.set(c.id, { left: i > 0, right: i < chain.length - 1 }));
  }
  return out;
};

/** Every piece that moves with `clipId` (itself included): its whole chain, or just itself. */
export const chainIds = (tracks: readonly Track[], clipId: string): string[] => {
  for (const t of tracks) {
    if (!t.clips.some((c) => c.id === clipId)) continue;
    for (const chain of chainsOnTrack(t.clips)) {
      if (chain.some((c) => c.id === clipId)) return chain.map((c) => c.id);
    }
    return [clipId];
  }
  return [clipId];
};

/** The set with every selected piece's chain added, so touching pieces are always picked as one clip. */
export const expandChains = (tracks: readonly Track[], ids: ReadonlySet<string>): Set<string> => {
  if (ids.size === 0) return new Set(ids);
  const out = new Set(ids);
  for (const t of tracks) {
    if (!t.clips.some((c) => c.spliceId && ids.has(c.id))) continue;
    for (const chain of chainsOnTrack(t.clips)) {
      if (chain.some((c) => ids.has(c.id))) chain.forEach((c) => out.add(c.id));
    }
  }
  return out;
};

/** How many clips the user sees in a selection: a whole chain counts once. */
export const selectionUnitCount = (tracks: readonly Track[], ids: ReadonlySet<string>): number => {
  if (ids.size === 0) return 0;
  const counted = new Set<string>();
  let units = 0;
  for (const t of tracks) {
    const chains = chainsOnTrack(t.clips);
    for (const c of t.clips) {
      if (!ids.has(c.id) || counted.has(c.id)) continue;
      const chain = chains.find((ch) => ch.some((p) => p.id === c.id));
      if (chain) chain.forEach((p) => counted.add(p.id)); else counted.add(c.id);
      units += 1;
    }
  }
  return units;
};

/** The first piece of the chain a clip belongs to (the clip itself when it has no join). */
export const chainHead = (tracks: readonly Track[], clipId: string): Clip | null => {
  const ids = chainIds(tracks, clipId);
  let head: Clip | null = null;
  for (const t of tracks) for (const c of t.clips) if (ids.includes(c.id) && (!head || c.startSeconds < head.startSeconds)) head = c;
  return head;
};

const SHARED_KEYS = new Set<keyof Clip>(['gain', 'muted', 'fadeShape']);

/**
 * A property change made to one piece, spread over the clip it belongs to: level, mute and curve go to every piece, a
 * fade-in to the first piece and a fade-out to the last. Anything else (new audio, offsets, names from processing) stays
 * with the one piece it was meant for. Returns a map of piece id to the update it should get.
 */
export const spreadUpdate = (tracks: readonly Track[], clipId: string, updates: Partial<Clip>): Map<string, Partial<Clip>> => {
  const result = new Map<string, Partial<Clip>>();
  const keys = Object.keys(updates) as Array<keyof Clip>;
  const ids = chainIds(tracks, clipId);
  const flat = tracks.flatMap((t) => t.clips).filter((c) => ids.includes(c.id)).sort(byStart);
  if (flat.length < 2 || !keys.every((k) => SHARED_KEYS.has(k) || k === 'fadeInSeconds' || k === 'fadeOutSeconds')) {
    result.set(clipId, updates);
    return result;
  }
  const first = flat[0].id;
  const last = flat[flat.length - 1].id;
  for (const c of flat) {
    const u: Partial<Clip> = {};
    for (const k of keys) {
      if (SHARED_KEYS.has(k)) (u as Record<string, unknown>)[k] = updates[k];
      else if (k === 'fadeInSeconds' && c.id === first) u.fadeInSeconds = updates.fadeInSeconds;
      else if (k === 'fadeOutSeconds' && c.id === last) u.fadeOutSeconds = updates.fadeOutSeconds;
    }
    if (Object.keys(u).length > 0) result.set(c.id, u);
  }
  return result;
};

/**
 * Split a chain at a time inside it: pieces from the split onward stop belonging to the first part (they get `newId`), so the
 * two halves are separate clips from then on. Pieces before the time keep their id. Returns the changed pieces only.
 */
export const breakChainAt = (clips: readonly Clip[], clipId: string, seconds: number, newId: string): Map<string, Partial<Clip>> => {
  const out = new Map<string, Partial<Clip>>();
  const target = clips.find((c) => c.id === clipId);
  if (!target || !target.spliceId) return out;
  for (const chain of chainsOnTrack(clips)) {
    if (!chain.some((c) => c.id === clipId)) continue;
    for (const c of chain) if (c.startSeconds >= seconds - SEAM_EPS && c.id !== clipId) out.set(c.id, { spliceId: newId });
  }
  return out;
};

/** Give pasted or duplicated pieces their own join ids, so a copy never merges with the original it came from. */
export const remapSpliceIds = (clips: readonly Clip[], makeId: () => string): Clip[] => {
  const map = new Map<string, string>();
  return clips.map((c) => {
    if (!c.spliceId) return c;
    let id = map.get(c.spliceId);
    if (!id) { id = makeId(); map.set(c.spliceId, id); }
    return { ...c, spliceId: id };
  });
};
