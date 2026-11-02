import type { Clip, Track } from '../types';
import { SEAM_EPS } from './spliceChains';

/** Pieces shorter than this are not worth making; a playhead this close to an edge counts as being on it. */
const EDGE_EPS = 1e-4;

/**
 * Opens a gap of `length` seconds at `at` on the given tracks, ready for audio to be inserted there: a clip that spans `at`
 * is split in two (the right half moves along with everything after it) and every clip that starts at or after `at` moves
 * later by `length`. Tracks not listed are untouched. Nothing is lost or overlapped.
 */
export const rippleInsert = (
  tracks: readonly Track[],
  trackIds: ReadonlySet<string>,
  at: number,
  length: number,
  makeId: () => string,
  makeTag: () => string = () => `sp-${makeId()}`,
): Track[] => {
  if (length <= 0) return tracks.map((t) => t);
  return tracks.map((track) => {
    if (!trackIds.has(track.id)) return track;
    const out: Clip[] = [];
    for (const clip of track.clips) {
      const end = clip.startSeconds + clip.durationSeconds;
      if (clip.startSeconds >= at - EDGE_EPS) {
        out.push({ ...clip, startSeconds: clip.startSeconds + length });
      } else if (end <= at + EDGE_EPS) {
        out.push(clip);
      } else {
        const leftDur = at - clip.startSeconds;
        const rightDur = clip.durationSeconds - leftDur;
        // Both halves stay ONE clip: they share a join id, and the inserted audio will sit between them
        const tag = clip.spliceId ?? makeTag();
        out.push({ ...clip, spliceId: tag, durationSeconds: leftDur, fadeOutSeconds: 0 });
        out.push({
          ...clip,
          id: makeId(),
          spliceId: tag,
          startSeconds: at + length,
          offsetSeconds: (clip.offsetSeconds || 0) + leftDur,
          durationSeconds: rightDur,
          fadeInSeconds: 0,
        });
      }
    }
    return { ...track, clips: out };
  });
};

/**
 * Makes freshly placed clips part of the clip they touch, so a track edited by paste is still ONE clip. Each placed clip
 * that touches a neighbour on its track (end to start, within the seam tolerance) is joined with it: the placed clip, the
 * neighbours and everything already joined to either all get one join id.
 */
export const joinTouching = (tracks: readonly Track[], placedIds: ReadonlySet<string>, makeTag: () => string): Track[] =>
  tracks.map((track) => {
    let clips = track.clips;
    for (const id of placedIds) {
      const me = clips.find((c) => c.id === id);
      if (!me) continue;
      const end = me.startSeconds + me.durationSeconds;
      const touching = clips.filter(
        (c) => c.id !== me.id && (Math.abs(c.startSeconds + c.durationSeconds - me.startSeconds) <= SEAM_EPS || Math.abs(c.startSeconds - end) <= SEAM_EPS),
      );
      if (touching.length === 0) continue;
      const tags = new Set<string>([...touching, me].map((c) => c.spliceId).filter(Boolean) as string[]);
      const tag = makeTag();
      const members = new Set<string>([me.id, ...touching.map((c) => c.id)]);
      clips = clips.map((c) => (members.has(c.id) || (c.spliceId && tags.has(c.spliceId)) ? { ...c, spliceId: tag } : c));
    }
    return clips === track.clips ? track : { ...track, clips };
  });
