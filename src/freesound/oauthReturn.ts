/**
 * Freesound sends the person back to Uuda's own address after they approve (or refuse) the connection:
 *   /?code=...&state=...&original_path=...      approved
 *   /?error=access_denied&state=...             refused
 * `state` is a one-time value Uuda made when it built the link; only a return that carries it back unchanged is accepted.
 */
export const FREESOUND_STATE_KEY = 'uuda_freesound_state';
/** Written when a connection was made in another tab, so the tab that asked can pick it up */
export const FREESOUND_CONNECTED_KEY = 'uuda_freesound_connected';

export type FreesoundReturn =
  | { kind: 'none' }
  | { kind: 'code'; code: string }
  | { kind: 'denied' }
  | { kind: 'mismatch' };

export const readFreesoundReturn = (search: string, expectedState: string | null): FreesoundReturn => {
  const q = new URLSearchParams(search);
  const state = q.get('state');
  const code = q.get('code');
  const error = q.get('error');
  // Not ours: no state means this is not a return from the Freesound link Uuda builds
  if (!state || (!code && !error)) return { kind: 'none' };
  if (!expectedState || state !== expectedState) return { kind: 'mismatch' };
  if (error) return { kind: 'denied' };
  return code ? { kind: 'code', code } : { kind: 'none' };
};
