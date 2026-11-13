import React, { useCallback, useRef, useState } from 'react';
import { Lock, Unlock } from 'lucide-react';
import { ClientScript } from './ClientScript';
import { ApiError, approveScript, audioUrl, getClientThread, postMessage, requestScriptChanges, type ClientJobInfo, type ThreadMessage } from './api';
import { parseClientHash } from './links';
import { SaveMenu } from './SaveMenu';
import { ThreadView } from './ThreadView';
import { expiryLine } from './saveFile';
import { usePolling } from './usePolling';
import { useLive } from './live';

const NAME_KEY = 'uuda-client-name';
const read = (): string => { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } };
const write = (v: string) => { try { localStorage.setItem(NAME_KEY, v); } catch { /* private window */ } };

/**
 * What a reviewing client opens: the preview to listen to, the final file (locked until the producer releases it), and a message
 * thread with the producer. The client never sees the script, the talent or the talent's takes (the server enforces that).
 */
const ClientPage: React.FC = () => {
  const link = parseClientHash(window.location.hash);
  const [job, setJob] = useState<ClientJobInfo | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [error, setError] = useState('');
  const [name, setName] = useState(read);
  const last = useRef(0);
  const [scriptOpen, setScriptOpen] = useState(false);
  const autoOpened = useRef(false);
  const jobSig = useRef('');

  const load = useCallback(async () => {
    if (!link) return;
    try {
      const t = await getClientThread(link.jobId, link.key, last.current);
      const sig = JSON.stringify(t.job);
      const unchanged = sig === jobSig.current && !t.messages.length;
      jobSig.current = sig;
      setJob(t.job); setError('');
      if (t.job.script && !t.job.script.approved && !autoOpened.current) { autoOpened.current = true; setScriptOpen(true); }
      if (t.messages.length) {
        last.current = t.messages[t.messages.length - 1].id;
        setMessages((all) => [...all, ...t.messages.filter((m) => !all.some((x) => x.id === m.id))]);
      }
      return !unchanged;
    } catch (e) { setError(e instanceof ApiError && (e.status === 403 || e.status === 404 || e.limit) ? e.message : 'Could not reach the server. Trying again...'); }
  }, [link?.jobId, link?.key]);
  const live = useLive(link?.jobId, link?.key, (c) => { if (c !== 'talent') void load(); }, !!link);
  usePolling(load, 6000, !!link, live);

  if (!link) return <div className="grid h-dvh place-items-center bg-surface-0 p-6 text-center text-sm text-ink-dim">This review link is not valid. Ask the producer for a new one.</div>;
  const src = (id: string) => audioUrl(link.jobId, id, link.key);
  const pv = expiryLine(job?.preview?.expiresAt);
  const fin = job?.final ? expiryLine(job.final.expiresAt) : null;

  const who = name.trim() || 'Client';
  const files = (
    <>
      {job?.script && (
        <ClientScript
          script={job.script}
          open={scriptOpen}
          onToggle={() => setScriptOpen((o) => !o)}
          onApprove={async () => { await approveScript(link.jobId, link.key, job.script!.n, who); await load(); }}
          onRequest={async (text) => { await requestScriptChanges(link.jobId, link.key, job.script!.n, text, who); await load(); }}
        />
      )}
      <section aria-label="Files" className="mx-3 mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-card border border-line bg-surface-1 p-3">
          <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-dim">Preview</h2>
          {job?.preview ? (
            <>
              <audio controls preload="metadata" controlsList="nodownload" src={src(job.preview.id)} className="h-10 w-full" aria-label="Preview" />
              <p className="mt-1.5 text-[11px] text-ink-faint">For listening and comments only.{pv ? ` ${pv.text.replace(' Save your own copy.', '')}` : ''}</p>
            </>
          ) : <p className="text-sm text-ink-dim">{job ? 'Not added yet. This page updates by itself.' : ''}</p>}
        </div>
        <div className="rounded-card border border-line bg-surface-1 p-3">
          <h2 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-dim">{job?.released ? <Unlock className="h-3.5 w-3.5 text-ok" aria-hidden /> : <Lock className="h-3.5 w-3.5" aria-hidden />}Final file</h2>
          {job?.final ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1 text-sm"><div className="truncate font-medium">{job.final.name}</div>{fin && <div className="text-[11px] text-ink-faint">{fin.text}</div>}</div>
              <SaveMenu look="button" label="Save final" name={job.final.name} folder={['Jobs', job.title]} getBlob={async () => { const r = await fetch(src(job.final!.id)); if (!r.ok) throw new Error('The file could not be downloaded.'); return r.blob(); }} />
            </div>
          ) : <p className="text-sm text-ink-dim">{job?.finalReady ? 'Ready. Released here once everything is agreed.' : 'Appears here once everything is agreed.'}</p>}
        </div>
      </section>
      <div className="mx-3 mt-3 flex items-center gap-2 text-xs text-ink-dim">
        <label htmlFor="client-name" className="shrink-0">Writing as</label>
        <input id="client-name" value={name} onChange={(e) => { setName(e.target.value); write(e.target.value); }} maxLength={40} placeholder="Your name" className="h-8 min-w-0 flex-1 rounded-control border border-line bg-surface-1 px-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none sm:max-w-[14rem]" />
      </div>
    </>
  );

  return (
    <div className="flex h-dvh flex-col bg-surface-0 text-ink">
      <header className="shrink-0 border-b border-line bg-surface-1 px-4 py-2.5">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3">
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-gold-soft text-sm font-bold text-gold">U</span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold leading-tight">{job?.title ?? 'Loading...'}</h1>
            <div className="truncate text-[11px] text-ink-dim">{job?.producer ? `with ${job.producer} · ` : ''}UUDA <span className="text-gold">STUDIO</span></div>
          </div>
        </div>
      </header>
      {error && <div role="alert" className="mx-auto w-full max-w-2xl px-3 pt-3"><div className="rounded-card border border-warn/40 bg-warn/10 p-3 text-sm">{error}</div></div>}
      <main className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
        <ThreadView fill header={files} messages={messages} self="client" audioSrc={(a) => src(a.id)} folder={['Jobs', job?.title ?? 'Review']}
          onOpenScript={() => setScriptOpen(true)}
          onSend={async (text) => { await postMessage(link.jobId, link.key, who, text); await load(); }} placeholder="Write to the producer" />
      </main>
    </div>
  );
};

export default ClientPage;
