import type { Clip, Track } from '../types';

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
        out.push({ ...clip, durationSeconds: leftDur, fadeOutSeconds: 0 });
        out.push({
          ...clip,
          id: makeId(),
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
