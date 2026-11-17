import { useCallback, useEffect, useRef, useState } from 'react';
import { CallManager, watchLevel } from './callManager';
import { LABEL, type LinkStats, type Quality } from './callPlan';
import type { RoomView } from './roomState';

export interface CallView {
  joined: boolean;
  starting: boolean;
  error: string | null;
  muted: boolean;
  relay: boolean;
  myLevel: number;
  streams: Record<string, MediaStream>;
  quality: Record<string, { q: Quality; label: string; relayed: boolean }>;
}
const empty: CallView = { joined: false, starting: false, error: null, muted: false, relay: false, myLevel: 0, streams: {}, quality: {} };

const micError = (e: unknown): string => {
  const n = (e as { name?: string })?.name;
  if (n === 'NotAllowedError') return 'The microphone is blocked. Allow it in your browser, then try again.';
  if (n === 'NotFoundError') return 'No microphone was found.';
  return 'The microphone could not be started.';
};

/** The voice call for one person in the room */
export function useCall(token: string, view: RoomView, send: (m: Record<string, unknown>) => boolean) {
  const [call, setCall] = useState<CallView>(empty);
  const mgr = useRef<CallManager | null>(null);
  const stopLevel = useRef<(() => void) | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const meId = view.me?.id ?? '';

  const leave = useCallback(() => {
    stopLevel.current?.(); stopLevel.current = null;
    mgr.current?.close(); mgr.current = null;
    void ctx.current?.close().catch(() => undefined); ctx.current = null;
    setCall(empty);
  }, []);

  const join = useCallback(async () => {
    if (mgr.current || !meId) return;
    setCall({ ...empty, starting: true });
    try {
      const r = await fetch(`/api/live/ice/${encodeURIComponent(token)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null) as { iceServers: RTCIceServer[]; relay: boolean } | null;
      const m = new CallManager({
        myId: meId,
        iceServers: r?.iceServers ?? [{ urls: 'stun:stun.cloudflare.com:3478' }],
        signal: (to, data) => { send({ t: 'signal', to, data }); },
        onRemote: (id, stream) => setCall((c) => { const streams = { ...c.streams }; if (stream) streams[id] = stream; else delete streams[id]; return { ...c, streams }; }),
        onQuality: (id, q, s: LinkStats) => setCall((c) => ({ ...c, quality: { ...c.quality, [id]: { q, label: LABEL[q], relayed: s.relayed } } })),
      });
      const local = await m.start();
      mgr.current = m;
      const ac = new AudioContext();
      ctx.current = ac;
      stopLevel.current = watchLevel(ac, local, (v) => setCall((c) => (Math.abs(c.myLevel - v) > 0.03 ? { ...c, myLevel: v } : c)));
      setCall({ ...empty, joined: true, relay: Boolean(r?.relay) });
    } catch (e) {
      mgr.current?.close(); mgr.current = null;
      setCall({ ...empty, error: micError(e) });
    }
  }, [meId, token, send]);

  // Keep the connections matched to who is in the call
  useEffect(() => { if (call.joined && view.me) mgr.current?.sync(view.peers, view.me.admitted); }, [call.joined, view.peers, view.me]);
  useEffect(() => leave, [leave]);

  const mute = useCallback((m: boolean) => { mgr.current?.setMuted(m); setCall((c) => ({ ...c, muted: m })); send({ t: 'state', muted: m }); }, [send]);
  const onSignal = useCallback((from: string, data: unknown) => { void mgr.current?.handleSignal(from, data); }, []);
  return { call, join, leave, mute, onSignal };
}
