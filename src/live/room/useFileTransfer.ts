import { useCallback, useEffect, useRef, useState } from 'react';
import { createStreamedWriter } from '../../assets/streamedWriter';
import { readStreamedFrames, type StreamedMeta } from '../../assets/streamedStore';
import { ActivityWatch } from './activityWatch';
import { SessionBackup } from './sessionBackup';
import { AlignedSink, padFramesFor } from './transfer';
import { markDelivered, pendingTakes, uploading } from './takeQueue';
import { TakeReceiver, TakeSender, type Control, type TakeOffer } from './transfer';
import type { RoomView } from './roomState';
import type { RoomRecording } from './roomRecorder';

/** Keeps track of the open recording-hand-over channels, by person */
export function useFileChannels() {
  const [channels, setChannels] = useState<Record<string, RTCDataChannel>>({});
  const onChannel = useCallback((id: string, ch: RTCDataChannel | null) => {
    setChannels((c) => { if (ch) return c[id] === ch ? c : { ...c, [id]: ch }; if (!(id in c)) return c; const n = { ...c }; delete n[id]; return n; });
  }, []);
  return { channels, onChannel };
}

export interface ReceivedLine { id: string; guestId: string; takeId: string; guest: string; name: string; fraction: number; done: boolean; error: string | null; offeredSeconds: number | null; roomStartMs: number; /** Loudness record of what the guest sent, once it is all here */ env: Uint8Array | null }

/** The host's side: takes in each guest's full-quality recording and gives it to the workspace as soon as it is complete */
export function useTakeReceiver(view: RoomView, channels: Record<string, RTCDataChannel>, hostStartOf: (takeId: string) => number | null, onTake?: (r: RoomRecording) => void) {
  const sinks = useRef(new Map<string, AlignedSink>());
  const hostStart = useRef(hostStartOf); hostStart.current = hostStartOf;
  const receivers = useRef(new Map<string, { recv: TakeReceiver; dc: RTCDataChannel | null }>());
  const wired = useRef(new Map<string, RTCDataChannel>());
  const [lines, setLines] = useState<Record<string, ReceivedLine>>({});
  const peersRef = useRef(view.peers); peersRef.current = view.peers;
  const cb = useRef(onTake); cb.current = onTake;
  const nameOf = (id: string) => peersRef.current.find((p) => p.id === id)?.name ?? 'Guest';
  const patch = useCallback((key: string, p: Partial<ReceivedLine>) => setLines((l) => ({ ...l, [key]: { ...(l[key] ?? { id: key, guestId: key.split(':')[0], takeId: key.split(':')[1] ?? '', guest: '', name: '', fraction: 0, done: false, error: null, offeredSeconds: null, roomStartMs: 0, env: null }), ...p } })), []);

  useEffect(() => {
    for (const [guestId, dc] of Object.entries(channels)) {
      if (wired.current.get(guestId) === dc) continue;
      wired.current.set(guestId, dc);
      let entry = receivers.current.get(guestId);
      if (!entry) {
        const e: { recv: TakeReceiver; dc: RTCDataChannel | null } = { dc, recv: null as unknown as TakeReceiver };
        e.recv = new TakeReceiver(
          async (offer: TakeOffer) => {
            const storeId = `live-${offer.takeId}-${Math.random().toString(36).slice(2, 7)}`;
            const w = await createStreamedWriter(storeId, offer.sampleRate, offer.channels);
            const aligned = new AlignedSink(w, padFramesFor(offer.roomStartMs, hostStart.current(offer.takeId), offer.sampleRate), offer.sampleRate, offer.channels);
            sinks.current.set(`${guestId}:${offer.takeId}`, aligned);
            patch(`${guestId}:${offer.takeId}`, { guest: nameOf(guestId), name: offer.name, fraction: 0, done: false, error: null, offeredSeconds: offer.frames / offer.sampleRate, roomStartMs: offer.roomStartMs, env: null });
            return aligned;
          },
          (c: Control) => {
            if (c.t === 'refuse') patch(`${guestId}:${c.takeId}`, { error: c.reason });
            try { if (e.dc?.readyState === 'open') e.dc.send(JSON.stringify(c)); } catch { /* the guest sends again when the channel returns */ }
          },
          (offer, meta) => {
            patch(`${guestId}:${offer.takeId}`, { fraction: 1, done: true, env: sinks.current.get(`${guestId}:${offer.takeId}`)?.envelope.bins ?? null });
            cb.current?.({ takeId: offer.takeId, name: `${nameOf(guestId)}: ${offer.name}`, startAt: offer.startAt, roomStartMs: offer.roomStartMs, take: { kind: 'streamed', meta } });
          },
        );
        receivers.current.set(guestId, e); entry = e;
      }
      entry.dc = dc;
      const e = entry;
      dc.onmessage = (m) => {
        if (typeof m.data === 'string') void e.recv.onText(m.data);
        else if (m.data instanceof ArrayBuffer) {
          void e.recv.onBinary(m.data).then(() => { const p = e.recv.progress; if (p) patch(`${guestId}:${p.takeId}`, { fraction: p.fraction }); });
        }
      };
    }
    for (const [guestId, dc] of [...wired.current]) if (channels[guestId] !== dc) { wired.current.delete(guestId); const e = receivers.current.get(guestId); if (e && e.dc === dc) e.dc = null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels]);

  // Leaving the room: throw away anything half-received
  useEffect(() => () => { receivers.current.forEach((e) => { void e.recv.close(); }); receivers.current.clear(); }, []);
  return Object.values(lines);
}

export interface SendState { sending: boolean; fraction: number; pending: number; error: string | null; /** Set when the recording is going up to the server rather than straight to the host */ viaServer?: boolean }

/** The guest's side: hands each saved recording to the host in the background, between takes, and carries on if the connection drops */
export function useTakeSender(token: string, view: RoomView, channels: Record<string, RTCDataChannel>, recording: boolean, savedCount: number, relayed: boolean): SendState {
  const [state, setState] = useState<SendState>({ sending: false, fraction: 0, pending: pendingTakes(token).length, error: null });
  const recordingRef = useRef(recording); recordingRef.current = recording;
  const host = view.peers.find((p) => p.role === 'producer' && p.admitted);
  const dc = host ? channels[host.id] : undefined;
  const ended = view.endedAt !== null;

  useEffect(() => {
    setState((s) => ({ ...s, pending: pendingTakes(token).length }));
    // On the shared relay the big file does not travel over the call (that would use the free relay allowance): it goes up over HTTPS instead, see useDrop.ts
    if (!dc || dc.readyState !== 'open' || recording || relayed) return;
    let cancelled = false;
    let cur: ReturnType<typeof pendingTakes>[number] | null = null;
    const sender = new TakeSender(
      { sendText: (s) => { try { dc.send(s); } catch { /* closing */ } }, sendBinary: (b) => { try { dc.send(b); } catch { /* closing */ } }, buffered: () => dc.bufferedAmount },
      async (start, frames) => { const q = cur; return q ? readStreamedFrames(q.meta.storeId, q.meta.channels, start, frames) : []; },
      { paused: () => recordingRef.current },
    );
    const prev = dc.onmessage;
    dc.onmessage = (m) => { if (typeof m.data === 'string') sender.onText(m.data); };
    void (async () => {
      for (const t of pendingTakes(token)) {
        if (cancelled) return;
        if (uploading.has(t.takeId)) continue;
        cur = t;
        setState((s) => ({ ...s, sending: true, fraction: 0, error: null }));
        const offer: TakeOffer = { takeId: t.takeId, name: t.name, sampleRate: t.meta.sampleRate, channels: t.meta.channels, frames: t.meta.frames, startAt: t.startAt, stopAt: t.stopAt, roomStartMs: t.roomStartMs };
        const res = await sender.send(offer, (f) => { if (!cancelled) setState((s) => ({ ...s, fraction: f })); });
        if (res === 'done') markDelivered(token, t.takeId);
        else { if (!cancelled) setState((s) => ({ ...s, sending: false, error: res === 'refused' ? sender.refusal : null })); if (res === 'refused') return; if (cancelled) return; }
        if (!cancelled) setState((s) => ({ ...s, pending: pendingTakes(token).length }));
      }
      if (!cancelled) setState((s) => ({ ...s, sending: false, pending: pendingTakes(token).length }));
    })();
    return () => { cancelled = true; sender.abort(); dc.onmessage = prev; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dc, dc?.readyState, recording, relayed, savedCount, token, ended]);

  return state;
}

/** Plain words for the guest's hand-over line */
export const sendLine = (s: SendState): string | null => {
  if (s.error) return s.error;
  if (s.sending) return s.viaServer ? `Sending your recording to a safe place for the host… ${Math.round(s.fraction * 100)}%` : `Sending your recording to the host… ${Math.round(s.fraction * 100)}%`;
  if (s.pending > 0) return `Your recording is saved on this device and will be sent to the host${s.pending > 1 ? ` (${s.pending} takes)` : ''} when you are connected. Keep this page open.`;
  return null;
};

export interface ActivityLine { id: string; takeId: string; guestId: string; guest: string; bins: Uint8Array | null; seconds: number; startMs: number; running: boolean }

/** The host's loudness record of each guest during a take. Ten numbers a second, no audio: used to check the guest's full recording is complete and lined up. */
export function useGuestActivity(view: RoomView, streams: Record<string, MediaStream>, clockMs: () => number) {
  const watch = useRef<ActivityWatch | null>(null);
  const live = useRef(new Map<string, { takeId: string; guest: string }>());
  const [lines, setLines] = useState<ActivityLine[]>([]);
  const takeId = view.take?.id ?? null;
  const running = takeId !== null && view.take?.stopAt === null && view.endedAt === null;
  const peersRef = useRef(view.peers); peersRef.current = view.peers;

  const stopAll = useCallback(() => {
    const w = watch.current; watch.current = null;
    if (!w) return;
    const done = w.stopAll();
    const info = new Map(live.current); live.current.clear();
    setLines((l) => l.map((x) => { const r = done.get(x.guestId); return r && info.get(x.guestId)?.takeId === x.takeId ? { ...x, bins: r.bins, seconds: r.seconds, running: false } : x; }));
  }, []);

  useEffect(() => {
    if (!running || !takeId) return;
    if (!watch.current) watch.current = new ActivityWatch();
    const w = watch.current;
    for (const [guestId, stream] of Object.entries(streams)) {
      if (live.current.has(guestId)) continue;
      const guest = peersRef.current.find((p) => p.id === guestId)?.name ?? 'Guest';
      const startMs = clockMs();
      live.current.set(guestId, { takeId, guest });
      setLines((l) => [...l.filter((x) => x.id !== `${takeId}:${guestId}`), { id: `${takeId}:${guestId}`, takeId, guestId, guest, bins: null, seconds: 0, startMs, running: true }]);
      void w.add(guestId, stream, startMs).catch(() => { live.current.delete(guestId); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, takeId, streams]);

  useEffect(() => { if (!running) stopAll(); }, [running, stopAll]);
  useEffect(() => () => stopAll(), [stopAll]);
  return lines;
}

export interface BackupState { running: boolean; seconds: number; result: { meta: StreamedMeta; seconds: number } | null }

/** One file of the whole session on this computer: the host and every guest, mixed. Runs while the host is in the call. */
export function useSessionBackup(enabled: boolean, inCall: boolean, ended: boolean, hostStream: () => MediaStream | null, heard: Record<string, MediaStream>): BackupState {
  const backup = useRef<SessionBackup | null>(null);
  const starting = useRef(false);
  const [state, setState] = useState<BackupState>({ running: false, seconds: 0, result: null });
  const active = enabled && inCall && !ended;

  const stop = useCallback(async () => {
    const b = backup.current; backup.current = null; starting.current = false;
    if (!b) return;
    const seconds = b.seconds;
    const meta = await b.finish().catch(() => null);
    setState({ running: false, seconds, result: meta ? { meta, seconds } : null });
  }, []);

  useEffect(() => {
    if (!active) { void stop(); return; }
    if (backup.current || starting.current) return;
    starting.current = true;
    const b = new SessionBackup();
    void b.begin().then(() => { backup.current = b; starting.current = false; b.add('host', hostStream()); setState({ running: true, seconds: 0, result: null }); }).catch(() => { starting.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stop]);

  useEffect(() => {
    const b = backup.current;
    if (!b) return;
    for (const [id, st] of Object.entries(heard)) b.add(id, st);
    for (const id of b.ids()) if (id !== 'host' && !(id in heard)) b.remove(id);
  }, [heard, state.running]);

  useEffect(() => {
    if (!state.running) return;
    const t = setInterval(() => setState((s) => ({ ...s, seconds: backup.current?.seconds ?? s.seconds })), 5000);
    return () => clearInterval(t);
  }, [state.running]);

  useEffect(() => () => { void stop(); }, [stop]);
  return state;
}
