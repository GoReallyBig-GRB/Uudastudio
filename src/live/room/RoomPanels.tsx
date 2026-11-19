import React, { useEffect, useRef, useState } from 'react';
import { Headphones, Mic, MicOff, PhoneOff, Users } from 'lucide-react';
import { useLiveRoom } from './useLiveRoom';
import { useCall, type CallView } from './useCall';
import { DEFAULT_STRIP, type StripSettings } from './hostMixer';
import { liveSettings } from '../settings/liveSettings';
import { useLiveSettings } from '../settings/useLiveSettings';
import { limitNotice } from './roomState';
import { useRoomRecording } from './useRoomRecording';
import { removeQueued } from './takeQueue';
import { sendLine, useFileChannels, useTakeReceiver, useTakeSender } from './useFileTransfer';
import type { RoomRecording } from './roomRecorder';

const BTN = 'inline-flex items-center gap-1.5 rounded-control border border-line-strong bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-3 cursor-pointer disabled:opacity-40 disabled:pointer-events-none';
const PRIMARY = 'inline-flex items-center gap-1.5 rounded-control border border-accent px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent hover:text-surface-0 cursor-pointer disabled:opacity-40 disabled:pointer-events-none';

const useTick = (ms = 250) => { const [, set] = useState(0); useEffect(() => { const id = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(id); }, [ms]); };
const clockText = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** What the room says about recording: counting down to a start, or how long the take has been running */
const TakeLine: React.FC<{ take: { startAt: number; stopAt: number | null } | null; now: number }> = ({ take, now }) => {
  if (!take) return <span className="text-ink-faint">Not recording</span>;
  if (take.stopAt !== null) return <span className="text-ink-faint">Take finished ({clockText((take.stopAt - take.startAt) / 1000)})</span>;
  if (now < take.startAt) return <span className="text-gold">Starting in {Math.ceil((take.startAt - now) / 1000)}…</span>;
  return <span className="text-danger">● Recording {clockText((now - take.startAt) / 1000)}</span>;
};

/** One remote person's voice, played through a hidden audio element */
const RemoteAudio: React.FC<{ stream: MediaStream }> = ({ stream }) => {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (ref.current) { ref.current.srcObject = stream; void ref.current.play().catch(() => undefined); } }, [stream]);
  return <audio ref={ref} autoPlay playsInline />;
};

const QUALITY_CLS: Record<string, string> = { good: 'text-ok', weak: 'text-gold', poor: 'text-danger', unknown: 'text-ink-faint' };

/** Join the voice call, mute, and see your own level and how each connection is doing */
const CallBar: React.FC<{ call: CallView; mode: 'conversation' | 'broadcast'; role: 'producer' | 'guest'; onJoin: (headphones: boolean, deviceId?: string) => void; onLeave: () => void; onMute: (m: boolean) => void }> = ({ call, mode, role, onJoin, onLeave, onMute }) => {
  const prefs = useLiveSettings();
  const headphones = prefs.headphones;
  const setHeadphones = (v: boolean) => liveSettings.set({ headphones: v });
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  // A remembered input that is no longer plugged in is ignored rather than asked for by name
  const inputId = inputs.some((d) => d.deviceId === prefs.inputDeviceId) ? prefs.inputDeviceId : '';
  const setInputId = (id: string) => liveSettings.set({ inputDeviceId: id });
  useEffect(() => { if (role === 'producer' && mode === 'broadcast') void navigator.mediaDevices?.enumerateDevices().then((d) => setInputs(d.filter((x) => x.kind === 'audioinput'))).catch(() => undefined); }, [role, mode]);
  const broadcast = mode === 'broadcast';
  const needs = broadcast && role === 'producer' && !headphones;
  return (
  <div className="flex flex-col gap-2 rounded-control border border-line bg-surface-2 p-3">
    {!call.joined ? (
      <div className="flex flex-col gap-2">
        {broadcast && <p className="text-xs font-medium text-ink">{role === 'guest' ? 'Broadcast session: you are connected to the host, who mixes the sound.' : 'Broadcast session: guests connect to you and you mix their sound.'}</p>}
        {broadcast && role === 'producer' && (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="host-input" className="text-xs text-ink">Your microphone or mixer input</label>
            <select id="host-input" className="min-w-0 flex-1 rounded-control border border-line bg-surface-0 px-2 py-1 text-xs text-ink" value={inputId} onChange={(e) => setInputId(e.target.value)}>
              <option value="">Default</option>
              {inputs.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Input ${i + 1}`}</option>)}
            </select>
          </div>)}
        <label className="flex items-center gap-2 text-xs text-ink"><input type="checkbox" checked={headphones} onChange={(e) => setHeadphones(e.target.checked)} />I am wearing headphones</label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={PRIMARY} disabled={call.starting || needs} onClick={() => onJoin(headphones, inputId || undefined)}><Headphones className="h-3.5 w-3.5" />{call.starting ? 'Starting…' : 'Join the voice call'}</button>
          <span className="text-xs text-ink-dim">{needs ? 'Tick the box: a broadcast needs headphones on the host side.' : broadcast && role === 'guest' && !headphones ? 'Without headphones your sound is processed to avoid echo, so it will not be as clean.' : 'Headphones keep the call out of your recording.'}</span>
        </div>
      </div>
    ) : (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BTN} onClick={() => onMute(!call.muted)} aria-pressed={call.muted}>{call.muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}{call.muted ? 'Unmute' : 'Mute'}</button>
          <button type="button" className={BTN} onClick={onLeave}><PhoneOff className="h-3.5 w-3.5" />Leave call</button>
          <div className="h-2 w-28 overflow-hidden rounded-full bg-surface-0" aria-label="Your microphone level" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(call.myLevel * 100)}><div className="h-full bg-ok transition-[width] duration-100" style={{ width: `${Math.round(call.myLevel * 100)}%` }} /></div>
        </div>
        {call.relayFull && <p role="alert" className="text-[11px] text-gold">The relay service is full for this month, so calls connect directly. If someone cannot hear you, try switching networks (for example, mobile data). Your recordings are not affected.</p>}
        {!call.relay && !call.relayFull && <p className="text-[11px] text-ink-faint">Direct connections only. If someone cannot hear you, their network may need the relay, which is not switched on yet.</p>}
      </>
    )}
    {call.error && <p role="alert" className="text-xs text-danger">{call.error}</p>}
    {call.deskNote && <p role={call.deskNote.includes('switched') ? 'alert' : 'status'} className="text-[11px] text-gold">{call.deskNote}</p>}
    {Object.entries(call.streams).map(([id, s]) => <RemoteAudio key={id} stream={s} />)}
  </div>
  );
};

const qualityFor = (call: CallView, id: string) => {
  const q = call.quality[id];
  return call.joined && q ? <span className={`text-[11px] ${QUALITY_CLS[q.q]}`}>{q.label}{q.relayed ? ' (relayed)' : ''}</span> : null;
};

/** Host's mixing desk for a broadcast: one strip per guest, plus where the finished mix goes */
const DeskPanel: React.FC<{
  peers: Array<{ id: string; name: string }>; call: CallView; level: (id: string) => { level: number; clipping: boolean };
  setStrip: (id: string, p: Partial<StripSettings>) => void; programDevice: string; setProgramDevice: (id: string) => Promise<boolean>; setProgramHost: (on: boolean) => void;
}> = ({ peers, call, level, setStrip, programDevice, setProgramDevice, setProgramHost }) => {
  const prefs = useLiveSettings();
  const hostOn = prefs.programContains === 'all';
  useTick(120);
  const [outs, setOuts] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => { void navigator.mediaDevices?.enumerateDevices().then((d) => setOuts(d.filter((x) => x.kind === 'audiooutput'))).catch(() => undefined); }, []);
  return (
    <div className="flex flex-col gap-3 rounded-control border border-line bg-surface-2 p-3" aria-label="Broadcast desk">
      <p className="text-xs font-semibold text-ink">Broadcast desk</p>
      {peers.length === 0 && <p className="text-xs text-ink-dim">Guests appear here once they are in the call.</p>}
      {peers.map((p) => {
        const s: StripSettings = call.strips[p.id] ?? DEFAULT_STRIP;
        const l = level(p.id);
        return (
          <div key={p.id} className="flex flex-col gap-1.5 border-t border-line pt-2 first:border-t-0 first:pt-0">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-ink">{p.name}{qualityFor(call, p.id)}</span>
              <button type="button" className={BTN} aria-pressed={s.muted} onClick={() => setStrip(p.id, { muted: !s.muted })}>{s.muted ? 'Unmute' : 'Mute'}</button>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-0" role="meter" aria-label={`${p.name} level`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(l.level * 100)}><div className={`h-full transition-[width] duration-100 ${l.clipping ? 'bg-danger' : 'bg-ok'}`} style={{ width: `${Math.round(l.level * 100)}%` }} /></div>
            {l.clipping && <p role="alert" className="text-[11px] text-danger">{p.name} is too loud: ask them to move back from the microphone or turn their input down.</p>}
            <label className="flex items-center gap-2 text-[11px] text-ink-dim">Volume<input type="range" min={0} max={2} step={0.05} value={s.volume} onChange={(e) => setStrip(p.id, { volume: Number(e.target.value) })} aria-label={`${p.name} volume`} className="flex-1" /></label>
            <label className="flex items-center gap-2 text-[11px] text-ink-dim">Presence<input type="range" min={-6} max={6} step={0.5} value={s.presence} onChange={(e) => setStrip(p.id, { presence: Number(e.target.value) })} aria-label={`${p.name} presence`} className="flex-1" /></label>
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 text-[11px] text-ink"><input type="checkbox" checked={s.lowCut} onChange={(e) => setStrip(p.id, { lowCut: e.target.checked })} />Low cut</label>
              <label className="flex items-center gap-1.5 text-[11px] text-ink"><input type="checkbox" checked={s.compressor} onChange={(e) => setStrip(p.id, { compressor: e.target.checked })} />Compressor</label>
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
        <label htmlFor="program-out" className="text-xs text-ink">Program out</label>
        <select id="program-out" className="min-w-0 flex-1 rounded-control border border-line bg-surface-0 px-2 py-1 text-xs text-ink" value={programDevice} onChange={(e) => { const id = e.target.value; void setProgramDevice(id).then((ok) => { if (ok) liveSettings.set({ programDeviceId: id }); }); }}>
          <option value="">Off</option>
          {outs.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{(d.label || `Output ${i + 1}`) + (d.deviceId === prefs.programDeviceId ? ' (last used)' : '')}</option>)}
        </select>
        <label htmlFor="program-content" className="text-xs text-ink">Program contains</label>
        <select id="program-content" className="min-w-0 flex-1 rounded-control border border-line bg-surface-0 px-2 py-1 text-xs text-ink" value={hostOn ? 'all' : 'guests'} onChange={(e) => { const on = e.target.value === 'all'; liveSettings.set({ programContains: on ? 'all' : 'guests' }); setProgramHost(on); }}>
          <option value="all">Me and the guests</option>
          <option value="guests">Guests only (my microphone goes through a mixer)</option>
        </select>
        <p className="w-full text-[11px] text-ink-faint">Choose "Guests only" when your microphone is wired to a hardware mixer that already puts you on air. Otherwise you would go out twice and sound doubled. Guests still hear you.</p>
        <p className="w-full text-[11px] text-ink-faint">Sends the finished mix to a sound device. Pick your virtual audio cable to feed OBS, StreamYard or a transmitter chain. Works in Chrome and Edge on a computer.</p>
      </div>
    </div>
  );
};

/** This device's own recording: whether it is running, what went wrong, what was saved */
const MyRecording: React.FC<{ mine: ReturnType<typeof useRoomRecording> }> = ({ mine }) => (
  <>
    {mine.recording && <p className="text-xs text-danger">● Recording your microphone on this device</p>}
    {mine.error && <p role="alert" className="text-xs text-danger">{mine.error}</p>}
    {mine.saved.map((t) => <p key={t.takeId} className="text-xs text-ok">Take saved on this device ({clockText(t.seconds)}).</p>)}
  </>
);

/** The producer's side: who is in the room, let people in, start and stop together */
export const ProducerRoomPanel: React.FC<{ token: string; onTake?: (r: RoomRecording) => void }> = ({ token, onTake }) => {
  const [on, setOn] = useState(false);
  const signalRef = useRef<((from: string, data: unknown) => void) | null>(null);
  const { view, send, clockMs } = useLiveRoom(token, on, undefined, (m) => { if (m.t === 'signal') signalRef.current?.(String(m.from), m.data); });
  const files = useFileChannels();
  const { call, join, leave, mute, onSignal, setStrip, level, setProgramDevice, programDevice, setProgramHost } = useCall(token, view, send, files.onChannel);
  const received = useTakeReceiver(view, files.channels, onTake);
  signalRef.current = onSignal;
  const mine = useRoomRecording(token, view, send, clockMs, (r) => { onTake?.(r); removeQueued(token, r.takeId); });
  useEffect(() => { if (!on) { leave(); void mine.stop(); } }, [on, leave, mine.stop]); // eslint-disable-line react-hooks/exhaustive-deps
  useTick();
  const waiting = view.peers.filter((p) => !p.admitted);
  const inCall = view.peers.filter((p) => p.admitted);
  const running = view.take && view.take.stopAt === null;
  return (
    <section aria-label="Live room" className="rounded-card border border-line-strong bg-surface-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink"><Users className="h-4 w-4 text-accent" />Live room</h3>
        {!on
          ? <button type="button" className={PRIMARY} onClick={() => setOn(true)}>Open the room</button>
          : <button type="button" className={BTN} onClick={() => setOn(false)}>Leave the room</button>}
      </div>
      {on && (
        <div className="mt-3 flex flex-col gap-3 text-sm">
          {limitNotice(view, clockMs()) && <p role="alert" className="rounded-control border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-ink">{limitNotice(view, clockMs())}</p>}
          <p role="status" className="text-xs text-ink-dim">{view.closedReason ?? view.error ?? (view.connected ? 'Connected. Guests who open the link wait here until you let them in.' : 'Connecting…')}</p>
          {view.connected && (
            <>
              <label className="flex items-center gap-2 text-xs text-ink"><input type="checkbox" checked={view.autoAdmit} onChange={(e) => send({ t: 'auto', on: e.target.checked })} />Let guests in automatically</label>
              {waiting.length > 0 && (
                <div><p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">Waiting</p>
                  <ul className="flex flex-col gap-1.5">{waiting.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 rounded-control border border-line bg-surface-2 px-3 py-2"><span className="truncate text-ink">{p.name}</span>
                      <span className="flex gap-2"><button type="button" className={PRIMARY} onClick={() => send({ t: 'admit', id: p.id })}>Let in</button><button type="button" className={BTN} onClick={() => send({ t: 'remove', id: p.id })}>Remove</button></span></li>))}</ul></div>)}
              <div><p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">In the room ({inCall.length + 1} of 4)</p>
                <ul className="flex flex-col gap-1.5">
                  <li className="flex items-center justify-between rounded-control border border-line bg-surface-2 px-3 py-2"><span className="text-ink">You</span></li>
                  {inCall.filter((p) => p.role === 'guest').map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 rounded-control border border-line bg-surface-2 px-3 py-2"><span className="flex items-center gap-2 truncate text-ink">{p.muted ? <MicOff className="h-3.5 w-3.5 text-ink-faint" /> : <Mic className="h-3.5 w-3.5 text-ok" />}{p.name}{qualityFor(call, p.id)}{p.recording && <span className="text-[11px] text-danger">● recording</span>}</span>
                      <button type="button" className={BTN} onClick={() => send({ t: 'remove', id: p.id })}>Remove</button></li>))}
                </ul></div>
              <CallBar call={call} mode={view.mode} role="producer" onJoin={(h, d) => { void join(h, d); }} onLeave={leave} onMute={mute} />
              {call.joined && view.mode === 'broadcast' && <DeskPanel peers={view.peers.filter((p) => p.admitted && p.role === 'guest')} call={call} level={level} setStrip={setStrip} programDevice={programDevice} setProgramDevice={setProgramDevice} setProgramHost={setProgramHost} />}
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <button type="button" className={PRIMARY} disabled={Boolean(running)} onClick={() => send({ t: 'record', leadMs: 3000 })}>Record all</button>
                <button type="button" className={BTN} disabled={!running} onClick={() => send({ t: 'stop' })}>Stop</button>
                <button type="button" className={BTN} disabled={!running} onClick={() => send({ t: 'marker' })}>Marker</button>
                <button type="button" className={BTN} onClick={() => send({ t: 'end' })} disabled={view.endedAt !== null}>End session</button>
                <span className="text-xs"><TakeLine take={view.take} now={clockMs()} /></span>
              </div>
              <MyRecording mine={mine} />
              {received.map((l) => <p key={l.id} className={`text-xs ${l.error ? 'text-danger' : l.done ? 'text-ok' : 'text-ink-dim'}`}>{l.error ? `${l.guest}: ${l.error}` : l.done ? `Full-quality recording from ${l.guest} received and added to your project.` : `Receiving ${l.guest}'s full-quality recording… ${Math.round(l.fraction * 100)}%`}</p>)}
              <CueBox onSend={(text) => send({ t: 'cue', to: 'all', text })} />
            </>
          )}
        </div>
      )}
    </section>
  );
};

const CueBox: React.FC<{ onSend: (text: string) => void }> = ({ onSend }) => {
  const [text, setText] = useState('');
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onSend(text.trim()); setText(''); } }}>
      <input value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder="Send a cue to everyone, e.g. “again from paragraph 2”" aria-label="Cue for guests" className="min-w-0 flex-1 rounded-control border border-line bg-surface-0 px-3 py-1.5 text-xs text-ink" />
      <button type="submit" className={BTN} disabled={!text.trim()}>Send</button>
    </form>
  );
};

/** The guest's side: give a name, wait to be let in, see cues and when recording starts */
export const GuestRoomPanel: React.FC<{ token: string }> = ({ token }) => {
  const [name, setName] = useState('');
  const [joined, setJoined] = useState<string | null>(null);
  const signalRef = useRef<((from: string, data: unknown) => void) | null>(null);
  const { view, send, clockMs } = useLiveRoom(token, joined !== null, joined ?? undefined, (m) => { if (m.t === 'signal') signalRef.current?.(String(m.from), m.data); });
  const files = useFileChannels();
  const { call, join, leave, mute, onSignal } = useCall(token, view, send, files.onChannel);
  signalRef.current = onSignal;
  const mine = useRoomRecording(token, view, send, clockMs);
  const handOver = useTakeSender(token, view, files.channels, mine.recording, mine.saved.length);
  const handOverLine = sendLine(handOver);
  useTick();
  if (joined === null) {
    return (
      <form className="flex flex-col gap-2 rounded-card border border-line-strong bg-surface-1 p-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) setJoined(name.trim()); }}>
        <label className="text-sm font-semibold text-ink" htmlFor="live-name">Your name</label>
        <input id="live-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="rounded-control border border-line bg-surface-0 px-3 py-2 text-sm text-ink" autoComplete="name" />
        <button type="submit" className={PRIMARY} disabled={!name.trim()}>Join the room</button>
      </form>
    );
  }
  const status = view.closedReason ?? view.error ?? (!view.connected ? 'Connecting…' : view.endedAt ? 'The session has ended.' : view.me?.admitted ? 'You are in the room.' : 'Waiting for the host to let you in…');
  return (
    <section aria-label="Live room" className="flex flex-col gap-3 rounded-card border border-line-strong bg-surface-1 p-4 text-sm">
      <p role="status" className="font-medium text-ink">{status}</p>
      {limitNotice(view, clockMs()) && <p role="alert" className="rounded-control border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-ink">{limitNotice(view, clockMs())}</p>}
      {view.connected && view.me?.admitted && (
        <>
          <p className="text-xs"><TakeLine take={view.take} now={clockMs()} /></p>
          <MyRecording mine={mine} />
          {handOverLine && <p role="status" className={`text-xs ${handOver.error ? 'text-danger' : 'text-ink-dim'}`}>{handOverLine}</p>}
          <p className="text-xs text-ink-dim">In the room: {view.peers.filter((p) => p.admitted).map((p) => p.name).join(', ') || 'just you'}</p>
          <CallBar call={call} mode={view.mode} role="guest" onJoin={(h) => { void join(h); }} onLeave={leave} onMute={mute} />
        </>
      )}
      {view.cue && <p className="rounded-control border border-gold/50 bg-gold/10 px-3 py-2 text-gold">Host: {view.cue.text}</p>}
    </section>
  );
};
