import { useEffect, useRef } from 'react';

/** How long to wait when a live connection is open: only a slow safety check */
export const LIVE_RESYNC_MS = 120000;
/** When nothing has changed for a while, wait longer between checks, up to this many times the base pause */
export const QUIET_BACKOFF_MAX = 4;

/**
 * Runs `tick` now and then every `ms` while the page is visible; comes back at once when the tab is shown again.
 * If `tick` returns false (nothing changed) the pause grows, up to 4x, and snaps back as soon as something changes.
 * With `live` set (a WebSocket is open) the pause is a slow safety check instead.
 */
export const usePolling = (tick: () => void | boolean | Promise<void | boolean>, ms: number, enabled = true, live = false): void => {
  const ref = useRef(tick);
  ref.current = tick;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer = 0;
    let quiet = 0;
    const run = async () => {
      if (stopped) return;
      if (!document.hidden) {
        try { quiet = (await ref.current()) === false ? quiet + 1 : 0; } catch { /* try again next time */ }
      }
      if (!stopped) timer = window.setTimeout(() => void run(), live ? LIVE_RESYNC_MS : ms * Math.min(QUIET_BACKOFF_MAX, 1 + Math.floor(quiet / 3)));
    };
    const onVisible = () => { if (!document.hidden) { window.clearTimeout(timer); quiet = 0; void run(); } };
    void run();
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [ms, enabled, live]);
};
