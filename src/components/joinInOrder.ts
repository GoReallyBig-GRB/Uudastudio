/**
 * Join clips in the order the user picked them. The picked clips (each edited clip counts once, however many pieces it has) are
 * laid end to end, in that order, as ONE clip on a NEW track placed under the first clip's track. Gaps are closed. The originals
 * and every other track stay exactly where they are, so nothing in the mix shifts. The joined pieces share one splice id, so they
 * select, move, copy and delete as one clip; no audio is copied, each piece still plays its own source. A short fade at each join
 * keeps a cut between unrelated sounds from clicking; a join between pieces that already continue each other gets none.
 *
 * Pure and framework-free, so the rules can be unit-tested without a browser.
 */
import type { Clip, Track } from '../types';
import { chainIds } from './spliceChains';

/** Fade at each join, seconds */
export const JOIN_FADE_SECONDS = 0.005;

export type JoinOrderPlan =
  | { ok: true; tracks: Track[]; /** The new track holding the joined clip */ trackId: string; spliceId: string; /** Where each join falls on the timeline */ seams: number[]; start: number; end: number; clipCount: number }
  | { ok: false; reason: 'few' | 'missing' };

const find = (tracks: readonly Track[], id: string): { clip: Clip; track: Track } | null => {
  for (const t of tracks) {
    const c = t.clips.find((x) => x.id === id);
    if (c) return { clip: c, track: t };
  }
  return null;
};

const unitEnd = (unit: Clip[]) => Math.max(...unit.map((c) => c.startSeconds + c.durationSeconds));
const unitStart = (unit: Clip[]) => Math.min(...unit.map((c) => c.startSeconds));
const last = (unit: Clip[]) => unit.reduce((a, b) => (b.startSeconds + b.durationSeconds >= a.startSeconds + a.durationSeconds ? b : a));
const first = (unit: Clip[]) => unit.reduce((a, b) => (b.startSeconds < a.startSeconds ? b : a));

/** Same audio file, and the second carries on in the audio exactly where the first stopped */
const continues = (a: Clip, b: Clip) => a.assetId === b.assetId && Math.abs(a.offsetSeconds + a.durationSeconds - b.offsetSeconds) <= 1e-4;

export const joinInOrder = (tracks: readonly Track[], orderedIds: readonly string[], makeId: () => string): JoinOrderPlan => {
  // Each picked clip becomes a unit: all the pieces of the clip it belongs to, in time order
  const seen = new Set<string>();
  const units: Clip[][] = [];
  for (const id of orderedIds) {
    if (!find(tracks, id)) return { ok: false, reason: 'missing' };
    const ids = chainIds(tracks, id);
    if (ids.some((x) => seen.has(x))) continue;
    ids.forEach((x) => seen.add(x));
    units.push(ids.map((x) => find(tracks, x)!.clip).sort((a, b) => a.startSeconds - b.startSeconds));
  }
  if (units.length < 2) return { ok: false, reason: 'few' };

  const sourceTrack = find(tracks, units[0][0].id)!.track;
  const newTrackId = makeId();
  const spliceId = makeId();

  // Copies (new ids) laid end to end on the new track, starting where the first picked clip starts
  const copies: Clip[] = [];
  const byOld = new Map<string, Clip>();
  const seams: number[] = [];
  let at = unitStart(units[0]);
  const start = at;
  units.forEach((unit, i) => {
    const shift = at - unitStart(unit);
    for (const c of unit) {
      const { groupId: _g, locked: _l, ...rest } = c;
      const copy: Clip = { ...rest, id: makeId(), trackId: newTrackId, startSeconds: c.startSeconds + shift, spliceId };
      byOld.set(c.id, copy);
      copies.push(copy);
    }
    if (i > 0) seams.push(at);
    at += unitEnd(unit) - unitStart(unit);
  });
  const end = at;

  // Short fade at each join (unless the audio simply carries on)
  for (let i = 1; i < units.length; i++) {
    const a = last(units[i - 1]);
    const b = first(units[i]);
    if (continues(a, b)) continue;
    const pa = byOld.get(a.id)!;
    const pb = byOld.get(b.id)!;
    pa.fadeOutSeconds = Math.max(pa.fadeOutSeconds, Math.min(JOIN_FADE_SECONDS, pa.durationSeconds / 2));
    pb.fadeInSeconds = Math.max(pb.fadeInSeconds, Math.min(JOIN_FADE_SECONDS, pb.durationSeconds / 2));
  }

  const newTrack: Track = {
    id: newTrackId,
    name: 'Joined',
    customName: true,
    clips: copies.sort((x, y) => x.startSeconds - y.startSeconds),
    volume: 1,
    pan: 0,
    muted: false,
    solo: false,
  };
  const out: Track[] = [];
  for (const t of tracks) {
    out.push(t);
    if (t.id === sourceTrack.id) out.push(newTrack);
  }
  return { ok: true, tracks: out, trackId: newTrackId, spliceId, seams, start, end, clipCount: units.length };
};

/**
 * A window of one track for previewing a join: only the audio from `from` to `to`, so the preview starts a few seconds before the
 * join instead of at the start of a long clip. Pieces keep their timeline times; their audio offsets move with the cut.
 */
export const cropTrackWindow = (track: Track, from: number, to: number): Track => ({
  ...track,
  clips: track.clips.flatMap((c): Clip[] => {
    const s = Math.max(c.startSeconds, from);
    const e = Math.min(c.startSeconds + c.durationSeconds, to);
    if (e - s <= 1e-6) return [];
    const trimmedStart = s > c.startSeconds;
    const trimmedEnd = e < c.startSeconds + c.durationSeconds;
    return [{ ...c, startSeconds: s, offsetSeconds: c.offsetSeconds + (s - c.startSeconds), durationSeconds: e - s, fadeInSeconds: trimmedStart ? 0 : c.fadeInSeconds, fadeOutSeconds: trimmedEnd ? 0 : c.fadeOutSeconds }];
  }),
});

/** The preview window around join number `index`: a few seconds before it, up to `length` seconds in all */
export const previewWindow = (plan: Extract<JoinOrderPlan, { ok: true }>, index: number, length: number, lead = 4): { from: number; to: number } => {
  const seam = plan.seams[Math.min(Math.max(0, index), plan.seams.length - 1)];
  const from = Math.max(plan.start, seam - lead);
  return { from, to: Math.min(plan.end, from + length) };
};

/**
 * The preview position after pressing the previous / next arrow: the start of a clip in the joined result.
 * `starts` are where each clip begins (seconds from the start of the result), `pos` the current position.
 * Previous goes to the start of the current clip, or of the one before it when already within 1.5 s of that start.
 */
export const stepClip = (starts: readonly number[], pos: number, dir: 1 | -1): number => {
  if (starts.length === 0) return 0;
  let idx = 0;
  for (let i = 0; i < starts.length; i++) if (starts[i] <= pos + 0.05) idx = i;
  if (dir === 1) return starts[Math.min(starts.length - 1, idx + 1)];
  return pos - starts[idx] > 1.5 ? starts[idx] : starts[Math.max(0, idx - 1)];
};
