/**
 * Copy and paste of a time range across one or several tracks.
 *
 * copyRange() takes the audio inside [start, end) from each chosen track as trimmed clips whose positions are relative to
 * the start of the range. pasteRange() puts that same stack of tracks back at a new time, one clip layer per track,
 * adding tracks at the bottom when there are not enough. Nothing is rippled on paste: it lays the audio on top, the
 * same way pasting a single clip does. Pure and framework-free so it can be unit-tested without a browser.
 */
import type { Clip, Track } from '../types';
import { MIN_PIECE_SECONDS, normalizeRange } from './rangeDelete';

export interface RangeClipboardLayer {
  /** Track the audio came from (for naming and for pasting back onto it when it still exists). */
  sourceTrackId: string;
  /** Clips trimmed to the range, with startSeconds measured from the start of the range. */
  clips: Clip[];
}

export interface RangeClipboard {
  durationSeconds: number;
  /** One layer per track, top to bottom. A track with no audio in the range is still a (empty) layer, so the stack keeps its shape. */
  layers: RangeClipboardLayer[];
}

/** Trims one clip to [start, end) of project time. Returns null when nothing of it lies inside. */
export const sliceClip = (clip: Clip, start: number, end: number): Clip | null => {
  const clipStart = clip.startSeconds;
  const clipEnd = clip.startSeconds + clip.durationSeconds;
  const from = Math.max(clipStart, start);
  const to = Math.min(clipEnd, end);
  if (to - from < MIN_PIECE_SECONDS) return null;
  const cutFront = from > clipStart;
  const cutBack = to < clipEnd;
  return {
    ...clip,
    groupId: undefined,
    startSeconds: from - start,
    offsetSeconds: (clip.offsetSeconds || 0) + (from - clipStart),
    durationSeconds: to - from,
    // A fade belongs to the clip's own edge; an edge made by the range gets none
    fadeInSeconds: cutFront ? 0 : clip.fadeInSeconds,
    fadeOutSeconds: cutBack ? 0 : clip.fadeOutSeconds,
  };
};

export const copyRange = (
  tracks: readonly Track[],
  trackIds: readonly string[],
  rangeStart: number,
  rangeEnd: number,
): RangeClipboard | null => {
  const range = normalizeRange(rangeStart, rangeEnd);
  if (!range) return null;
  const included = new Set(trackIds);
  const layers: RangeClipboardLayer[] = [];
  for (const t of tracks) {
    if (!included.has(t.id)) continue;
    const clips: Clip[] = [];
    for (const c of t.clips) {
      if (c.muted) { /* muted clips are copied too: they are part of the track */ }
      const piece = sliceClip(c, range.start, range.end);
      if (piece) clips.push(piece);
    }
    layers.push({ sourceTrackId: t.id, clips });
  }
  if (!layers.some((l) => l.clips.length > 0)) return null;
  return { durationSeconds: range.end - range.start, layers };
};

export interface PasteRangeResult {
  tracks: Track[];
  /** Ids of the clips that were added. */
  addedClipIds: string[];
  /** Ids of tracks created because the stack did not fit. */
  createdTrackIds: string[];
}

/**
 * Lays the copied stack onto consecutive tracks starting at `startTrackIndex`, with its first moment at `atSeconds`.
 * Tracks that do not exist yet are created at the bottom (via `makeTrack`).
 */
export const pasteRange = (
  tracks: readonly Track[],
  clipboard: RangeClipboard,
  atSeconds: number,
  startTrackIndex: number,
  makeId: () => string,
  makeTrack: (index: number, sourceTrackId: string) => Track,
): PasteRangeResult => {
  const out: Track[] = tracks.map((t) => ({ ...t, clips: [...t.clips] }));
  const addedClipIds: string[] = [];
  const createdTrackIds: string[] = [];
  const at = Math.max(0, atSeconds);
  clipboard.layers.forEach((layer, i) => {
    const index = Math.max(0, startTrackIndex) + i;
    while (out.length <= index) {
      const created = makeTrack(out.length, layer.sourceTrackId);
      out.push(created);
      createdTrackIds.push(created.id);
    }
    const target = out[index];
    for (const c of layer.clips) {
      const id = makeId();
      target.clips.push({ ...c, id, trackId: target.id, startSeconds: at + c.startSeconds });
      addedClipIds.push(id);
    }
  });
  return { tracks: out, addedClipIds, createdTrackIds };
};
