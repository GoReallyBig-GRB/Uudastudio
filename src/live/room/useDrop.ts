import { useEffect, useRef, useState } from 'react';
import { createStreamedWriter } from '../../assets/streamedWriter';
import { readStreamedFrames } from '../../assets/streamedStore';
import { AlignedSink, padFramesFor, type TakeOffer } from './transfer';
import { collectTake, getTicket, listHeld, uploadTake, type DropIO } from './dropClient';
import { markDelivered, pendingTakes, setTicket, uploading } from './takeQueue';
import type { RoomRecording } from './roomRecorder';
import type { SendState } from './useFileTransfer';

const base = (token: string): DropIO => ({ fetchFn: (i, o) => fetch(i, { credentials: 'same-origin', ...o }), base: `/api/live/drop/${token}` });

/** How long the direct route may be missing before the recording goes up to the server instead */
const GRACE_MS = 20_000;
const RETRY_MS = 15_000;

/**
 * The guest's fallback. If the host cannot be reached directly (they are not here, or the call runs on the shared relay), the saved recording goes
 * up over HTTPS to a safe place the host collects from. Works after the guest leaves the room. Repeats until it succeeds.
 */
export function useTakeUploader(token: string, guestName: string, recording: boolean, savedCount: number, directReady: boolean, inRoom: boolean): SendState {
  const [state, setState] = useState<SendState>({ sending: false, fraction: 0, pending: pendingTakes(token).length, error: null });
  const [tick, setTick] = useState(0);
  const [late, setLate] = useState(false);

  // Ask for permission to upload while the room is still open: it lasts 8 days, so a reload or a closed event cannot stop the upload
  useEffect(() => {
    if (!inRoom) return;
    let off = false;
    void (async () => { for (const t of pendingTakes(token)) { if (off) return; if (!t.ticket) { const k = await getTicket(base(token), t.takeId); if (k) setTicket(token, t.takeId, k); } } })();
    return () => { off = true; };
  }, [inRoom, savedCount, token]);

  useEffect(() => {
    if (directReady) { setLate(false); return; }
    const t = setTimeout(() => setLate(true), pendingTakes(token).length ? GRACE_MS : 0);
    return () => clearTimeout(t);
  }, [directReady, savedCount, token]);

  useEffect(() => {
    if (!late || directReady || recording) return;
    let cancelled = false;
    const io = base(token);
    void (async () => {
      for (const t of pendingTakes(token)) {
        if (cancelled) return;
        let ticket = t.ticket ?? null;
        if (!ticket && inRoom) { ticket = await getTicket(io, t.takeId); if (ticket) setTicket(token, t.takeId, ticket); }
        if (!ticket) { if (!cancelled) setState((s) => ({ ...s, error: null })); continue; }
        uploading.add(t.takeId);
        setState((s) => ({ ...s, sending: true, fraction: 0, error: null }));
        const offer: TakeOffer = { takeId: t.takeId, name: t.name, sampleRate: t.meta.sampleRate, channels: t.meta.channels, frames: t.meta.frames, startAt: t.startAt, stopAt: t.stopAt, roomStartMs: t.roomStartMs };
        const out = await uploadTake(io, ticket, guestName, offer, (a, n) => readStreamedFrames(t.meta.storeId, t.meta.channels, a, n), (f) => { if (!cancelled) setState((s) => ({ ...s, fraction: f })); }, () => cancelled);
        uploading.delete(t.takeId);
        if (out.result === 'done') markDelivered(token, t.takeId, undefined, true);
        if (cancelled) return;
        setState((s) => ({ ...s, sending: false, error: out.result === 'refused' ? out.message : null, pending: pendingTakes(token).length }));
        if (out.result === 'retry') { setTimeout(() => { if (!cancelled) setTick((n) => n + 1); }, RETRY_MS); return; }
      }
      setState((s) => ({ ...s, sending: false, pending: pendingTakes(token).length }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [late, directReady, recording, savedCount, token, tick]);

  return { ...state, viaServer: true };
}

export interface CollectLine { takeId: string; from: string; name: string; fraction: number; done: boolean; error: string | null }

/** The host's side: takes recordings guests left on the server into the workspace, then tells the server so they are deleted a day later */
export function useDropCollector(token: string, enabled: boolean, have: (takeId: string) => boolean, hostStartOf: (takeId: string) => number | null, onTake?: (r: RoomRecording) => void) {
  const [lines, setLines] = useState<CollectLine[]>([]);
  const busy = useRef(false);
  const done = useRef(new Set<string>());
  const refs = useRef({ have, hostStartOf, onTake }); refs.current = { have, hostStartOf, onTake };

  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const patch = (takeId: string, p: Partial<CollectLine>) => setLines((l) => l.map((x) => (x.takeId === takeId ? { ...x, ...p } : x)));
    const pass = async () => {
      if (busy.current || stop) return;
      busy.current = true;
      try {
        const io = base(token);
        const held = await listHeld(io);
        for (const t of held ?? []) {
          if (stop) return;
          if (t.status !== 'ready' || t.collectedAt !== null || done.current.has(t.takeId)) continue;
          if (refs.current.have(t.takeId)) { // already arrived straight from the guest: just let the server clear its copy
            await fetch(`${io.base}/collected?take=${encodeURIComponent(t.takeId)}`, { method: 'POST' }).catch(() => undefined);
            done.current.add(t.takeId); continue;
          }
          setLines((l) => [...l.filter((x) => x.takeId !== t.takeId), { takeId: t.takeId, from: t.from, name: t.name, fraction: 0, done: false, error: null }]);
          const store = `live-${t.takeId}-${Math.random().toString(36).slice(2, 7)}`;
          const w = await createStreamedWriter(store, t.sampleRate, t.channels);
          const sink = new AlignedSink(w, padFramesFor(t.roomStartMs, refs.current.hostStartOf(t.takeId), t.sampleRate), t.sampleRate, t.channels);
          const ok = await collectTake(io, t, sink, (f) => patch(t.takeId, { fraction: f }));
          if (!ok) { await sink.abort().catch(() => undefined); patch(t.takeId, { error: 'Could not collect this recording yet. Trying again.' }); continue; }
          const meta = await sink.finish();
          done.current.add(t.takeId);
          patch(t.takeId, { fraction: 1, done: true });
          refs.current.onTake?.({ takeId: t.takeId, name: `${t.from}: ${t.name}`, startAt: t.startAt, roomStartMs: t.roomStartMs, take: { kind: 'streamed', meta } });
        }
      } finally { busy.current = false; }
    };
    void pass();
    const id = setInterval(() => void pass(), 30_000);
    return () => { stop = true; clearInterval(id); };
  }, [token, enabled]);
  return lines;
}
