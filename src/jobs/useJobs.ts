import { useCallback, useEffect, useState } from 'react';
import { getThread, ping } from './api';
import { addJob, loadJobs, markRead, removeJob, saveJobs, statusOf, unreadCount, type JobStatus, type StoredJob } from './jobsStore';
import { usePolling } from './usePolling';

export interface JobSummary { status: JobStatus; unread: number; lastId: number; failed?: boolean }

/** The producer's jobs: the list kept in this browser, whether the server answers, and each job's status and unread count. Lives in the app so the sidebar badge stays current while no window is open. */
export const useJobs = () => {
  const [jobs, setJobs] = useState<StoredJob[]>(() => loadJobs(localStorage));
  const [service, setService] = useState<'checking' | 'ok' | 'none'>('checking');
  const [needsCode, setNeedsCode] = useState(false);
  const [temporary, setTemporary] = useState(false);
  const [summaries, setSummaries] = useState<Record<string, JobSummary>>({});

  useEffect(() => { saveJobs(localStorage, jobs); }, [jobs]);
  useEffect(() => { void ping().then((p) => { setService(p ? 'ok' : 'none'); setNeedsCode(Boolean(p?.createRequiresCode)); setTemporary(Boolean(p?.temporary)); }); }, []);

  const refresh = useCallback(async () => {
    const next: Record<string, JobSummary> = {};
    await Promise.all(jobs.map(async (j) => {
      try {
        const t = await getThread(j.id, j.producerKey, 0);
        next[j.id] = { status: statusOf(t.messages), unread: unreadCount(t.messages, j.lastRead), lastId: t.lastId };
      } catch { next[j.id] = { status: 'waiting', unread: 0, lastId: 0, failed: true }; }
    }));
    setSummaries(next);
  }, [jobs]);
  usePolling(refresh, 60000, service === 'ok' && jobs.length > 0);

  const add = useCallback((j: Omit<StoredJob, 'lastRead'>) => setJobs((all) => addJob(all, j)), []);
  const remove = useCallback((id: string) => { setJobs((all) => removeJob(all, id)); setSummaries((s) => { const { [id]: _gone, ...rest } = s; return rest; }); }, []);
  const markSeen = useCallback((id: string, lastId: number, status?: JobStatus) => {
    setJobs((all) => markRead(all, id, lastId));
    setSummaries((s) => {
      const cur = s[id];
      if (!cur || (cur.unread === 0 && (!status || cur.status === status))) return s;
      return { ...s, [id]: { ...cur, unread: 0, status: status ?? cur.status, failed: false } };
    });
  }, []);

  const unread = Object.values(summaries).reduce((n, s) => n + s.unread, 0);
  return { jobs, service, needsCode, temporary, summaries, unread, refresh, add, remove, markSeen };
};
export type JobsState = ReturnType<typeof useJobs>;
