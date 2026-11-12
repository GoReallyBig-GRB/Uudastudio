import { useCallback, useEffect, useRef, useState } from 'react';
import { openLive } from './live';
import { ApiError, getSummary, getThread, ping, type ThreadMessage } from './api';
import { addJob, loadJobs, markRead, markReadClient, removeJob, saveJobs, statusOf, unreadCount, type JobStatus, type StoredJob } from './jobsStore';
import { usePolling } from './usePolling';

const MAX_LIVE = 8;

export interface JobSummary { status: JobStatus; /** Unread from the talent and the client together */ unread: number; clientUnread?: number; lastId: number; failed?: boolean }

/** The producer's jobs: the list kept in this browser, whether the server answers, and each job's status and unread count. Lives in the app so the sidebar badge stays current while no window is open. */
export const useJobs = () => {
  const [jobs, setJobs] = useState<StoredJob[]>(() => loadJobs(localStorage));
  const [service, setService] = useState<'checking' | 'ok' | 'none'>('checking');
  const [needsCode, setNeedsCode] = useState(false);
  const [temporary, setTemporary] = useState(false);
  const [summaries, setSummaries] = useState<Record<string, JobSummary>>({});

  useEffect(() => { saveJobs(localStorage, jobs); }, [jobs]);
  useEffect(() => { void ping().then((p) => { setService(p ? 'ok' : 'none'); setNeedsCode(Boolean(p?.createRequiresCode)); setTemporary(Boolean(p?.temporary)); }); }, []);

  const seen = useRef<Record<string, JobSummary>>({});
  const refresh = useCallback(async () => {
    const next: Record<string, JobSummary> = {};
    let changed = false;
    await Promise.all(jobs.map(async (j) => {
      try {
        let talent: ThreadMessage[], client: ThreadMessage[] = [], lastId: number;
        try {
          // One request for both threads
          const s = await getSummary(j.id, j.producerKey);
          talent = s.talent.messages; client = s.client.messages; lastId = s.talent.lastId;
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 404)) throw e;
          // A server without the summary route: ask for each thread
          const t = await getThread(j.id, j.producerKey, 0);
          talent = t.messages; lastId = t.lastId;
          if (t.keys?.client) { try { client = (await getThread(j.id, j.producerKey, 0, 'client')).messages; } catch { /* the talent thread still counts */ } }
        }
        const clientUnread = unreadCount(client, j.lastReadClient ?? 0);
        next[j.id] = { status: statusOf(talent), unread: unreadCount(talent, j.lastRead) + clientUnread, clientUnread, lastId };
      } catch { next[j.id] = { status: 'waiting', unread: 0, lastId: 0, failed: true }; }
    }));
    changed = JSON.stringify(seen.current) !== JSON.stringify(next);
    seen.current = next;
    if (changed) setSummaries(next);
    return changed;
  }, [jobs]);
  // A live connection per job (the first few), so the badge updates the moment talent or a client writes
  const [liveCount, setLiveCount] = useState(0);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const liveKey = jobs.slice(0, MAX_LIVE).map((j) => `${j.id}:${j.producerKey}`).join(',');
  useEffect(() => {
    if (service !== 'ok' || !liveKey || typeof WebSocket === 'undefined') { setLiveCount(0); return; }
    const open = new Set<string>();
    const closers = liveKey.split(',').map((pair) => {
      const [id, key] = pair.split(':');
      return openLive(id, key, () => { void refreshRef.current(); }, (on) => { if (on) open.add(id); else open.delete(id); setLiveCount(open.size); });
    });
    return () => { closers.forEach((c) => c()); setLiveCount(0); };
  }, [service, liveKey]);
  // With live connections the list only needs a slow safety check; jobs beyond the first few still need the regular one
  usePolling(refresh, 60000, service === 'ok' && jobs.length > 0, liveCount > 0 && liveCount >= Math.min(jobs.length, MAX_LIVE) && jobs.length <= MAX_LIVE);

  const add = useCallback((j: Omit<StoredJob, 'lastRead' | 'lastReadClient'>) => setJobs((all) => addJob(all, j)), []);
  const remove = useCallback((id: string) => { setJobs((all) => removeJob(all, id)); setSummaries((s) => { const { [id]: _gone, ...rest } = s; return rest; }); }, []);
  const markSeen = useCallback((id: string, lastId: number, status?: JobStatus) => {
    setJobs((all) => markRead(all, id, lastId));
    setSummaries((s) => {
      const cur = s[id];
      if (!cur || (cur.unread === 0 && (!status || cur.status === status))) return s;
      return { ...s, [id]: { ...cur, unread: 0, status: status ?? cur.status, failed: false } };
    });
  }, []);

  const markClientSeen = useCallback((id: string, lastId: number) => {
    setJobs((all) => markReadClient(all, id, lastId));
    setSummaries((s) => {
      const cur = s[id];
      if (!cur || !cur.clientUnread) return s;
      return { ...s, [id]: { ...cur, unread: Math.max(0, cur.unread - cur.clientUnread), clientUnread: 0 } };
    });
  }, []);

  const unread = Object.values(summaries).reduce((n, s) => n + s.unread, 0);
  return { jobs, service, needsCode, temporary, summaries, unread, refresh, add, remove, markSeen, markClientSeen };
};
export type JobsState = ReturnType<typeof useJobs>;
