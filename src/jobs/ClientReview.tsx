import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Link2Off, Lock, Unlock, Upload } from 'lucide-react';
import { Button } from '../components/ui';
import { ApiError, createClientLink, sendFinal, sendPreview, setReleased, type Attachment, type JobInfo } from './api';
import { clientInviteText, clientLink } from './links';
import { expiryLine } from './saveFile';

const base = () => window.location.origin + window.location.pathname;
const copyText = async (t: string): Promise<boolean> => { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } };

interface Props {
  jobId: string;
  title: string;
  producerKey: string;
  clientKey: string;
  onClientKey: (k: string) => void;
  /** What the server says about the job (preview, final, released) */
  info: JobInfo | undefined;
  /** Ask the parent to reload the job from the server */
  reload: () => Promise<void>;
}

/** The producer's controls for a client: their link, the preview they listen to, the final file, and the Release switch. */
export const ClientReview: React.FC<Props> = ({ jobId, title, producerKey, clientKey, onClientKey, info, reload }) => {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [armed, setArmed] = useState<'' | 'newlink' | 'release'>('');
  const previewInput = useRef<HTMLInputElement>(null);
  const finalInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!armed) return; const t = window.setTimeout(() => setArmed(''), 4000); return () => window.clearTimeout(t); }, [armed]);
  const link = useMemo(() => (clientKey ? clientLink(base(), jobId, clientKey) : ''), [clientKey, jobId]);
  const flash = (w: string) => { setCopied(w); window.setTimeout(() => setCopied(''), 2200); };
  const fail = (e: unknown) => setError(e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Try again.');

  const makeLink = async () => {
    if (clientKey && armed !== 'newlink') { setArmed('newlink'); return; }
    setArmed(''); setError('');
    try { onClientKey((await createClientLink(jobId, producerKey)).clientKey); flash('new'); } catch (e) { fail(e); }
  };
  const upload = async (kind: 'preview' | 'final', f: File | undefined) => {
    if (!f) return;
    setError(''); setBusy(`Uploading ${f.name}... 0%`);
    try {
      await (kind === 'preview' ? sendPreview : sendFinal)(jobId, producerKey, f, (p) => setBusy(`Uploading ${f.name}... ${Math.round(p * 100)}%`));
      await reload();
    } catch (e) { fail(e); } finally { setBusy(''); }
  };
  const release = async (value: boolean) => {
    if (value && armed !== 'release') { setArmed('release'); return; }
    setArmed(''); setError('');
    try { await setReleased(jobId, producerKey, value); await reload(); } catch (e) { fail(e); }
  };

  const file = (a: Attachment | null | undefined, empty: string) => {
    if (!a) return <span className="text-ink-dim">{empty}</span>;
    const e = expiryLine(a.expiresAt);
    return <span className="min-w-0"><span className="block truncate text-ink">{a.name}</span>{e && <span className={`block text-[11px] ${e.soon ? 'text-warn' : 'text-ink-faint'}`}>{e.text.replace(' Save your own copy.', '')}</span>}</span>;
  };
  const released = !!info?.released;

  return (
    <section className="rounded-card border border-line bg-surface-2 p-3" aria-label="Client review">
      <div className="mb-1.5 text-xs font-medium text-ink-dim">Client review</div>
      <p className="mb-2 text-[11px] text-ink-faint">The client listens to a preview and messages you on their own page. They never see the script, the talent or the takes.</p>

      <div className="mb-3">
        {link ? (
          <>
            <div className="mb-2 max-h-16 overflow-auto break-all font-num text-[10px] text-ink-faint">{link}</div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="primary" onClick={async () => { if (await copyText(clientInviteText(title, info?.producer ?? '', link))) flash('invite'); }} leftIcon={copied === 'invite' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}>{copied === 'invite' ? 'Copied' : 'Copy invite'}</Button>
              <Button size="sm" variant="secondary" onClick={async () => { if (await copyText(link)) flash('link'); }}>{copied === 'link' ? 'Copied' : 'Copy link only'}</Button>
              <Button size="sm" variant="ghost" onClick={() => void makeLink()} leftIcon={<Link2Off className="h-3.5 w-3.5" />}>{copied === 'new' ? 'New link made' : armed === 'newlink' ? 'Tap again: old link stops working' : 'New client link'}</Button>
            </div>
          </>
        ) : <Button size="sm" variant="primary" onClick={() => void makeLink()}>Create client link</Button>}
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0"><div className="text-[11px] font-semibold uppercase tracking-wider text-ink-dim">Preview</div>{file(info?.preview, 'Nothing yet. The client hears this.')}</div>
          <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => previewInput.current?.click()} leftIcon={<Upload className="h-3.5 w-3.5" />}>{info?.preview ? 'Replace' : 'Add'}</Button>
          <input ref={previewInput} type="file" accept="audio/*" hidden aria-label="Preview file" onChange={(e) => { void upload('preview', e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0"><div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">{released ? <Unlock className="h-3 w-3 text-ok" aria-hidden /> : <Lock className="h-3 w-3" aria-hidden />}Final file · {released ? 'released' : 'locked'}</div>{file(info?.final, 'Nothing yet. Stays locked until you release it.')}</div>
          <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => finalInput.current?.click()} leftIcon={<Upload className="h-3.5 w-3.5" />}>{info?.final ? 'Replace' : 'Add'}</Button>
          <input ref={finalInput} type="file" accept="audio/*" hidden aria-label="Final file" onChange={(e) => { void upload('final', e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        {info?.final && (
          released
            ? <Button size="sm" variant="ghost" onClick={() => void release(false)}>Lock the final again</Button>
            : <Button size="sm" variant={armed === 'release' ? 'danger' : 'primary'} onClick={() => void release(true)}>{armed === 'release' ? 'Tap again: the client can download it' : 'Release final to the client'}</Button>
        )}
        <p className="text-[11px] text-ink-faint">Release it once the client has paid. Uuda does not handle payments. Replacing the final locks it again. Files are deleted 30 days after upload.</p>
      </div>
      {busy && <div role="status" className="mt-2 text-xs text-ink-dim">{busy}</div>}
      {error && <div role="alert" className="mt-2 text-xs text-danger">{error}</div>}
    </section>
  );
};
