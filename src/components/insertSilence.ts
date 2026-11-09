/**
 * Insert silence: open a gap of a chosen length at a time. A clip that is cut by the gap stays ONE clip: its two halves and the
 * silent piece between them share a splice id, so they are selected, moved and deleted together, like any edited clip.
 * Nothing is copied: the silent piece plays a small generated silent asset (tiled when the gap is longer than the asset).
 *
 * Pure and framework-free, so the rules can be unit-tested without a browser.
 */
import type { Clip, Marker, Track } from '../types';
import { SEAM_EPS, chainsOnTrack } from './spliceChains';

/** Length of the one generated silent asset; longer gaps tile it. */
export const SILENCE_ASSET_SECONDS = 10;
/** The longest single insertion */
export const MAX_SILENCE_SECONDS = 600;
/** A few milliseconds of fade at the cut edges, so a cut inside a sound never clicks */
export const SILENCE_EDGE_FADE_SECONDS = 0.005;

export const silenceAssetId = (sampleRate: number) => `asset-silence-${sampleRate}`;

export type SilenceScope = 'track' | 'all';

export interface InsertSilenceArgs {
  tracks: readonly Track[];
  /** The track the user is working on; the only one moved when scope is 'track' */
  trackId: string;
  atSeconds: number;
  lengthSeconds: number;
  scope: SilenceScope;
  sampleRate: number;
  makeId: () => string;
}

const silencePiece = (like: Clip, trackId: string, start: number, duration: number, assetId: string, spliceId: string, id: string): Clip => ({
  id, trackId, assetId, name: 'Silence', startSeconds: start, offsetSeconds: 0, durationSeconds: duration,
  gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: like.fadeShape, spliceId,
  ...(like.groupId ? { groupId: like.groupId } : {}),
});

/** The silent pieces that fill [start, start + length), each at most one asset long */
const tiles = (like: Clip, trackId: string, start: number, length: number, assetId: string, spliceId: string, makeId: () => string): Clip[] => {
  const out: Clip[] = [];
  let at = start;
  let left = length;
  while (left > 1e-9) {
    const d = Math.min(SILENCE_ASSET_SECONDS, left);
    out.push(silencePiece(like, trackId, at, d, assetId, spliceId, makeId()));
    at += d;
    left -= d;
  }
  return out;
};

/** One track: everything from `t` on moves right by `length`; a clip that is cut by `t` stays one clip with silence inside. */
export const openGapOnTrack = (track: Track, t: number, length: number, sampleRate: number, assetId: string, makeId: () => string): Track => {
  const seamAt = new Map<string, Clip>(); // piece that ENDS at t while the next piece of its own chain starts at t
  for (const chain of chainsOnTrack(track.clips)) {
    for (let i = 0; i < chain.length - 1; i++) {
      if (Math.abs(chain[i].startSeconds + chain[i].durationSeconds - t) <= SEAM_EPS) seamAt.set(chain[i].id, chain[i]);
    }
  }
  const out: Clip[] = [];
  for (const c of track.clips) {
    const end = c.startSeconds + c.durationSeconds;
    if (seamAt.has(c.id)) {
      out.push(c, ...tiles(c, track.id, t, length, assetId, c.spliceId!, makeId));
    } else if (end <= t + SEAM_EPS) {
      out.push(c);
    } else if (c.startSeconds >= t - SEAM_EPS) {
      out.push({ ...c, startSeconds: c.startSeconds + length });
    } else {
      // The gap opens inside this clip: left half, silence, right half, all one clip
      const leftFrames = Math.floor((t - c.startSeconds) * sampleRate);
      const leftDur = leftFrames / sampleRate;
      const rightDur = c.durationSeconds - leftDur;
      if (leftDur <= 1e-4 || rightDur <= 1e-4) { out.push(c); continue; }
      const spliceId = c.spliceId ?? makeId();
      const edge = (d: number) => Math.min(SILENCE_EDGE_FADE_SECONDS, d / 2);
      out.push({ ...c, spliceId, durationSeconds: leftDur, fadeOutSeconds: edge(leftDur) });
      out.push(...tiles(c, track.id, c.startSeconds + leftDur, length, assetId, spliceId, makeId));
      out.push({
        ...c, id: makeId(), spliceId, startSeconds: c.startSeconds + leftDur + length, offsetSeconds: c.offsetSeconds + leftDur,
        durationSeconds: rightDur, fadeInSeconds: edge(rightDur), fadeOutSeconds: c.fadeOutSeconds,
      });
    }
  }
  return { ...track, clips: out.sort((a, b) => a.startSeconds - b.startSeconds) };
};

/** Insert silence on one track, or on every track so that everything stays in sync. */
export const insertSilenceInTracks = (a: InsertSilenceArgs): Track[] => {
  const length = Math.min(MAX_SILENCE_SECONDS, Math.max(0, a.lengthSeconds));
  if (length <= 0) return [...a.tracks];
  const assetId = silenceAssetId(a.sampleRate);
  return a.tracks.map((t) => (a.scope === 'all' || t.id === a.trackId ? openGapOnTrack(t, Math.max(0, a.atSeconds), length, a.sampleRate, assetId, a.makeId) : t));
};

/**
 * Markers after an insertion. A marker at or after the point moves right by the length when everything moves; with one track
 * moved, only markers attached to a clip on that track (and at or after the point) move. Free markers stay put then.
 */
export const shiftMarkersForInsert = (markers: readonly Marker[] | undefined, tracks: readonly Track[], at: number, length: number, scope: SilenceScope, trackId: string): Marker[] | undefined => {
  if (!markers || markers.length === 0) return markers as Marker[] | undefined;
  const onTrack = new Set(tracks.filter((t) => t.id === trackId).flatMap((t) => t.clips.map((c) => c.id)));
  return markers
    .map((m) => ((m.timeSeconds >= at - 1e-9) && (scope === 'all' || (m.clipId !== undefined && onTrack.has(m.clipId))) ? { ...m, timeSeconds: m.timeSeconds + length } : m))
    .sort((x, y) => x.timeSeconds - y.timeSeconds);
};
