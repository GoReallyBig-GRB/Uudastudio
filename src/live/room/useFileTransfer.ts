import { useCallback, useEffect, useRef, useState } from 'react';
import { createStreamedWriter } from '../../assets/streamedWriter';
import { readStreamedFrames } from '../../assets/streamedStore';
import { markDelivered, pendingTakes } from './takeQueue';
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

export interface ReceivedLine { id: string; guest: string; name: string; fraction: number; done: boolean; error: string | null }

/** The host's side: takes in each guest's full-quality recording and gives it to the workspace as soon as it is complete */
export function useTakeReceiver(view: RoomView, channels: Record<string, RTCDataChannel>, onTake?: (r: RoomRecording) => void) {
  const receivers = useRef(new Map<string, { recv: TakeReceiver; dc: RTCDataChannel | null }>());
  const wired = useRef(new Map<string, RTCDataChannel>());
  const [lines, setLines] = useState<Record<string, ReceivedLine>>({});
  const peersRef = useRef(view.peers); peersRef.current = view.peers;
  const cb = useRef(onTake); cb.current = onTake;
  const nameOf = (id: string) => peersRef.current.find((p) => p.id === id)?.name ?? 'Guest';
  const patch = useCallback((key: string, p: Partial<ReceivedLine>) => setLines((l) => ({ ...l, [key]: { ...(l[key] ?? { id: key, guest: '', name: '', fraction: 0, done: false, error: null }), ...p } })), []);

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
            patch(`${guestId}:${offer.takeId}`, { guest: nameOf(guestId), name: offer.name, fraction: 0, done: false, error: null });
            return w;
          },
          (c: Control) => {
            if (c.t === 'refuse') patch(`${guestId}:${c.takeId}`, { error: c.reason });
            try { if (e.dc?.readyState === 'open') e.dc.send(JSON.stringify(c)); } catch { /* the guest sends again when the channel returns */ }
          },
          (offer, meta) => {
            patch(`${guestId}:${offer.takeId}`, { fraction: 1, done: true });
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

export interface SendState { sending: boolean; fraction: number; pending: number; error: string | null }

/** The guest's side: hands each saved recording to the host in the background, between takes, and carries on if the connection drops */
export function useTakeSender(token: string, view: RoomView, channels: Record<string, RTCDataChannel>, recording: boolean, savedCount: number): SendState {
  const [state, setState] = useState<SendState>({ sending: false, fraction: 0, pending: pendingTakes(token).length, error: null });
  const recordingRef = useRef(recording); recordingRef.current = recording;
  const host = view.peers.find((p) => p.role === 'producer' && p.admitted);
  const dc = host ? channels[host.id] : undefined;
  const ended = view.endedAt !== null;

  useEffect(() => {
    setState((s) => ({ ...s, pending: pendingTakes(token).length }));
    if (!dc || dc.readyState !== 'open' || recording) return;
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
  }, [dc, dc?.readyState, recording, savedCount, token, ended]);

  return state;
}

/** Plain words for the guest's hand-over line */
export const sendLine = (s: SendState): string | null => {
  if (s.error) return s.error;
  if (s.sending) return `Sending your recording to the host… ${Math.round(s.fraction * 100)}%`;
  if (s.pending > 0) return `Your recording is saved on this device and will be sent to the host${s.pending > 1 ? ` (${s.pending} takes)` : ''} when you are connected. Keep this page open.`;
  return null;
};
