/**
 * Which screen the app opens on, decided once per page load.
 * The saved login is checked first, so someone who is already signed in never sees the sign-in page (not even a flash).
 *   wait   : the saved login is still being checked
 *   studio : signed in, or chose to continue as a guest in this tab
 *   auth   : the sign-in page
 * After `maxWaitMs` a slow or offline check stops blocking: the app opens as signed out rather than showing a blank page.
 */
export type StartView = 'wait' | 'studio' | 'auth';

export const MAX_AUTH_WAIT_MS = 5000;

export const startView = (s: { checking: boolean; signedIn: boolean; guest: boolean; waitedMs: number }): StartView => {
  if (s.signedIn || s.guest) return 'studio';
  if (s.checking && s.waitedMs < MAX_AUTH_WAIT_MS) return 'wait';
  return 'auth';
};
