import { useCallback, useEffect, useRef, useState } from 'react';
import { CallManager, watchLevel } from './callManager';
import { LABEL, type LinkStats, type Quality } from './callPlan';
import { HostMixer, type MixCtx, type StripSettings } from './hostMixer';
import { liveSettings } from '../settings/liveSettings';
import { DESK_MESSAGES, deskVerdict, measureDesk } from './deskCheck';
import type { RoomView } from './roomState';

export interface CallView {
  joined: boolean;
  starting: boolean;
  error: string | null;
  muted: boolean;
  relay: boolean;
  /** The shared relay is full for this month, so only direct connections are possible */
  relayFull: boolean;
  myLevel: number;
  /** Broadcast desk (host only): each guest's strip settings */
  strips: Record<string, StripSettings>;
  /** What the desk check said, when it had something to say */
  deskNote: string | null;
  streams: Record<string, MediaStream>;
  quality: Record<string, { q: Quality; label: string; relayed: boolean }>;
}
const empty: CallView = { joined: false, starting: false, error: null, muted: false, relay: false, relayFull: false, myLevel: 0, strips: {}, deskNote: null, streams: {}, quality: {} };

const micError = (e: unknown): string => {
  const n = (e as { name?: string })?.name;
  if (n === 'NotAllowedError') return 'The microphone is blocked. Allow it in your browser, then try again.';
  if (n === 'NotFoundError') return 'No microphone was found.';
  return 'The microphone could not be started.';
};

/** The voice call for one person in the room */
export function useCall(token: string, view: RoomView, send: (m: Record<string, unknown>) => boolean, onFiles?: (id: string, channel: RTCDataChannel | null) => void) {
  const [heard, setHeard] = useState<Record<string, MediaStream>>({});
  const [holdingFiles, setHoldingFilesState] = useState(false);
  const holdingSet = (v: boolean) => setHoldingFilesState(v);
  const filesRef = useRef(onFiles); filesRef.current = onFiles;
  const [call, setCall] = useState<CallView>(empty);
  const mgr = useRef<CallManager | null>(null);
  const stopLevel = useRef<(() => void) | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const meId = view.me?.id ?? '';
  const mixer = useRef<HostMixer | null>(null);
  const programEl = useRef<HTMLAudioElement | null>(null);
  const joinedAs = useRef<{ mode: string; headphones: boolean } | null>(null);
  const holdingRef = useRef(false);
  const [programDevice, setProgramDeviceState] = useState('');

  const leave = useCallback((keepFiles = false) => {
    stopLevel.current?.(); stopLevel.current = null;
    if (keepFiles === true && mgr.current && joinedAs.current?.mode !== undefined) {
      // Leaving the call, but recordings are still on their way to the host: drop the sound, keep the connection until they are delivered
      mgr.current.closeAudio();
      mixer.current?.close(); mixer.current = null;
      void ctx.current?.close().catch(() => undefined); ctx.current = null;
      holdingRef.current = true; holdingSet(true);
      setCall(empty);
      return;
    }
    holdingRef.current = false; holdingSet(false);
    setHeard({});
    mgr.current?.close(); mgr.current = null;
    mixer.current?.close(); mixer.current = null;
    if (programEl.current) { programEl.current.srcObject = null; programEl.current = null; }
    setProgramDeviceState('');
    joinedAs.current = null;
    void ctx.current?.close().catch(() => undefined); ctx.current = null;
    setCall(empty);
  }, []);

  const join = useCallback(async (headphones = true, deviceId?: string) => {
    if (mgr.current && holdingRef.current) { mgr.current.close(); mgr.current = null; holdingRef.current = false; holdingSet(false); }
    if (mgr.current || !meId || !view.me) return;
    setCall({ ...empty, starting: true });
    try {
      const role = view.me.role;
      let mode = view.mode;
      let deskNote: string | null = null;
      if (mode === 'broadcast' && role === 'producer') {
        // The host's computer runs the desk: check it can before anyone relies on it
        const verdict = deskVerdict(await measureDesk().catch(() => Infinity));
        deskNote = DESK_MESSAGES[verdict];
        if (verdict === 'too-slow') { send({ t: 'mode', mode: 'conversation' }); mode = 'conversation'; }
      }
      const ac = new AudioContext();
      await ac.resume().catch(() => undefined);
      ctx.current = ac;
      const desk = mode === 'broadcast' && role === 'producer' ? new HostMixer(ac as unknown as MixCtx) : null;
      mixer.current = desk;
      const prefs = liveSettings.get();
      desk?.setProgramIncludesHost(prefs.programContains === 'all');
      const r = await fetch(`/api/live/ice/${encodeURIComponent(token)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null) as { iceServers: RTCIceServer[]; relay: boolean; capped?: boolean } | null;
      const m = new CallManager({
        myId: meId, role, mode, headphones, mixer: desk ?? undefined, quality: prefs.quality, stripDefaults: prefs.guestStrip,
        iceServers: r?.iceServers ?? [{ urls: 'stun:stun.cloudflare.com:3478' }],
        signal: (to, data) => { send({ t: 'signal', to, data }); },
        onFiles: (id, ch) => filesRef.current?.(id, ch),
        onHeard: (id, st) => setHeard((h) => { if (st) return { ...h, [id]: st }; if (!(id in h)) return h; const n = { ...h }; delete n[id]; return n; }),
        onRemote: (id, stream) => setCall((c) => { const streams = { ...c.streams }; if (stream) streams[id] = stream; else delete streams[id]; return { ...c, streams }; }),
        onQuality: (id, q, s: LinkStats) => setCall((c) => ({ ...c, quality: { ...c.quality, [id]: { q, label: LABEL[q], relayed: s.relayed } } })),
      });
      const local = await m.start(deviceId);
      mgr.current = m;
      joinedAs.current = { mode, headphones };
      stopLevel.current = watchLevel(ac, local, (v) => setCall((c) => (Math.abs(c.myLevel - v) > 0.03 ? { ...c, myLevel: v } : c)));
      setCall({ ...empty, joined: true, deskNote, strips: {}, relay: Boolean(r?.relay), relayFull: Boolean(r?.capped) });
    } catch (e) {
      mgr.current?.close(); mgr.current = null;
      setCall({ ...empty, error: micError(e) });
    }
  }, [meId, token, send, view.me, view.mode]);

  // Keep the connections matched to who is in the call
  useEffect(() => { if (call.joined && view.me) mgr.current?.sync(view.peers, view.me.admitted); }, [call.joined, view.peers, view.me]);
  useEffect(() => leave, [leave]);

  // The host stepped a broadcast down to a conversation: everyone reconnects the conversation way
  const again = useRef(false);
  useEffect(() => {
    const j = joinedAs.current;
    if (!call.joined || !j || j.mode === view.mode || again.current) return;
    again.current = true;
    const hp = j.headphones;
    leave();
    setTimeout(() => { again.current = false; void join(hp); }, 300);
  }, [call.joined, view.mode, leave, join]);

  const setProgramHost = useCallback((on: boolean) => { mixer.current?.setProgramIncludesHost(on); }, []);
  const setStrip = useCallback((id: string, patch: Partial<StripSettings>) => {
    const s = mixer.current?.setStrip(id, patch);
    if (s) setCall((c) => ({ ...c, strips: { ...c.strips, [id]: s } }));
  }, []);
  const level = useCallback((id: string) => mixer.current?.level(id) ?? { level: 0, clipping: false }, []);
  /** Sends the finished mix (what goes on air) to a chosen sound device. An empty id turns it off. */
  const setProgramDevice = useCallback(async (deviceId: string): Promise<boolean> => {
    const m = mixer.current;
    if (!m) return false;
    if (!deviceId) { if (programEl.current) { programEl.current.pause(); programEl.current.srcObject = null; } setProgramDeviceState(''); return false; }
    const el = programEl.current ?? new Audio();
    programEl.current = el;
    el.srcObject = m.program;
    try { await (el as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId(deviceId); await el.play(); setProgramDeviceState(deviceId); return true; }
    catch { setCall((c) => ({ ...c, error: 'This browser cannot send sound to that device. Use Chrome or Edge on a computer.' })); return false; }
  }, []);

  const mute = useCallback((m: boolean) => { mgr.current?.setMuted(m); setCall((c) => ({ ...c, muted: m })); send({ t: 'state', muted: m }); }, [send]);
  const onSignal = useCallback((from: string, data: unknown) => { void mgr.current?.handleSignal(from, data); }, []);
  return { call, heard, holdingFiles, hostStream: () => mgr.current?.stream ?? null, join, leave, mute, onSignal, setStrip, level, setProgramDevice, programDevice, setProgramHost, isDesk: () => mixer.current !== null };
}
