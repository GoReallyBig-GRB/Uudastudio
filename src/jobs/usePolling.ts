import { useEffect, useRef } from 'react';

/** Runs `tick` now and then every `ms` while the page is visible; comes back at once when the tab is shown again. */
export const usePolling = (tick: () => void | Promise<void>, ms: number, enabled = true): void => {
  const ref = useRef(tick);
  ref.current = tick;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer = 0;
    const run = async () => {
      if (stopped) return;
      if (!document.hidden) { try { await ref.current(); } catch { /* try again next time */ } }
      if (!stopped) timer = window.setTimeout(() => void run(), ms);
    };
    const onVisible = () => { if (!document.hidden) { window.clearTimeout(timer); void run(); } };
    void run();
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [ms, enabled]);
};
