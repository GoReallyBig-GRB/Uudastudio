import React, { useEffect, useState } from 'react';
import { Briefcase, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import { Button, ModalShell } from '../components/ui';
import { JobRows, NewJob } from './JobParts';
import { JobDetail } from './JobDetail';
import type { JobsState } from './useJobs';

export type JobsTarget = { kind: 'new' } | { kind: 'job'; id: string } | null;

interface Props {
  open: boolean;
  onClose: () => void;
  jobs: JobsState;
  /** What to show when the window opens: a job, the new-job form, or nothing selected */
  target: JobsTarget;
  onImportFile: (file: File) => Promise<void> | void;
}

/** The Jobs workspace: every job on the left; the new-job form, or one job with its script, notes, link and message thread, on the right. */
export const JobsModal: React.FC<Props> = ({ open, onClose, jobs, target, onImportFile }) => {
  const [view, setView] = useState<JobsTarget>(target);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('uuda.jobs.sidebar') === 'closed'; } catch { return false; } });
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem('uuda.jobs.sidebar', c ? 'open' : 'closed'); } catch { /* not saved */ } return !c; });
  useEffect(() => { if (open) { setView(target); void jobs.refresh(); } }, [open, target]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = view?.kind === 'job' ? jobs.jobs.find((j) => j.id === view.id) : undefined;

  return (
    <ModalShell open={open} onClose={onClose} title="Jobs" description="Send scripts to voice talent, receive their takes, and keep the conversation in one place" variant="workspace" closeOnBackdrop={false} blockShortcuts>
      <div className={`grid min-h-0 flex-1 transition-[grid-template-columns] ${collapsed ? 'grid-cols-[48px_minmax(0,1fr)]' : 'grid-cols-[280px_minmax(0,1fr)]'}`}>
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-r border-line bg-surface-0/40 p-2" aria-label="All jobs">
          <button type="button" onClick={toggle} aria-label={collapsed ? 'Show the job list' : 'Hide the job list'} aria-expanded={!collapsed} title={collapsed ? 'Show the job list' : 'Hide the job list'} className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-dim hover:bg-white/5 hover:text-ink ${collapsed ? 'mx-auto' : 'self-end'}`}>{collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}</button>
          {collapsed ? (
            <Button variant="primary" size="sm" className="!h-8 !w-8 !p-0 mx-auto" aria-label="New job" title="New job" disabled={jobs.service !== 'ok'} onClick={() => setView({ kind: 'new' })}><Plus className="h-4 w-4" /></Button>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pb-2">
              <Button variant="primary" disabled={jobs.service !== 'ok'} onClick={() => setView({ kind: 'new' })} leftIcon={<Plus className="h-4 w-4" />}>New job</Button>
              {jobs.service === 'none' && <div role="alert" className="rounded-card border border-warn/40 bg-warn/10 p-2.5 text-xs text-ink">The jobs server did not answer. Jobs work on the hosted site. Try again later.</div>}
              {jobs.temporary && <div className="rounded-card border border-line-strong bg-surface-2 p-2.5 text-xs text-ink-dim">This is a test server. Jobs made here disappear when it restarts.</div>}
              {jobs.jobs.length === 0 ? (
                <p className="rounded-card border border-dashed border-line px-3 py-6 text-center text-xs text-ink-faint">No jobs yet. A job is a script you send to a voice talent as a link. They record and send the take back here.</p>
              ) : (
                <JobRows jobs={jobs.jobs} summaries={jobs.summaries} selectedId={current?.id} onOpen={(id) => setView({ kind: 'job', id })} />
              )}
            </div>
          )}
        </aside>
        <section className="min-h-0 overflow-y-auto" aria-label="Job">
          {view?.kind === 'new' && (
            <NewJob
              needsCode={jobs.needsCode}
              onCancel={() => setView(null)}
              onCreated={(j) => { jobs.add(j); setView({ kind: 'job', id: j.id }); }}
            />
          )}
          {view?.kind === 'job' && current && (
            <JobDetail key={current.id} job={current} onSeen={(lastId, status) => jobs.markSeen(current.id, lastId, status)} onClientSeen={(lastId) => jobs.markClientSeen(current.id, lastId)} onRemoved={() => { jobs.remove(current.id); setView(null); }} onImportFile={onImportFile} />
          )}
          {(!view || (view.kind === 'job' && !current)) && (
            <div className="grid h-full place-items-center p-8 text-center">
              <div className="max-w-sm">
                <Briefcase className="mx-auto mb-3 h-8 w-8 text-ink-faint" aria-hidden />
                <h3 className="text-sm font-semibold text-ink">Pick a job, or start a new one</h3>
                <p className="mt-1 text-xs text-ink-dim">Each job has its own script, notes, talent link and message thread.</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </ModalShell>
  );
};
