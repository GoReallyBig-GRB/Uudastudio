import { useEffect, useState } from 'react';
import { FREESOUND_CONNECTED_KEY, FREESOUND_STATE_KEY, readFreesoundReturn } from './oauthReturn';

/**
 * The page Freesound sends the person back to. It finishes the connection (the server swaps the code for the person's
 * token and keeps it), tells the tab that asked, and offers the way back. No token is ever shown or stored here.
 */
export default function FreesoundReturn() {
  const [status, setStatus] = useState<'working' | 'done' | 'denied' | 'failed'>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let expected: string | null = null;
    try { expected = localStorage.getItem(FREESOUND_STATE_KEY); } catch { /* storage unavailable */ }
    const r = readFreesoundReturn(window.location.search, expected);
    try { localStorage.removeItem(FREESOUND_STATE_KEY); } catch { /* storage unavailable */ }
    // The code and state have done their job; take them out of the address bar and the history
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    if (r.kind === 'denied') { setStatus('denied'); return; }
    if (r.kind !== 'code') { setStatus('failed'); setMessage('This sign-in link was not started from this browser, so it was not used. Press Connect in Uuda and try again.'); return; }
    (async () => {
      try {
        const res = await fetch('/api/freesound/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: r.code }) });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setStatus('failed');
          setMessage(res.status === 401 ? 'Sign in to Uuda first, then connect Freesound again.' : (d as { error?: string }).error || 'Freesound could not connect your account. Please try again.');
          return;
        }
        try { localStorage.setItem(FREESOUND_CONNECTED_KEY, String(Date.now())); } catch { /* storage unavailable */ }
        setStatus('done');
        window.close(); // works only when this tab was opened by Uuda itself; otherwise the message below stays
      } catch {
        setStatus('failed');
        setMessage('Could not reach the server. Check your connection and try again.');
      }
    })();
  }, []);

  const text = status === 'working' ? 'Connecting your Freesound account…'
    : status === 'done' ? 'Freesound is connected. You can close this tab and go back to Uuda.'
    : status === 'denied' ? 'You chose not to connect Freesound. Nothing was changed.'
    : message;

  return (
    <div className="grid h-dvh place-items-center bg-surface-0 p-6 text-center text-ink">
      <div className="max-w-sm space-y-4">
        <p role={status === 'failed' ? 'alert' : 'status'} className="text-sm text-ink-dim">{text}</p>
        {status !== 'working' && (
          <a href="/" className="inline-flex h-9 items-center rounded-control border border-line bg-surface-1 px-4 text-sm text-ink hover:border-accent">Back to Uuda</a>
        )}
      </div>
    </div>
  );
}
