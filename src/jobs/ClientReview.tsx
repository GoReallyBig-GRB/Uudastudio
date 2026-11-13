import React, { useEffect, useRef, useState } from 'react';
import { Lock, Unlock, Upload } from 'lucide-react';
import { Button } from '../components/ui';
import { ApiError, sendFinal, sendPreview, setReleased, type Attachment, type JobInfo } from './api';
import { expiryLine } from './saveFile';

interface Props {
  jobId: string;
  producerKey: string;
  /** What the server says about the job (preview, final, released) */
  info: JobInfo | undefined;
  /** Ask the parent to reload the job from the server */
  reload: () => Promise<void | boolean>;
}

/** The files the client gets: the preview they listen to, and the final, which stays locked until the producer releases it. */
export const ClientFiles: React.FC<Props> = ({ jobId, producerKey, info, reload }) => {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [armed, setArmed] = useState(false);
  const previewInput = useRef<HTMLInputElement>(null);
  const finalInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!armed) return; const t = window.setTimeout(() => setArmed(false), 4000); return () => window.clearTimeout(t); }, [armed]);
  const fail = (e: unknown) => setError(e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Try again.');

  const upload = async (kind: 'preview' | 'final', f: File | undefined) => {
    if (!f) return;
    setError(''); setBusy(`Uploading ${f.name}... 0%`);
    try {
      await (kind === 'preview' ? sendPreview : sendFinal)(jobId, producerKey, f, (p) => setBusy(`Uploading ${f.name}... ${Math.round(p * 100)}%`));
      await reload();
    } catch (e) { fail(e); } finally { setBusy(''); }
  };
  const release = async (value: boolean) => {
    if (value && !armed) { setArmed(true); return; }
    setArmed(false); setError('');
    try { await setReleased(jobId, producerKey, value); await reload(); } catch (e) { fail(e); }
  };
  const meta = (a: Attachment | null | undefined, empty: string) => {
    if (!a) return <span className="text-ink-faint">{empty}</span>;
    const e = expiryLine(a.expiresAt);
    return <span className="min-w-0"><span className="block truncate text-ink">{a.name}</span>{e && <span className={`block text-[11px] ${e.soon ? 'text-warn' : 'text-ink-faint'}`}>{e.text.replace(' Save your own copy.', '')}</span>}</span>;
  };
  const released = !!info?.released;
  const row = 'flex items-center justify-between gap-3 py-2.5';

  return (
    <div>
      <div className={`${row} border-b border-line`}>
        <div className="min-w-0 text-sm"><div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">Preview for the client</div>{meta(info?.preview, 'None yet')}</div>
        <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => previewInput.current?.click()} leftIcon={<Upload className="h-3.5 w-3.5" />}>{info?.preview ? 'Replace' : 'Add'}</Button>
        <input ref={previewInput} type="file" accept="audio/*" hidden aria-label="Preview file" onChange={(e) => { void upload('preview', e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <div className={row}>
        <div className="min-w-0 text-sm"><div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">{released ? <Unlock className="h-3 w-3 text-ok" aria-hidden /> : <Lock className="h-3 w-3" aria-hidden />}Final file{released ? ' · released' : info?.final ? ' · locked' : ''}</div>{meta(info?.final, 'None yet')}</div>
        <div className="flex shrink-0 items-center gap-1.5">
          {info?.final && (released
            ? <Button size="sm" variant="ghost" onClick={() => void release(false)}>Lock</Button>
            : <Button size="sm" variant={armed ? 'danger' : 'primary'} onClick={() => void release(true)}>{armed ? 'Tap again to release' : 'Release'}</Button>)}
          <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => finalInput.current?.click()} leftIcon={<Upload className="h-3.5 w-3.5" />}>{info?.final ? 'Replace' : 'Add'}</Button>
        </div>
        <input ref={finalInput} type="file" accept="audio/*" hidden aria-label="Final file" onChange={(e) => { void upload('final', e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {busy && <div role="status" className="text-xs text-ink-dim">{busy}</div>}
      {error && <div role="alert" className="mt-1 text-xs text-danger">{error}</div>}
    </div>
  );
};
