/**
 * Ripple-delete a time range from ONE track.
 *
 * Everything inside [rangeStart, rangeEnd) is removed from that track's clips, and everything after the range
 * slides left by the length of the range, so the audio on either side meets with no gap. Other tracks are never
 * touched, so only this track shifts relative to the rest of the project.
 *
 * No fade or crossfade is added at the join (a fade on a very close cut would dip the level). The cut edges of a
 * trimmed clip get fadeIn/fadeOut of 0, because a clip's old fade belonged to the end that was just removed.
 * Clips keep their own source audio: a clip cut in the middle becomes two clips that sit end to end.
 *
 * Pure and framework-free so the rules can be unit-tested without a browser.
 */
import type { Clip } from '../types';

/** Which tool the timeline pointer uses: Select moves and edits clips; Range highlights a span of one track. */
export type TimelineTool = 'select' | 'range';

/** A highlighted span of time on one track. startSeconds is always before endSeconds. */
export interface RangeSelection {
  trackId: string;
  startSeconds: number;
  endSeconds: number;
}

/** Pieces shorter than this (seconds) are dropped instead of leaving a near-zero-length clip. */
export const MIN_PIECE_SECONDS = 0.001;

export interface RangeDeleteResult {
  clips: Clip[];
  /** Length of the range actually removed from the timeline, in seconds (0 when nothing changed). */
  removedSeconds: number;
  /** Ids of clips that were removed outright, trimmed, split or moved. Empty when nothing changed. */
  changedClipIds: string[];
}

/** Validates and orders a range. Returns null when it is empty, inverted or not finite. */
export const normalizeRange = (a: number, b: number): { start: number; end: number } | null => {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const start = Math.max(0, Math.min(a, b));
  const end = Math.max(a, b);
  return end - start >= MIN_PIECE_SECONDS ? { start, end } : null;
};

export const deleteRangeFromClips = (
  clips: readonly Clip[],
  rangeStart: number,
  rangeEnd: number,
  makeId: () => string,
): RangeDeleteResult => {
  const range = normalizeRange(rangeStart, rangeEnd);
  if (!range) return { clips: [...clips], removedSeconds: 0, changedClipIds: [] };

  const gap = range.end - range.start;
  const out: Clip[] = [];
  const changed: string[] = [];

  for (const clip of clips) {
    const start = clip.startSeconds;
    const end = clip.startSeconds + clip.durationSeconds;

    // Entirely before the range: untouched.
    if (end <= range.start) {
      out.push(clip);
      continue;
    }

    // Entirely after the range: slide left by the gap.
    if (start >= range.end) {
      out.push({ ...clip, startSeconds: start - gap });
      changed.push(clip.id);
      continue;
    }

    changed.push(clip.id);

    // Piece that survives before the range (clip starts before the range).
    const leftDuration = range.start - start;
    // Piece that survives after the range (clip ends after the range).
    const rightDuration = end - range.end;

    const keepLeft = start < range.start && leftDuration >= MIN_PIECE_SECONDS;
    const keepRight = end > range.end && rightDuration >= MIN_PIECE_SECONDS;

    if (keepLeft) {
      out.push({
        ...clip,
        durationSeconds: leftDuration,
        // The clip's old end fade belonged to the end that was removed; nothing is added at the cut.
        fadeOutSeconds: 0,
      });
    }

    if (keepRight) {
      out.push({
        ...clip,
        // The first piece keeps the clip's id; a second piece from the same clip gets a new one.
        id: keepLeft ? makeId() : clip.id,
        name: keepLeft ? `${clip.name} (Part 2)` : clip.name,
        startSeconds: range.start,
        offsetSeconds: (clip.offsetSeconds || 0) + (range.end - start),
        durationSeconds: rightDuration,
        fadeInSeconds: 0,
      });
    }
    // A clip fully inside the range (or left with only slivers) produces no pieces and is removed.
  }

  return { clips: out, removedSeconds: changed.length > 0 ? gap : 0, changedClipIds: changed };
};
