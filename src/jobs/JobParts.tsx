/** The parts of the Jobs workspace: the new-job form, the status list and one job with its thread. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Copy, Link2Off, Trash2 } from 'lucide-react';
import { Button, Input } from '../components/ui';
import { ApiError, audioUrl, createJob, deleteJob, getThread, postMessage, revokeTalentLink, sendReference, type Attachment, type ThreadResponse } from './api';
import { CODE_KEY, STATUS_TEXT, statusOf, type JobStatus, type StoredJob } from './jobsStore';
import type { JobSummary } from './useJobs';
import { inviteText, nudgeText, talentLink } from './links';
import { ThreadView } from './ThreadView';
import { ScriptEditor } from '../components/ui/ScriptEditor';
import { FormattedScript } from '../guest/FormattedScript';
import { usePolling } from './usePolling';

const base = () => window.location.origin + window.location.pathname;
const lsGet = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* not saved */ } };
const copyText = async (t: string): Promise<boolean> => { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } };
const AREA = 'w-full resize-y rounded-card border border-line-strong bg-surface-1 p-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

/** One row per job: name, status, unread count */
export const JobRows: React.FC<{ jobs: StoredJob[]; summaries: Record<string, JobSummary>; selectedId?: string; onOpen: (id: string) => void }> = ({ jobs, summaries, selectedId, onOpen }) => (
  <ul className="flex flex-col gap-1.5" aria-label="Jobs">
    {jobs.map((j) => {
      const s = summaries[j.id];
      return (
        <li key={j.id}>
          <button type="button" aria-current={selectedId === j.id ? 'true' : undefined} onClick={() => onOpen(j.id)} className={`flex w-full items-center gap-2 rounded-card border px-3 py-2 text-left hover:border-line-strong hover:bg-surface-3 ${selectedId === j.id ? 'border-accent/50 bg-surface-3' : 'border-line bg-surface-2'}`}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{j.title}</span>
              <span className={`block truncate text-[11px] ${s?.failed ? 'text-warn' : 'text-ink-dim'}`}>{s ? (s.failed ? 'Could not load' : STATUS_TEXT[s.status]) : 'Checking...'}</span>
            </span>
            {s && s.unread > 0 && <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-surface-0" aria-label={`${s.unread} unread`}>{s.unread}</span>}
          </button>
        </li>
      );
    })}
  </ul>
);

export const NewJob: React.FC<{ needsCode: boolean; onCancel?: () => void; onCreated: (j: Omit<StoredJob, 'lastRead'>) => void }> = ({ needsCode, onCancel, onCreated }) => {
  const [title, setTitle] = useState('');
  const [producer, setProducer] = useState(() => lsGet('uuda-producer-name'));
  const [talent, setTalent] = useState('');
  const [script, setScript] = useState('');
  const [notes, setNotes] = useState('');
  const [minutes, setMinutes] = useState('');
  const [reference, setReference] = useState<File | null>(null);
  const [code, setCode] = useState(() => lsGet(CODE_KEY));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (!title.trim()) { setError('Give the job a name.'); return; }
    if (needsCode && !code.trim()) { setError('Type the code for creating jobs.'); return; }
    const m = Number(minutes);
    let made: Awaited<ReturnType<typeof createJob>> | null = null;
    try {
      setBusy('Creating the job...');
      made = await createJob({ title: title.trim(), producer: producer.trim(), talent: talent.trim(), script, notes, targetSeconds: minutes.trim() && m > 0 ? m * 60 : undefined }, needsCode ? code.trim() : undefined);
      lsSet('uuda-producer-name', producer.trim());
      if (needsCode) lsSet(CODE_KEY, code.trim());
      if (reference) {
        setBusy('Uploading the reference...');
        await sendReference(made.jobId, made.producerKey, reference, (f) => setBusy(`Uploading the reference... ${Math.round(f * 100)}%`));
      }
      onCreated({ id: made.jobId, producerKey: made.producerKey, title: title.trim(), createdAt: Date.now() });
    } catch (e) {
      const why = e instanceof Error ? e.message : 'Something went wrong.';
      if (made) {
        // The job exists; only the reference failed. Keep the job so nothing is lost.
        onCreated({ id: made.jobId, producerKey: made.producerKey, title: title.trim(), createdAt: Date.now() });
        window.alert(`The job was created, but the reference audio was not added: ${why}`);
      } else setError(why);
    } finally { setBusy(''); }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <div>
        <h2 className="text-base font-semibold text-ink">New job</h2>
        <p className="text-xs text-ink-dim">Write what the talent reads, add notes and an optional reference, then send them the link.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Job name" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Input label="Your name (shown to the talent)" value={producer} onChange={(e) => setProducer(e.target.value)} />
        <Input label="Talent name (optional)" value={talent} onChange={(e) => setTalent(e.target.value)} hint="Their takes are labelled with it and they are never asked for a name." />
      </div>
      <div>
        <label htmlFor="job-script" className="mb-1.5 block text-xs font-medium text-ink-dim">Script</label>
        <ScriptEditor id="job-script" rows={10} value={script} onChange={setScript} maxLength={20000} placeholder="What the talent reads. Put directions in [square brackets]." />
      </div>
      <div>
        <label htmlFor="job-notes" className="mb-1.5 block text-xs font-medium text-ink-dim">Director notes</label>
        <textarea id="job-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={6000} placeholder="Tone, pace, pronunciation, anything the talent should know. Shown apart from the script." className={AREA} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Target length (minutes, optional)" inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        <div>
          <label htmlFor="job-ref" className="mb-1.5 block text-xs font-medium text-ink-dim">Reference audio (optional)</label>
          <input id="job-ref" type="file" accept="audio/*" onChange={(e) => setReference(e.target.files?.[0] ?? null)} className="block w-full text-xs text-ink-dim file:mr-2 file:rounded-full file:border file:border-line-strong file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs file:text-ink" />
          <p className="mt-1 text-[11px] text-ink-faint">A read for the talent to listen to. Up to 80 MB.</p>
        </div>
      </div>
      {needsCode && <Input label="Code for creating jobs" type="password" value={code} onChange={(e) => setCode(e.target.value)} />}
      {error && <div role="alert" className="text-xs text-danger">{error}</div>}
      <div className="flex gap-2">
        {onCancel && <Button variant="ghost" onClick={onCancel} disabled={!!busy}>Cancel</Button>}
        <Button variant="primary" onClick={() => void submit()} disabled={!!busy}>{busy || 'Create job and get link'}</Button>
      </div>
    </div>
  );
};

interface DetailProps {
  job: StoredJob;
  onSeen: (lastId: number, status: JobStatus) => void;
  onRemoved: () => void;
  onImportFile: (f: File) => Promise<void> | void;
  onBack?: () => void;
}

/** One job: link controls, script and notes on the left, the message thread on the right */
export const JobDetail: React.FC<DetailProps> = ({ job, onSeen, onRemoved, onImportFile, onBack }) => {
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [messages, setMessages] = useState<ThreadResponse['messages']>([]);
  const [error, setError] = useState('');
  const [talentKey, setTalentKey] = useState('');
  const [copied, setCopied] = useState('');
  const [importing, setImporting] = useState('');

  const load = useCallback(async () => {
    const after = messages.length ? messages[messages.length - 1].id : 0;
    try {
      const t = await getThread(job.id, job.producerKey, after);
      setThread(t); setError('');
      if (t.keys?.talent) setTalentKey(t.keys.talent);
      if (t.messages.length) setMessages((all) => [...all, ...t.messages.filter((m) => !all.some((x) => x.id === m.id))]);
      onSeen(t.lastId, statusOf([...messages, ...t.messages]));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load this job.'); }
  }, [job.id, job.producerKey, messages, onSeen]);
  usePolling(load, 6000);

  const link = useMemo(() => (talentKey ? talentLink(base(), job.id, talentKey) : ''), [talentKey, job.id]);
  const flash = (what: string) => { setCopied(what); window.setTimeout(() => setCopied(''), 2200); };

  const doImport = async (a: Attachment) => {
    setImporting(a.name);
    try {
      const r = await fetch(audioUrl(job.id, a.id, job.producerKey));
      if (!r.ok) throw new Error('The file could not be downloaded.');
      await onImportFile(new File([await r.blob()], a.name, { type: a.mime }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add the file.'); } finally { setImporting(''); }
  };
  // Browser pop-up questions are blocked inside some embedded previews, so the buttons ask by changing their own label
  const [armed, setArmed] = useState<'' | 'revoke' | 'delete'>('');
  useEffect(() => { if (!armed) return; const t = window.setTimeout(() => setArmed(''), 4000); return () => window.clearTimeout(t); }, [armed]);
  const revoke = async () => {
    if (armed !== 'revoke') { setArmed('revoke'); return; }
    setArmed(''); setError('');
    try { const r = await revokeTalentLink(job.id, job.producerKey); setTalentKey(r.talentKey); flash('new'); } catch (e) { setError(e instanceof Error ? e.message : 'Could not change the link.'); }
  };
  const remove = async () => {
    if (armed !== 'delete') { setArmed('delete'); return; }
    setArmed('');
    try { await deleteJob(job.id, job.producerKey); onRemoved(); } catch (e) {
      if (e instanceof ApiError && e.status === 404) { onRemoved(); return; }
      setError(e instanceof Error ? e.message : 'Could not delete the job.');
    }
  };

  const j = thread?.job;
  const status = statusOf(messages);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-3">
        <div className="min-w-0">
          {onBack && <button type="button" onClick={onBack} className="mb-1 flex items-center gap-1 text-xs text-ink-dim hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" />Jobs</button>}
          <h2 className="truncate text-base font-semibold text-ink">{job.title}</h2>
          <div className="text-xs text-ink-dim">{STATUS_TEXT[status]}{j?.producer ? ` · from ${j.producer}` : ''}</div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => void revoke()} leftIcon={<Link2Off className="h-3.5 w-3.5" />}>{copied === 'new' ? 'New link made' : armed === 'revoke' ? 'Tap again: old link stops working' : 'New talent link'}</Button>
          <Button size="sm" variant="ghost" onClick={() => void remove()} leftIcon={<Trash2 className="h-3.5 w-3.5" />}>{armed === 'delete' ? 'Tap again: delete job and audio' : 'Delete job'}</Button>
        </div>
      </div>
      {error && <div role="alert" className="mx-6 mt-3 rounded-card border border-danger/40 bg-danger/10 p-2 text-xs text-ink">{error}</div>}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="min-h-0 space-y-4 overflow-y-auto border-r border-line p-6">
          <section className="rounded-card border border-line bg-surface-2 p-3" aria-label="Talent link">
            <div className="mb-1.5 text-xs font-medium text-ink-dim">Talent link</div>
            <div className="mb-2 max-h-16 overflow-auto break-all font-num text-[10px] text-ink-faint">{link || 'Loading...'}</div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="primary" disabled={!link} onClick={async () => { if (await copyText(inviteText(job.title, j?.producer ?? '', link))) flash('invite'); }} leftIcon={copied === 'invite' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}>{copied === 'invite' ? 'Copied' : 'Copy invite'}</Button>
              <Button size="sm" variant="secondary" disabled={!link} onClick={async () => { if (await copyText(link)) flash('link'); }}>{copied === 'link' ? 'Copied' : 'Copy link only'}</Button>
              <Button size="sm" variant="ghost" disabled={!link} onClick={async () => { if (await copyText(nudgeText(job.title, link))) flash('nudge'); }}>{copied === 'nudge' ? 'Copied' : 'Copy a nudge'}</Button>
            </div>
            <p className="mt-2 text-[11px] text-ink-faint">Uuda cannot notify the talent. After you reply, send them the nudge by email or WhatsApp. Jobs with no activity for 60 days are deleted.</p>
          </section>
          {j && (
            <>
              <section aria-label="Script">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-dim">Script</h3>
                <div className="rounded-card border border-line bg-surface-2 p-3 text-sm">{j.script ? <FormattedScript script={j.script} /> : <span className="text-ink-dim">No script.</span>}</div>
              </section>
              {j.notes && (
                <section aria-label="Director notes">
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-dim">Director notes</h3>
                  <div className="whitespace-pre-wrap rounded-card border border-line bg-surface-2 p-3 text-sm text-ink-dim">{j.notes}</div>
                </section>
              )}
              {j.reference && (
                <section aria-label="Reference audio">
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-dim">Reference</h3>
                  <audio controls preload="none" src={audioUrl(job.id, j.reference.id, job.producerKey)} className="w-full" />
                </section>
              )}
            </>
          )}
        </div>
        <div className="flex min-h-0 flex-col p-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-dim">Messages</h3>
          {importing && <div className="mb-2 text-xs text-ink-dim">Adding {importing} to the project...</div>}
          <div className="min-h-0 flex-1">
            <ThreadView
              fill
              messages={messages}
              self="producer"
              folder={['Jobs', job.title]}
              audioSrc={(a) => audioUrl(job.id, a.id, job.producerKey)}
              onImport={(a) => void doImport(a)}
              onSend={async (text) => { await postMessage(job.id, job.producerKey, j?.producer || 'Producer', text); await load(); }}
              placeholder="Reply to the talent"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
