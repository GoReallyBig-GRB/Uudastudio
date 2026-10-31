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
  /**
   * true: the pieces stay ONE clip (they share a splice id), used for silence and level changes so a track is never
   * broken into separate clips. false: the pieces become separate clips (Split out, and processing a range).
   */
  joined = false,
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
      // Joined: all pieces share the clip's splice id. Separate: the pieces from the range onward leave any existing join.
      const keepTag = joined ? clip.spliceId ?? `sp-${clip.id}` : clip.spliceId;
      const innerTag = joined ? keepTag : undefined;
      const rightTag = joined ? keepTag : undefined;
      if (hasLeft) {
        clips.push({ ...clip, spliceId: keepTag, durationSeconds: leftDur, fadeOutSeconds: 0 });
      }
      const innerId = hasLeft ? makeId() : clip.id;
      innerClipIds.push(innerId);
      clips.push({
        ...clip,
        id: innerId,
        name: hasLeft && !joined ? nextPartName(clip.name) : clip.name,
        spliceId: hasLeft ? innerTag : keepTag,
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
          name: joined ? clip.name : nextPartName(clip.name),
          spliceId: rightTag,
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
