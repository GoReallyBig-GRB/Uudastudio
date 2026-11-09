/**
 * Uuda Studio - Jobs panel (sidebar)
 * A short list of voice-talent jobs with their status and unread counts. Everything else happens in the Jobs window.
 */
import React from 'react';
import { Briefcase, Maximize2, Plus, X } from 'lucide-react';
import { Button } from '../components/ui';
import { JobRows } from './JobParts';
import type { JobsState } from './useJobs';

interface Props {
  jobs: JobsState;
  onClose: () => void;
  /** Opens the Jobs window on a job, on the new-job form, or on nothing */
  onOpenWindow: (target: { kind: 'new' } | { kind: 'job'; id: string } | null) => void;
}

export const JobsPanel: React.FC<Props> = ({ jobs, onClose, onOpenWindow }) => (
  <div className="flex h-full min-h-0 flex-col">
    <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink"><Briefcase className="h-4 w-4 text-accent" />Jobs</div>
      <button type="button" onClick={onClose} aria-label="Close panel" className="rounded-full p-1.5 text-ink-faint hover:bg-white/5 hover:text-ink"><X className="h-4 w-4" /></button>
    </div>
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex gap-2">
        <Button variant="primary" size="sm" className="flex-1" disabled={jobs.service !== 'ok'} onClick={() => onOpenWindow({ kind: 'new' })} leftIcon={<Plus className="h-4 w-4" />}>New job</Button>
        <Button variant="secondary" size="sm" onClick={() => onOpenWindow(null)} leftIcon={<Maximize2 className="h-3.5 w-3.5" />} title="Open the Jobs window">Open</Button>
      </div>
      {jobs.service === 'none' && <div role="alert" className="rounded-card border border-warn/40 bg-warn/10 p-3 text-xs text-ink">The jobs server did not answer. Jobs work on the hosted site. Try again later.</div>}
      {jobs.temporary && <div className="rounded-card border border-line-strong bg-surface-2 p-3 text-xs text-ink-dim">This is a test server. Jobs made here disappear when it restarts.</div>}
      {jobs.jobs.length === 0 ? (
        <p className="rounded-card border border-dashed border-line px-3 py-6 text-center text-xs text-ink-faint">No jobs yet. A job is a script you send to a voice talent as a link. They record and send the take back.</p>
      ) : (
        <JobRows jobs={jobs.jobs} summaries={jobs.summaries} onOpen={(id) => onOpenWindow({ kind: 'job', id })} />
      )}
    </div>
  </div>
);
