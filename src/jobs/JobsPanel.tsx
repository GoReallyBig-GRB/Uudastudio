/**
 * Uuda Studio - Jobs panel (sidebar)
 * Voice-talent jobs: a dashboard of every job, a form to make a new one, and each job's message thread.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Briefcase, Check, Copy, Link2Off, Plus, Trash2, X } from 'lucide-react';
import { Button, Input } from '../components/ui';
import { ApiError, audioUrl, createJob, deleteJob, getThread, ping, postMessage, revokeTalentLink, sendReference, type Attachment, type ThreadResponse } from './api';
import { CODE_KEY, STATUS_TEXT, addJob, loadJobs, markRead, removeJob, saveJobs, statusOf, unreadCount, type StoredJob } from './jobsStore';
import { inviteText, nudgeText, talentLink } from './links';
import { ThreadView } from './ThreadView';
import { usePolling } from './usePolling';

interface Props {
  onClose: () => void;
  /** Brings a received take into the project as a new clip */
  onImportFile: (file: File) => Promise<void> | void;
  /** Reports how many unread messages there are in all jobs, for the badge on the sidebar icon */
  onUnread?: (count: number) => void;
}

const base = () => window.location.origin + window.location.pathname;
const lsGet = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* not saved */ } };
const copyText = async (t: string): Promise<boolean> => { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } };

type Summary = { status: keyof typeof STATUS_TEXT; unread: number; lastId: number; failed?: boolean };

export const JobsPanel: React.FC<Props> = ({ onClose, onImportFile, onUnread }) => {
  const [jobs, setJobs] = useState<StoredJob[]>(() => loadJobs(localStorage));
  const [service, setService] = useState<'checking' | 'ok' | 'none'>('checking');
  const [needsCode, setNeedsCode] = useState(false);
  const [temporary, setTemporary] = useState(false);
  const [view, setView] = useState<{ kind: 'list' } | { kind: 'new' } | { kind: 'job'; id: string }>({ kind: 'list' });
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});

  useEffect(() => { saveJobs(localStorage, jobs); }, [jobs]);
  useEffect(() => { void ping().then((p) => { setService(p ? 'ok' : 'none'); setNeedsCode(Boolean(p?.createRequiresCode)); setTemporary(Boolean(p?.temporary)); }); }, []);

  const refreshAll = useCallback(async () => {
    const next: Record<string, Summary> = {};
    await Promise.all(jobs.map(async (j) => {
      try {
        const t = await getThread(j.id, j.producerKey, 0);
        next[j.id] = { status: statusOf(t.messages), unread: unreadCount(t.messages, j.lastRead), lastId: t.lastId };
      } catch (e) {
        next[j.id] = { status: 'waiting', unread: 0, lastId: 0, failed: true };
        if (e instanceof ApiError && e.status === 404) next[j.id].failed = true;
      }
    }));
    setSummaries(next);
  }, [jobs]);
  usePolling(refreshAll, view.kind === 'list' ? 20000 : 60000, service === 'ok' && jobs.length > 0);
  useEffect(() => { onUnread?.(Object.values(summaries).reduce((n, s) => n + s.unread, 0)); }, [summaries, onUnread]);

  const open = jobs.find((j) => view.kind === 'job' && j.id === view.id);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink"><Briefcase className="h-4 w-4 text-accent" />Jobs</div>
        <button type="button" onClick={onClose} aria-label="Close panel" className="rounded-full p-1.5 text-ink-faint hover:bg-white/5 hover:text-ink"><X className="h-4 w-4" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {service === 'none' && <div role="alert" className="mb-3 rounded-card border border-warn/40 bg-warn/10 p-3 text-xs text-ink">Jobs need the Uuda server, and it did not answer. Jobs work on the hosted site. Try again later or open the hosted site.</div>}
        {temporary && <div className="mb-3 rounded-card border border-line-strong bg-surface-2 p-3 text-xs text-ink-dim">This is a test server. Jobs made here disappear when the server restarts.</div>}
        {view.kind === 'list' && (
          <JobList jobs={jobs} summaries={summaries} disabled={service !== 'ok'} onNew={() => setView({ kind: 'new' })} onOpen={(id) => setView({ kind: 'job', id })} />
        )}
        {view.kind === 'new' && (
          <NewJob needsCode={needsCode} onCancel={() => setView({ kind: 'list' })} onCreated={(j) => { setJobs((all) => addJob(all, j)); setView({ kind: 'job', id: j.id }); }} />
        )}
        {view.kind === 'job' && open && (
          <JobDetail
            job={open}
            onBack={() => { setView({ kind: 'list' }); void refreshAll(); }}
            onSeen={(lastId) => setJobs((all) => markRead(all, open.id, lastId))}
            onRemoved={() => { setJobs((all) => removeJob(all, open.id)); setView({ kind: 'list' }); }}
            onImportFile={onImportFile}
          />
        )}
        {view.kind === 'job' && !open && <Button variant="secondary" onClick={() => setView({ kind: 'list' })}>Back to jobs</Button>}
      </div>
    </div>
  );
};

const JobList: React.FC<{ jobs: StoredJob[]; summaries: Record<string, Summary>; disabled: boolean; onNew: () => void; onOpen: (id: string) => void }> = ({ jobs, summaries, disabled, onNew, onOpen }) => (
  <div className="flex flex-col gap-3">
    <Button variant="primary" disabled={disabled} onClick={onNew} leftIcon={<Plus className="h-4 w-4" />}>New job</Button>
    {jobs.length === 0 ? (
      <p className="rounded-card border border-dashed border-line px-3 py-6 text-center text-xs text-ink-faint">No jobs yet. A job is a script you send to a voice talent as a link. They record and send the take back here.</p>
    ) : (
      <ul className="flex flex-col gap-1.5" aria-label="Jobs">
        {jobs.map((j) => {
          const s = summaries[j.id];
          return (
            <li key={j.id}>
              <button type="button" onClick={() => onOpen(j.id)} className="flex w-full items-center gap-2 rounded-card border border-line bg-surface-2 px-3 py-2 text-left hover:border-line-strong hover:bg-surface-3">
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
    )}
  </div>
);

const NewJob: React.FC<{ needsCode: boolean; onCancel: () => void; onCreated: (j: Omit<StoredJob, 'lastRead'>) => void }> = ({ needsCode, onCancel, onCreated }) => {
  const [title, setTitle] = useState('');
  const [producer, setProducer] = useState(() => lsGet('uuda-producer-name'));
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
    try {
      setBusy('Creating the job...');
      const made = await createJob({ title: title.trim(), producer: producer.trim(), script, notes, targetSeconds: minutes.trim() && m > 0 ? m * 60 : undefined }, needsCode ? code.trim() : undefined);
      lsSet('uuda-producer-name', producer.trim());
      if (needsCode) lsSet(CODE_KEY, code.trim());
      if (reference) {
        try { setBusy('Uploading the reference...'); await sendReference(made.jobId, made.producerKey, reference, (f) => setBusy(`Uploading the reference... ${Math.round(f * 100)}%`)); }
        catch (e) { onCreated({ id: made.jobId, producerKey: made.producerKey, title: title.trim(), createdAt: Date.now() }); window.alert(`The job was created, but the reference audio was not added: ${e instanceof Error ? e.message : 'upload failed'}. You can add it again by making a new job.`); return; }
      }
      onCreated({ id: made.jobId, producerKey: made.producerKey, title: title.trim(), createdAt: Date.now() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The job could not be created.');
    } finally { setBusy(''); }
  };

  const area = 'w-full resize-y rounded-card border border-line-strong bg-surface-1 p-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';
  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={onCancel} className="flex items-center gap-1 self-start text-xs text-ink-dim hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" />Jobs</button>
      <h2 className="text-sm font-semibold text-ink">New job</h2>
      <Input label="Job name" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Input label="Your name (shown to the talent)" value={producer} onChange={(e) => setProducer(e.target.value)} />
      <div>
        <label htmlFor="job-script" className="mb-1.5 block text-xs font-medium text-ink-dim">Script</label>
        <textarea id="job-script" rows={7} value={script} onChange={(e) => setScript(e.target.value)} maxLength={20000} placeholder="What the talent reads." className={area} />
      </div>
      <div>
        <label htmlFor="job-notes" className="mb-1.5 block text-xs font-medium text-ink-dim">Director notes</label>
        <textarea id="job-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={6000} placeholder="Tone, pace, pronunciation, anything the talent should know. Shown apart from the script." className={area} />
      </div>
      <Input label="Target length (minutes, optional)" inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      <div>
        <label htmlFor="job-ref" className="mb-1.5 block text-xs font-medium text-ink-dim">Reference audio (optional)</label>
        <input id="job-ref" type="file" accept="audio/*" onChange={(e) => setReference(e.target.files?.[0] ?? null)} className="block w-full text-xs text-ink-dim file:mr-2 file:rounded-full file:border file:border-line-strong file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs file:text-ink" />
        <p className="mt-1 text-[11px] text-ink-faint">A read for the talent to listen to. Up to 80 MB.</p>
      </div>
      {needsCode && <Input label="Code for creating jobs" type="password" value={code} onChange={(e) => setCode(e.target.value)} />}
      {error && <div role="alert" className="text-xs text-danger">{error}</div>}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={!!busy}>Cancel</Button>
        <Button variant="primary" className="flex-1" onClick={() => void submit()} disabled={!!busy}>{busy || 'Create job and get link'}</Button>
      </div>
    </div>
  );
};

const JobDetail: React.FC<{ job: StoredJob; onBack: () => void; onSeen: (lastId: number) => void; onRemoved: () => void; onImportFile: (f: File) => Promise<void> | void }> = ({ job, onBack, onSeen, onRemoved, onImportFile }) => {
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
      onSeen(t.lastId);
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

  const revoke = async () => {
    if (!window.confirm('Stop the current talent link and make a new one? Anyone using the old link is locked out.')) return;
    try { const r = await revokeTalentLink(job.id, job.producerKey); setTalentKey(r.talentKey); flash('new'); } catch (e) { setError(e instanceof Error ? e.message : 'Could not change the link.'); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${job.title}" for good? The thread and all its audio are removed from the server.`)) return;
    try { await deleteJob(job.id, job.producerKey); onRemoved(); } catch (e) {
      if (e instanceof ApiError && e.status === 404) { onRemoved(); return; }
      setError(e instanceof Error ? e.message : 'Could not delete the job.');
    }
  };

  const j = thread?.job;
  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={onBack} className="flex items-center gap-1 self-start text-xs text-ink-dim hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" />Jobs</button>
      <div>
        <h2 className="text-sm font-semibold text-ink">{job.title}</h2>
        <div className="text-[11px] text-ink-dim">{STATUS_TEXT[statusOf(messages)]}</div>
      </div>
      {error && <div role="alert" className="rounded-card border border-danger/40 bg-danger/10 p-2 text-xs text-ink">{error}</div>}
      <div className="rounded-card border border-line bg-surface-2 p-2.5">
        <div className="mb-1.5 text-[11px] font-medium text-ink-dim">Talent link</div>
        <div className="mb-2 max-h-14 overflow-auto break-all font-num text-[10px] text-ink-faint">{link || 'Loading...'}</div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="primary" disabled={!link} onClick={async () => { if (await copyText(inviteText(job.title, j?.producer ?? '', link))) flash('invite'); }} leftIcon={copied === 'invite' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}>{copied === 'invite' ? 'Copied' : 'Copy invite'}</Button>
          <Button size="sm" variant="secondary" disabled={!link} onClick={async () => { if (await copyText(link)) flash('link'); }}>{copied === 'link' ? 'Copied' : 'Copy link only'}</Button>
          <Button size="sm" variant="ghost" disabled={!link} onClick={async () => { if (await copyText(nudgeText(job.title, link))) flash('nudge'); }}>{copied === 'nudge' ? 'Copied' : 'Copy a nudge'}</Button>
        </div>
        <p className="mt-1.5 text-[10px] text-ink-faint">The talent cannot be notified by Uuda. After you reply, send them the nudge by email or WhatsApp. Jobs with no activity for 60 days are deleted.</p>
      </div>
      {j && (
        <details className="rounded-card border border-line bg-surface-2 p-2.5 text-xs">
          <summary className="cursor-pointer font-medium text-ink-dim">Script and notes</summary>
          <div className="mt-2 whitespace-pre-wrap text-ink">{j.script || 'No script.'}</div>
          {j.notes && <div className="mt-2 border-t border-line pt-2 text-ink-dim"><span className="font-semibold">Director notes: </span>{j.notes}</div>}
          {j.reference && <div className="mt-2"><div className="mb-1 text-ink-dim">Reference</div><audio controls preload="none" src={audioUrl(job.id, j.reference.id, job.producerKey)} className="h-9 w-full" /></div>}
        </details>
      )}
      {importing && <div className="text-xs text-ink-dim">Adding {importing} to the project...</div>}
      <ThreadView
        messages={messages}
        self="producer"
        audioSrc={(a) => audioUrl(job.id, a.id, job.producerKey)}
        onImport={(a) => void doImport(a)}
        onSend={async (text) => { await postMessage(job.id, job.producerKey, j?.producer || 'Producer', text); await load(); }}
        placeholder="Reply to the talent"
      />
      <div className="flex flex-wrap gap-1.5 border-t border-line pt-3">
        <Button size="sm" variant="ghost" onClick={() => void revoke()} leftIcon={<Link2Off className="h-3.5 w-3.5" />}>{copied === 'new' ? 'New link made' : 'New talent link'}</Button>
        <Button size="sm" variant="ghost" onClick={() => void remove()} leftIcon={<Trash2 className="h-3.5 w-3.5" />}>Delete job</Button>
      </div>
    </div>
  );
};
