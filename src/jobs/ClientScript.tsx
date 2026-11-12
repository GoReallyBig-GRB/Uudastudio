import React, { useState } from 'react';
import { Check, ChevronDown, FileText } from 'lucide-react';
import { Button } from '../components/ui';
import { FormattedScript } from '../guest/FormattedScript';
import type { ClientScript as Shared } from './api';

interface Props {
  script: Shared;
  /** Said when the answer could not be sent */
  onApprove: () => Promise<void>;
  onRequest: (text: string) => Promise<void>;
  /** The client asked to see this version (from a card in the thread) */
  open: boolean;
  onToggle: () => void;
}

/** The script as the producer shared it, with the two answers a client can give: approve it, or say what to change. */
export const ClientScript: React.FC<Props> = ({ script, onApprove, onRequest, open, onToggle }) => {
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (f: () => Promise<void>) => { setBusy(true); setError(''); try { await f(); } catch (e) { setError(e instanceof Error ? e.message : 'That did not go through. Try again.'); } finally { setBusy(false); } };

  return (
    <section aria-label="Script" className="mx-3 mt-3 overflow-hidden rounded-card border border-line bg-surface-1">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2">
        <FileText className="h-4 w-4 shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">Script <span className="font-normal text-ink-dim">· version {script.n}</span></span>
          <span className={`block text-xs ${script.approved ? 'text-ok' : 'text-warn'}`}>{script.approved ? 'You approved this version' : 'Waiting for your approval'}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-ink-dim transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-line">
          <div className="max-h-[50dvh] overflow-y-auto px-4 py-3 text-[15px]"><FormattedScript script={script.text} /></div>
          <div className="border-t border-line bg-surface-0/50 px-3 py-2.5">
            {asking ? (
              <div className="space-y-2">
                <label htmlFor="changes" className="block text-xs font-medium text-ink-dim">What should change?</label>
                <textarea id="changes" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000} autoFocus className="w-full resize-y rounded-card border border-line-strong bg-surface-1 p-2 text-sm text-ink focus:border-accent focus:outline-none" />
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" disabled={busy || !text.trim()} onClick={() => void run(async () => { await onRequest(text.trim()); setText(''); setAsking(false); })}>Send to the producer</Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsking(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" disabled={busy || script.approved} onClick={() => void run(onApprove)} leftIcon={<Check className="h-4 w-4" />}>{script.approved ? 'Approved' : 'Approve script'}</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setAsking(true)}>Request changes</Button>
              </div>
            )}
            {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
          </div>
        </div>
      )}
    </section>
  );
};
