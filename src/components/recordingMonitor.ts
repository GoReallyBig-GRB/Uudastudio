/**
 * What happens to the other tracks while recording: duck them (level comes from the project's ducking setting),
 * mute them completely, or leave them alone. Pure helpers, so the rules can be unit-tested without a browser.
 */

export type OtherTracksMode = 'duck' | 'mute' | 'off';

const STORAGE_KEY = 'uuda.recording.otherTracksMode';

export const isOtherTracksMode = (value: unknown): value is OtherTracksMode =>
  value === 'duck' || value === 'mute' || value === 'off';

/** First-time default: follow the project's existing "duck playing tracks" switch. */
export const defaultModeFromSettings = (duckPlayingTracks: boolean): OtherTracksMode => (duckPlayingTracks ? 'duck' : 'off');

/**
 * Gain change to apply to the other tracks, in dB, or null for none.
 * Mute is negative infinity: the engine ramps the ducking gain to exactly zero, which is a clean fade to silence.
 */
export const duckDbForMode = (mode: OtherTracksMode, duckingAmountDb: number): number | null => {
  if (mode === 'off') return null;
  if (mode === 'mute') return Number.NEGATIVE_INFINITY;
  return duckingAmountDb;
};

/** Where a take starts on the timeline: the playhead when recording began, never negative or non-finite. */
export const takeStartSeconds = (playheadSeconds: number): number =>
  Number.isFinite(playheadSeconds) && playheadSeconds > 0 ? playheadSeconds : 0;

export const loadOtherTracksMode = (fallback: OtherTracksMode): OtherTracksMode => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isOtherTracksMode(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
};

export const saveOtherTracksMode = (mode: OtherTracksMode): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable (private mode, blocked); the choice then simply lasts for this session.
  }
};
