/** The parts of the Jobs workspace: the status list and the new-job form. One job is in JobDetail. */
import React, { useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { Button, Input } from '../components/ui';
import { AUDIO_ACCEPT, createJob, sendReference } from './api';
import { CODE_KEY, STATUS_TEXT, type StoredJob } from './jobsStore';
import type { JobSummary } from './useJobs';
import { ScriptEditor } from '../components/ui/ScriptEditor';

const lsGet = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* not saved */ } };
const AREA = 'w-full resize-y rounded-card border border-line-strong bg-surface-1 p-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

const DOT: Record<string, string> = { waiting: 'bg-ink-faint', talking: 'bg-warn', take: 'bg-ok' };

/** One row per job: name, status, unread count */
export const JobRows: React.FC<{ jobs: StoredJob[]; summaries: Record<string, JobSummary>; selectedId?: string; onOpen: (id: string) => void }> = ({ jobs, summaries, selectedId, onOpen }) => (
  <ul className="flex flex-col gap-1" aria-label="Jobs">
    {jobs.map((j) => {
      const s = summaries[j.id];
      const on = selectedId === j.id;
      return (
        <li key={j.id}>
          <button type="button" aria-current={on ? 'true' : undefined} onClick={() => onOpen(j.id)} className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${on ? 'border-accent/50 bg-accent-soft' : 'border-transparent hover:bg-surface-3'}`}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${s?.failed ? 'bg-warn' : DOT[s?.status ?? 'waiting']}`} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{j.title}</span>
              <span className={`block truncate text-[11px] ${s?.failed ? 'text-warn' : 'text-ink-dim'}`}>{s ? (s.failed ? 'Could not load' : STATUS_TEXT[s.status]) : 'Checking...'}</span>
            </span>
            {s && s.unread > 0 && <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-ink" aria-label={`${s.unread} unread`}>{s.unread}</span>}
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
  const refInput = useRef<HTMLInputElement>(null);
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
        <p className="text-xs text-ink-dim">Write what the talent reads. You send them the link from the job once it exists.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Job name" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Input label="Your name (shown to the talent)" value={producer} onChange={(e) => setProducer(e.target.value)} />
        <Input label="Talent name (optional)" value={talent} onChange={(e) => setTalent(e.target.value)} hint="Their takes are labelled with it and they are never asked for a name." />
      </div>
      <div>
        <label htmlFor="job-script" className="mb-1.5 block text-xs font-medium text-ink-dim">Script</label>
        <ScriptEditor id="job-script" rows={10} value={script} onChange={setScript} maxLength={20000} placeholder="What the talent reads." />
      </div>
      <div>
        <label htmlFor="job-notes" className="mb-1.5 block text-xs font-medium text-ink-dim">Director notes</label>
        <textarea id="job-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={6000} placeholder="Tone, pace, pronunciation, anything the talent should know. Shown apart from the script." className={AREA} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Target length (minutes, optional)" inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        <div>
          <label htmlFor="job-ref" className="mb-1.5 block text-xs font-medium text-ink-dim">Reference audio (optional)</label>
          <input ref={refInput} id="job-ref" type="file" accept={AUDIO_ACCEPT} hidden onChange={(e) => { setReference(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          {reference ? (
            <div className="flex items-center gap-2 rounded-control border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink">
              <span className="min-w-0 flex-1 truncate">{reference.name}</span>
              <span className="shrink-0 text-ink-faint">{(reference.size / 1048576).toFixed(1)} MB</span>
              <button type="button" onClick={() => setReference(null)} aria-label="Remove the reference audio" title="Remove" disabled={!!busy} className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-ink-dim hover:bg-surface-3 hover:text-ink disabled:opacity-40"><X className="h-3.5 w-3.5" /></button>
            </div>
          ) : (
            <Button type="button" size="sm" variant="secondary" onClick={() => refInput.current?.click()} leftIcon={<Upload className="h-3.5 w-3.5" />}>Choose a file</Button>
          )}
          <p className="mt-1 text-[11px] text-ink-faint">A read for the talent to listen to. Up to 80 MB.</p>
        </div>
      </div>
      {needsCode && <Input label="Code for creating jobs" type="password" value={code} onChange={(e) => setCode(e.target.value)} />}
      {error && <div role="alert" className="text-xs text-danger">{error}</div>}
      <div className="flex gap-2">
        {onCancel && <Button variant="ghost" onClick={onCancel} disabled={!!busy}>Cancel</Button>}
        <Button variant="primary" onClick={() => void submit()} disabled={!!busy}>{busy || 'Create job'}</Button>
      </div>
    </div>
  );
};
