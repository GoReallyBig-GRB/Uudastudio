import { useEffect, useRef, useState } from 'react';

/** Which thread changed: 'job' means the job itself (files, links), the rest are the two message threads */
export type LiveChange = 'talent' | 'client' | 'job';

/**
 * Keeps one WebSocket open to the job so the page hears about changes at once instead of asking over and over.
 * Reconnects with growing pauses. Gives up quietly (so polling carries on) if it can never connect, as on the Express test server.
 */
export const openLive = (jobId: string, key: string, onChange: (c: LiveChange) => void, onState: (connected: boolean) => void): (() => void) => {
  let ws: WebSocket | null = null;
  let stopped = false;
  let everOpened = false;
  let failures = 0;
  let retry = 0;
  let beat = 0;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/jobs/${jobId}/live?k=${encodeURIComponent(key)}`;

  const connect = () => {
    if (stopped) return;
    try { ws = new WebSocket(url); } catch { onState(false); return; }
    ws.onopen = () => {
      everOpened = true; failures = 0; onState(true);
      beat = window.setInterval(() => { try { if (ws?.readyState === WebSocket.OPEN) ws.send('ping'); } catch { /* the close handler reconnects */ } }, 50000);
    };
    ws.onmessage = (e) => {
      if (e.data === 'pong') return;
      try { const m = JSON.parse(String(e.data)); if (m?.t === 'changed') onChange(m.th === 'talent' || m.th === 'client' ? m.th : 'job'); } catch { /* ignore */ }
    };
    ws.onclose = (e) => {
      window.clearInterval(beat); onState(false);
      if (stopped || e.code === 4001) return; // 4001: the link was replaced; polling will show the error
      failures++;
      if (!everOpened && failures >= 2) return; // this server has no live connection
      retry = window.setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(failures, 5)));
    };
    ws.onerror = () => { try { ws?.close(); } catch { /* already closed */ } };
  };
  connect();
  // A page coming back from sleep may hold a dead socket: reconnect at once
  const onVisible = () => { if (!document.hidden && !stopped && (!ws || ws.readyState === WebSocket.CLOSED) && (everOpened || failures < 2)) { window.clearTimeout(retry); connect(); } };
  document.addEventListener('visibilitychange', onVisible);
  return () => { stopped = true; window.clearTimeout(retry); window.clearInterval(beat); document.removeEventListener('visibilitychange', onVisible); try { ws?.close(1000); } catch { /* ignore */ } };
};

/** Opens the live connection while `enabled`, calls `onChange` when something changed, and says whether it is connected */
export const useLive = (jobId: string | undefined, key: string | undefined, onChange: (c: LiveChange) => void, enabled = true): boolean => {
  const [on, setOn] = useState(false);
  const ref = useRef(onChange);
  ref.current = onChange;
  useEffect(() => {
    if (!enabled || !jobId || !key || typeof WebSocket === 'undefined') { setOn(false); return; }
    const close = openLive(jobId, key, (c) => ref.current(c), setOn);
    return () => { close(); setOn(false); };
  }, [jobId, key, enabled]);
  return on;
};
