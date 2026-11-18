import { useCallback, useEffect, useMemo, useState } from 'react';
import { LiveApiError, createEvent, deleteEvent, listEvents, type LiveQuota, setEventOpen, updateEvent, uploadEventFile, deleteEventFile, type EventDraft } from './api';
import { stateNow, type LiveEvent } from './events';

export type LiveService = 'signin' | 'checking' | 'ok' | 'none';

/** The producer's live events. The clock ticks every 20 s so "starts in" and "live now" stay right without asking the server. */
export const useLiveEvents = (signedIn: boolean) => {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [service, setService] = useState<LiveService>(signedIn ? 'checking' : 'signin');
  const [now, setNow] = useState(() => Date.now());
  const [quota, setQuota] = useState<LiveQuota | null>(null);

  const refresh = useCallback(async () => {
    if (!signedIn) { setService('signin'); setEvents([]); return; }
    try { const r = await listEvents(); setEvents(r.events); setQuota(r.quota ?? null); setService('ok'); }
    catch (e) { setService(e instanceof LiveApiError && e.status === 401 ? 'signin' : 'none'); }
  }, [signedIn]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 20_000); return () => clearInterval(t); }, []);
  // Reload when the window comes back, so events made on another device show up
  useEffect(() => { const f = () => { if (document.visibilityState === 'visible') void refresh(); }; document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f); }, [refresh]);

  const live = useMemo(() => events.map((e) => ({ ...e, state: stateNow(e, now) })), [events, now]);
  const put = (e: LiveEvent) => setEvents((all) => (all.some((x) => x.id === e.id) ? all.map((x) => (x.id === e.id ? e : x)) : [e, ...all]));

  return {
    events: live, service, now, refresh, quota,
    create: async (d: EventDraft, files: File[] = []) => {
      let e = await createEvent(d);
      for (const f of files) { try { const meta = await uploadEventFile(e.id, f); e = { ...e, files: [...e.files, meta] }; } catch (err) { put(e); throw err; } }
      put(e); return e;
    },
    update: async (id: string, d: EventDraft, add: File[] = [], removeIds: string[] = []) => {
      let e = await updateEvent(id, d);
      for (const fid of removeIds) { await deleteEventFile(id, fid); e = { ...e, files: e.files.filter((f) => f.id !== fid) }; }
      for (const f of add) { const meta = await uploadEventFile(id, f); e = { ...e, files: [...e.files, meta] }; }
      put(e); return e;
    },
    remove: async (id: string) => { await deleteEvent(id); setEvents((all) => all.filter((e) => e.id !== id)); },
    setOpen: async (id: string, open: boolean) => { const e = await setEventOpen(id, open); put(e); return e; },
  };
};
export type LiveState = ReturnType<typeof useLiveEvents>;
