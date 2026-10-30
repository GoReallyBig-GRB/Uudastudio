/**
 * Copy and paste of several whole clips at once (a group, or any multi-selection).
 *
 * copyClipSet() keeps the clips' positions relative to the earliest one and keeps the stack of tracks they sat on (tracks in
 * between with nothing selected stay as empty layers). pasteClipSet() lays that stack back at a new time starting on a chosen
 * track, adding tracks at the bottom when needed. A pasted group becomes a NEW group, so editing it never touches the original.
 * Pure and framework-free so it can be unit-tested without a browser.
 */
import type { Clip, Track } from '../types';
import { pasteRange, type PasteRangeResult, type RangeClipboard } from './rangeClipboard';

export interface ClipSetClipboard extends RangeClipboard {
  /** Group ids used by the copied clips (their old ids; pasting gives each a fresh one). */
  groupIds: string[];
}

export const copyClipSet = (tracks: readonly Track[], clipIds: ReadonlySet<string>): ClipSetClipboard | null => {
  const picked = tracks.map((t) => t.clips.filter((c) => clipIds.has(c.id)));
  const used = picked.map((cs, i) => (cs.length > 0 ? i : -1)).filter((i) => i >= 0);
  if (used.length === 0) return null;
  const first = used[0];
  const last = used[used.length - 1];
  let minStart = Infinity;
  let maxEnd = 0;
  for (const cs of picked) for (const c of cs) {
    minStart = Math.min(minStart, c.startSeconds);
    maxEnd = Math.max(maxEnd, c.startSeconds + c.durationSeconds);
  }
  const groupIds = new Set<string>();
  const layers = [];
  for (let i = first; i <= last; i++) {
    const clips = picked[i].map((c) => {
      if (c.groupId) groupIds.add(c.groupId);
      return { ...c, startSeconds: c.startSeconds - minStart };
    });
    layers.push({ sourceTrackId: tracks[i].id, clips });
  }
  return { durationSeconds: Math.max(0, maxEnd - minStart), layers, groupIds: [...groupIds] };
};

export interface PasteClipSetResult extends PasteRangeResult {
  /** old group id -> new group id */
  groupMap: Record<string, string>;
}

export const pasteClipSet = (
  tracks: readonly Track[],
  clipboard: ClipSetClipboard,
  atSeconds: number,
  startTrackIndex: number,
  makeId: () => string,
  makeTrack: (index: number, sourceTrackId: string) => Track,
  makeGroupId: () => string,
): PasteClipSetResult => {
  const result = pasteRange(tracks, clipboard, atSeconds, startTrackIndex, makeId, makeTrack);
  const groupMap: Record<string, string> = {};
  for (const g of clipboard.groupIds) groupMap[g] = makeGroupId();
  const added = new Set(result.addedClipIds);
  const out = result.tracks.map((t) => ({
    ...t,
    clips: t.clips.map((c): Clip => (added.has(c.id) && c.groupId && groupMap[c.groupId] ? { ...c, groupId: groupMap[c.groupId] } : c)),
  }));
  return { ...result, tracks: out, groupMap };
};
