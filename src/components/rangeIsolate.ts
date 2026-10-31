/**
 * Isolate a time range inside clips, without moving anything.
 *
 * Every clip that overlaps [start, end) on the chosen tracks is split at the range edges, so the part inside the range
 * becomes its own clip that can be silenced, made louder or quieter, or processed, while the audio on either side stays
 * exactly where it was. The pieces share the original audio, so nothing is re-encoded and there is no gap or click.
 * A clip that already sits exactly inside the range is not split at all. Fades stay with the end they belong to.
 *
 * Pure and framework-free so the rules can be unit-tested without a browser.
 */
import type { Clip, Track } from '../types';
import { MIN_PIECE_SECONDS, normalizeRange } from './rangeDelete';
import { nextPartName } from './clipTitle';

export interface IsolateResult {
  tracks: Track[];
  /** The clips now sitting exactly inside the range, in track order */
  innerClipIds: string[];
  /** Tracks whose clips changed (were split) */
  changedTrackIds: string[];
}

export const isolateRangeInTracks = (
  tracks: readonly Track[],
  trackIds: readonly string[],
  rangeStart: number,
  rangeEnd: number,
  makeId: () => string,
): IsolateResult => {
  const range = normalizeRange(rangeStart, rangeEnd);
  if (!range) return { tracks: [...tracks], innerClipIds: [], changedTrackIds: [] };
  const included = new Set(trackIds);
  const innerClipIds: string[] = [];
  const changedTrackIds: string[] = [];

  const out = tracks.map((track) => {
    if (!included.has(track.id)) return track;
    const clips: Clip[] = [];
    let changed = false;
    for (const clip of track.clips) {
      const start = clip.startSeconds;
      const end = start + clip.durationSeconds;
      const innerStart = Math.max(start, range.start);
      const innerEnd = Math.min(end, range.end);
      if (innerEnd - innerStart < MIN_PIECE_SECONDS) {
        clips.push(clip);
        continue;
      }
      const leftDur = innerStart - start;
      const rightDur = end - innerEnd;
      const hasLeft = leftDur >= MIN_PIECE_SECONDS;
      const hasRight = rightDur >= MIN_PIECE_SECONDS;
      if (!hasLeft && !hasRight) {
        // The clip is the range (or within a sliver of it): nothing to split
        innerClipIds.push(clip.id);
        clips.push(clip);
        continue;
      }
      changed = true;
      const offset = clip.offsetSeconds || 0;
      if (hasLeft) {
        clips.push({ ...clip, durationSeconds: leftDur, fadeOutSeconds: 0 });
      }
      const innerId = hasLeft ? makeId() : clip.id;
      innerClipIds.push(innerId);
      clips.push({
        ...clip,
        id: innerId,
        name: hasLeft ? nextPartName(clip.name) : clip.name,
        startSeconds: innerStart,
        offsetSeconds: offset + (innerStart - start),
        durationSeconds: innerEnd - innerStart,
        fadeInSeconds: hasLeft ? 0 : clip.fadeInSeconds,
        fadeOutSeconds: hasRight ? 0 : clip.fadeOutSeconds,
      });
      if (hasRight) {
        clips.push({
          ...clip,
          id: makeId(),
          name: nextPartName(clip.name),
          startSeconds: innerEnd,
          offsetSeconds: offset + (innerEnd - start),
          durationSeconds: rightDur,
          fadeInSeconds: 0,
        });
      }
    }
    if (!changed) return track;
    changedTrackIds.push(track.id);
    return { ...track, clips };
  });

  return { tracks: out, innerClipIds, changedTrackIds };
};
