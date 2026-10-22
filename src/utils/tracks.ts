/**
 * Uuda Studio - track naming and empty-lane helpers (pure functions, easy to test).
 *
 * Labels: a track the user never renamed shows "Track N" where N is its current position, so reordering never leaves
 * a stale number. A name the user typed always sticks. Tracks created from a file or a voiceover keep their own name.
 */

import { Track } from '../types';

const DEFAULT_NAME = /^Track \d+$/;

type NamedTrack = Pick<Track, 'name' | 'customName'>;

export function getTrackLabel(track: NamedTrack, index: number): string {
  const fallback = `Track ${index + 1}`;
  const name = (track.name || '').trim();
  if (track.customName) return name || fallback;
  if (!name || DEFAULT_NAME.test(name)) return fallback;
  return name;
}

/** The update to apply when the user finishes renaming. Blank goes back to the automatic "Track N" label. */
export function renameUpdate(typed: string): Pick<Track, 'name' | 'customName'> {
  const name = typed.trim().slice(0, 60);
  return name ? { name, customName: true } : { name: 'Track', customName: false };
}

export function isTrackEmpty(track: Pick<Track, 'clips'>): boolean {
  return track.clips.length === 0;
}

/** A lane nobody has touched: default label, default mixer settings, no clips, no effects */
export function isUntouchedTrack(track: Track, hasPlugins: boolean): boolean {
  const defaultLabel = !track.customName && (!track.name || DEFAULT_NAME.test(track.name.trim()) || track.name === 'Track');
  return (
    track.clips.length === 0 &&
    defaultLabel &&
    track.volume === 1 &&
    track.pan === 0 &&
    !track.muted &&
    !track.solo &&
    !(track.effects && track.effects.length > 0) &&
    !hasPlugins
  );
}

/**
 * After clips were moved off lanes: drop lanes that were emptied by that move and are still untouched.
 * Lanes that were already empty before the move, renamed, or carrying effects are kept.
 * Never removes every track.
 */
export function pruneEmptiedTracks(
  before: Track[],
  after: Track[],
  hasPlugins: (trackId: string) => boolean
): { tracks: Track[]; removedIds: string[] } {
  const hadClips = new Set(before.filter((t) => t.clips.length > 0).map((t) => t.id));
  const removedIds: string[] = [];
  const kept = after.filter((t) => {
    if (hadClips.has(t.id) && isUntouchedTrack(t, hasPlugins(t.id))) {
      removedIds.push(t.id);
      return false;
    }
    return true;
  });
  if (kept.length === 0) return { tracks: after, removedIds: [] };
  return { tracks: kept, removedIds };
}
