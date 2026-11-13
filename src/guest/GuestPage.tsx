import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, RotateCcw, Send, Square, Trash2, Minus, Plus, ChevronDown, Minimize2, Maximize2 } from 'lucide-react';
import { Button, Input } from '../components/ui';
import { MicCapture } from './capture';
import { MODE_TEXT } from './channels';
import { checkRoom, type RoomReport } from './roomCheck';
import { Findings, MicSheet, type SetupInfo } from './SetupPanel';
import { useMics } from './useMics';
import { checkRecording } from './env';
import { countWords, estimateSeconds, formatClock, jobFromHash, type GuestJob } from './job';
import { FormattedScript } from './FormattedScript';
import { beginSession, deleteSession, findSaved, finishSession, loadSession, saveChunk, type SavedSession } from './takeStore';
import { pcmToFloat, takeFileName, totalSamples, wavBlob, wavBytes, type Bits, type Pcm } from './wavWriter';
import { describeSettings, processingOn } from './captureSettings';
import { checkTake, parseWavHeader, storageCheck, wavMatches, type TakeIssue } from './takeCheck';
import { LevelMeter, useMeter } from './MeterBar';
import { SaveMenu } from '../jobs/SaveMenu';
import { expiryLine } from '../jobs/saveFile';
import { audioUrl, getThread, postMessage, sendAudio, type ThreadMessage, type ThreadResponse } from '../jobs/api';
import { parseTalentHash } from '../jobs/links';
import { ThreadView } from '../jobs/ThreadView';
import { usePolling } from '../jobs/usePolling';
import { useLive } from '../jobs/live';

interface Take {
  n: number;
  sessionId: string;
  chunks: Pcm[];
  sampleRate: number;
  bits: Bits;
  seconds: number;
  blob: Blob;
  url: string;
  /** A rehearsal: never saved to the device, never sent */
  practice: boolean;
  /** What was heard in the quiet lead-in and the speech (real takes only) */
  report?: RoomReport;
  /** Problems found in the recording itself (audio missing, signal stopped, browser processing on, damaged file) */
  issues?: TakeIssue[];
  /** One line about the microphone, added to the Send message */
  capture?: string;
}

const NAME_KEY = 'uuda-guest-name';
const SIZE_KEY = 'uuda-guest-text-size';
const MIC_KEY = 'uuda-guest-mic';
const BITS_KEY = 'uuda-guest-bits';
const SEEN_KEY = 'uuda-guest-mic-seen';
const SIZES = [16, 18, 20, 24, 28, 34];
/** Seconds of quiet at the start of a real take; the room noise heard here is what the producer's cleaner learns from */
const LEAD_IN = 3;

const readStore = (k: string): string => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const writeStore = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* not saved */ } };

const makeTake = (n: number, sessionId: string, chunks: Pcm[], sampleRate: number, bits: Bits, practice = false): Take => {
  const blob = wavBlob(chunks, sampleRate, bits);
  return { n, sessionId, chunks, sampleRate, bits, seconds: totalSamples(chunks) / sampleRate, blob, url: URL.createObjectURL(blob), practice };
};

const Script: React.FC<{ job: GuestJob; size: number }> = ({ job, size }) => {
  if (!job.script.trim()) return <p className="text-ink-dim" style={{ fontSize: size }}>The producer has not added a script. Record what they asked for.</p>;
  return <FormattedScript script={job.script} size={size} />;
};

/** What the page shows about the job, wherever it came from (the link itself, or the server) */
interface View {
  talent: string;
  title: string;
  script: string;
  notes: string;
  producer: string;
  targetSeconds?: number;
  referenceId?: string;
}

/** The page a voice talent opens from the producer's link: script, rehearse, record, retake, then send (job on the server) or download (link only). */
export const GuestPage: React.FC = () => {
  const hash = window.location.hash;
  const remote = useMemo(() => parseTalentHash(hash), [hash]);
  const offlineJob = useMemo(() => jobFromHash(hash), [hash]);
  const jobKey = hash.slice(0, 200);
  const cap = useMemo(
    () => checkRecording({ userAgent: navigator.userAgent, hasMediaDevices: !!navigator.mediaDevices?.getUserMedia, isSecureContext: window.isSecureContext, hasAudioContext: typeof AudioContext !== 'undefined' || 'webkitAudioContext' in window }),
    [],
  );

  // The job on the server, and its message thread
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loadError, setLoadError] = useState('');
  const jobSig = useRef('');
  const loadThread = useCallback(async () => {
    if (!remote) return;
    const after = messages.length ? messages[messages.length - 1].id : 0;
    try {
      const t = await getThread(remote.jobId, remote.key, after);
      const sig = JSON.stringify(t.job);
      const unchanged = sig === jobSig.current && !t.messages.length;
      jobSig.current = sig;
      setThread(t); setLoadError('');
      if (t.messages.length) setMessages((all) => [...all, ...t.messages.filter((m) => !all.some((x) => x.id === m.id))]);
      return !unchanged;
    } catch (e) { if (!thread) setLoadError(e instanceof Error ? e.message : 'The job could not be opened.'); }
  }, [remote, messages, thread]);
  const live = useLive(remote?.jobId, remote?.key, (c) => { if (c !== 'client') void loadThread(); }, !!remote);
  usePolling(loadThread, 6000, !!remote, live);

  const view: View | null = remote
    ? thread ? { title: thread.job.title, script: thread.job.script, notes: thread.job.notes, producer: thread.job.producer, talent: thread.job.talent ?? '', targetSeconds: thread.job.targetSeconds ?? undefined, referenceId: thread.job.reference?.id } : null
    : offlineJob ? { title: offlineJob.title, script: offlineJob.script, notes: '', producer: offlineJob.producer ?? '', talent: offlineJob.talent ?? '', targetSeconds: offlineJob.targetSeconds } : null;

  const [name, setName] = useState(() => readStore(NAME_KEY));
  const [sizeIdx, setSizeIdx] = useState(() => { const i = Number(readStore(SIZE_KEY)); return Number.isInteger(i) && i >= 0 && i < SIZES.length ? i : 2; });
  const [phase, setPhase] = useState<'ready' | 'recording'>('ready');
  /** While recording the page is a full screen of script; this folds it back to the normal page without stopping */
  const [minimised, setMinimised] = useState(false);
  const [take, setTake] = useState<Take | null>(null);
  const [practiceNext, setPracticeNext] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const meter = useMeter();
  const [error, setError] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [saved, setSaved] = useState<SavedSession | null>(null);
  const [notice, setNotice] = useState('');
  const [sentCount, setSentCount] = useState(0);
  const [sending, setSending] = useState<number | null>(null);
  const [sendNote, setSendNote] = useState('');
  const [tab, setTab] = useState<'script' | 'messages'>('script');
  const [autoScroll, setAutoScroll] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(0.75);
  const readerRef = useRef<HTMLDivElement | null>(null);
  const [micId, setMicId] = useState(() => readStore(MIC_KEY));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [micLevel, setMicLevel] = useState<'' | 'ok' | 'warn' | 'problem'>('');
  const { mics, defaultLabel, fresh, clearFresh, refresh } = useMics();
  const heldRef = useRef(false);
  const [held, setHeld] = useState(false);
  const [seen, setSeen] = useState(0);
  const who = () => (view?.talent || name).trim();
  const infoRef = useRef<SetupInfo | null>(null);
  const capRef = useRef<MicCapture | null>(null);
  const chunksRef = useRef<Pcm[]>([]);
  const startedRef = useRef(0);
  const [bits, setBits] = useState<Bits>(() => (readStore(BITS_KEY) === '24' ? 24 : 16));
  const [lowSpace, setLowSpace] = useState('');
  const sessionRef = useRef('');
  const samplesRef = useRef(0);
  const practiceRef = useRef(false);
  const takeRef = useRef<Take | null>(null);
  takeRef.current = take;

  useEffect(() => { if (phase === 'recording') setMinimised(false); }, [phase]);
  useEffect(() => { if (view) document.title = `${view.title} · Uuda recording`; }, [view?.title]);
  useEffect(() => { void findSaved(jobKey).then(setSaved); }, [jobKey]);
  // Is there room on this device for a take of the expected length (held as chunks and again as a file)?
  useEffect(() => {
    if (!view) return;
    void navigator.storage?.estimate?.().then((e) => {
      const r = storageCheck(e, Math.max(view.targetSeconds ?? 0, 600), 48000, bits);
      setLowSpace(r?.low ? `This device has about ${r.freeMB} MB free, and a long take can need about ${r.neededMB} MB. Free some space before recording.` : '');
    }).catch(() => undefined);
  }, [!!view, bits]);
  useEffect(() => () => { if (takeRef.current) URL.revokeObjectURL(takeRef.current.url); }, []);
  useEffect(() => {
    if (phase !== 'recording' && !(take && !take.practice && sending === null)) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase, take, sending]);
  useEffect(() => { if (!confirmStop) return; const t = window.setTimeout(() => setConfirmStop(false), 3500); return () => window.clearTimeout(t); }, [confirmStop]);
  useEffect(() => { if (!confirmReplace) return; const t = window.setTimeout(() => setConfirmReplace(false), 3500); return () => window.clearTimeout(t); }, [confirmReplace]);

  /** Drops the current take from the screen and from the device */
  const dropTake = useCallback(async () => {
    const t = takeRef.current;
    if (!t) return;
    URL.revokeObjectURL(t.url);
    if (!t.practice && t.sessionId) await deleteSession(t.sessionId);
    setTake(null);
  }, []);

  const finish = useCallback(async (lost: boolean) => {
    const c = capRef.current;
    if (!c) return;
    capRef.current = null;
    await c.stop();
    setPhase('ready');
    setConfirmStop(false);
    meter.reset();
    const chunks = chunksRef.current;
    const practice = practiceRef.current;
    if (totalSamples(chunks) === 0) { if (!practice) void deleteSession(sessionRef.current); return; }
    if (!practice) await finishSession(sessionRef.current);
    const t = makeTake(1, practice ? '' : sessionRef.current, chunks, c.sampleRate, c.bits, practice);
    if (!practice) {
      const floats = pcmToFloat(chunks, c.bits);
      t.report = checkRoom(floats, c.sampleRate);
      const issues = checkTake(floats, c.sampleRate, (performance.now() - startedRef.current) / 1000);
      const on = processingOn(c.settings);
      if (on.length) issues.push({ id: 'processing', text: `Your browser is still applying ${on.join(' and ')}, which can thin or pump the voice. Try Chrome or Edge, or turn it off in the device's sound settings.` });
      try {
        const head = parseWavHeader(new Uint8Array(await t.blob.slice(0, 44).arrayBuffer()));
        if (!wavMatches(head, t.blob.size, totalSamples(chunks), c.sampleRate, c.bits)) issues.push({ id: 'file', text: 'The recording file did not come out right. Record again.' });
      } catch { /* the file is checked again by the server */ }
      t.issues = issues;
      t.capture = `Recorded on: ${c.label || 'microphone'} · ${describeSettings(c.settings, c.sampleRate)} · ${c.bits}-bit · ${MODE_TEXT[c.channelMode]}`;
    }
    setTake(t);
    if (lost) setNotice('The microphone stopped. What was recorded so far is kept as your take.');
  }, []);

  const start = async (practice: boolean) => {
    setError(''); setNotice('');
    setTab('script');
    // Recording over an unsent take deletes it, so ask first
    if (take && !take.practice && !confirmReplace) { setConfirmReplace(true); return; }
    setConfirmReplace(false);
    const c = new MicCapture();
    chunksRef.current = []; samplesRef.current = 0; setElapsed(0);
    practiceRef.current = practice;
    sessionRef.current = `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      await c.start({
        onBlock: (pcm, i) => {
          chunksRef.current.push(pcm);
          samplesRef.current += pcm.length;
          setElapsed(samplesRef.current / c.sampleRate);
          if (!practiceRef.current) void saveChunk(sessionRef.current, i, pcm);
        },
        onLevel: () => undefined,
        onInfo: meter.onInfo,
        onLost: () => void finish(true),
      }, micId || undefined, bits);
    } catch (e) {
      await c.stop();
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      setError(denied ? 'The microphone is blocked. Allow it for this page in the browser (the lock or settings icon next to the address), then press Record again.' : e instanceof DOMException && (e.name === 'OverconstrainedError' || e.name === 'NotReadableError') && micId ? 'The chosen microphone is not available. Pick another one in Your microphone, or plug it back in.' : e instanceof DOMException && e.name === 'NotFoundError' ? 'No microphone was found. Plug one in or check your device.' : 'The microphone could not be started. Close other apps that use it and try again.');
      return;
    }
    await dropTake();
    capRef.current = c;
    startedRef.current = performance.now();
    if (!practice) {
      void navigator.storage?.persist?.();
      await beginSession({ id: sessionRef.current, jobKey, sampleRate: c.sampleRate, bits: c.bits, startedAt: Date.now() });
      // blocks that arrived before the session record existed are saved by index again
      chunksRef.current.forEach((pcm, i) => void saveChunk(sessionRef.current, i, pcm));
    }
    setPhase('recording');
  };

  const stopPressed = () => { if (!confirmStop) { setConfirmStop(true); return; } void finish(false); };

  // Reading aid: while recording (after the quiet lead-in) the script drifts upward so the talent never has to touch the screen.
  // The pace is the script length spread over the target time; the talent can nudge it faster or slower, or scroll by hand at any time.
  const targetRef = useRef(0);
  useEffect(() => {
    if (phase !== 'recording' || !autoScroll) return;
    const el = readerRef.current;
    if (!el) return;
    let raf = 0, last = performance.now(), pos = el.scrollTop;
    const tick = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      if (Math.abs(el.scrollTop - pos) > 3) pos = el.scrollTop; // the talent scrolled by hand
      if (heldRef.current) { pos = el.scrollTop; }
      else if (samplesRef.current / (capRef.current?.sampleRate || 48000) >= LEAD_IN) {
        const room = el.scrollHeight - el.clientHeight;
        const seconds = Math.max(20, targetRef.current || 60);
        pos = Math.min(room, pos + (room / seconds) * scrollSpeed * dt);
        el.scrollTop = pos;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, autoScroll, scrollSpeed, tab]);

  // A finger (or mouse button) held on the script pauses auto-scroll; letting go lets it carry on
  const hold = (on: boolean) => { heldRef.current = on; setHeld(on); };

  // Open the microphone sheet the first time on this device, and whenever a new microphone is plugged in
  useEffect(() => { if (view && cap.ok && !readStore(SEEN_KEY)) { writeStore(SEEN_KEY, '1'); setSheetOpen(true); } }, [!!view]);
  useEffect(() => { if (fresh && phase === 'ready') setSheetOpen(true); }, [fresh, phase]);
  // A chosen microphone that has been unplugged falls back to the default
  useEffect(() => { if (micId && mics.some((m) => m.id) && !mics.some((m) => m.id === micId)) { setMicId(''); writeStore(MIC_KEY, ''); } }, [mics, micId]);
  useEffect(() => { if (tab === 'messages') setSeen(messages.length); }, [tab, messages.length]);

  // Space starts and stops a take on a keyboard. Stopping keeps the two-press guard.
  const spaceRef = useRef<() => void>(() => undefined);
  spaceRef.current = () => { if (phase === 'recording') stopPressed(); else if (cap.ok && sending === null && !take && tab === 'script' && !sheetOpen) void start(false); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT|BUTTON|AUDIO|A)$/.test(el.tagName)) return;
      if (el?.isContentEditable) return;
      e.preventDefault();
      spaceRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const recover = async () => {
    if (!saved) return;
    const chunks = await loadSession(saved.id);
    if (chunks.length === 0) { setSaved(null); return; }
    setTake(makeTake(1, saved.id, chunks, saved.sampleRate, saved.bits ?? 16)); setSaved(null);
  };
  const forget = async () => { if (saved) await deleteSession(saved.id); setSaved(null); };

  const fileFor = (t: Take) => takeFileName(view?.title ?? '', who(), t.n);
  /** Sends the take into the thread. The take is only removed from the device after the server says it has it. */
  const send = async () => {
    if (!remote || !take || take.practice) return;
    if (!who()) { setError('Type your name above the Send button, so the producer knows whose take this is.'); return; }
    if (!view?.talent) writeStore(NAME_KEY, name.trim());
    setError(''); setSending(0);
    try {
      const sent = await sendAudio(remote.jobId, remote.key, take.blob, { name: fileFor(take), who: who(), text: [sendNote.trim(), take.capture].filter(Boolean).join('\n\n'), durationSeconds: take.seconds }, (f) => setSending(f));
      await dropTake();
      setSendNote(''); setSentCount((n) => n + 1); const until = expiryLine(sent.attachment?.expiresAt);
      setNotice(`Sent. The producer can hear it now. You can record another take.${until ? ` ${until.text}` : ''}`);
      await loadThread();
    } catch (e) {
      setError(`Not sent: ${e instanceof Error ? e.message : 'something went wrong'}. Your take is still here. Try again.`);
    } finally { setSending(null); }
  };

  if (remote && !view) {
    return (
      <main className="grid min-h-screen place-items-center bg-surface-0 p-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-lg font-semibold text-ink">{loadError ? 'This job did not open' : 'Opening your job...'}</h1>
          {loadError && <p className="mt-2 text-sm text-ink-dim">{loadError}</p>}
        </div>
      </main>
    );
  }
  if (!view) {
    return (
      <main className="grid min-h-screen place-items-center bg-surface-0 p-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-lg font-semibold text-ink">This link did not open</h1>
          <p className="mt-2 text-sm text-ink-dim">The recording link looks incomplete. It may have been cut off when it was sent. Ask the producer to send it again.</p>
        </div>
      </main>
    );
  }

  const target = view.targetSeconds ?? (view.script.trim() ? estimateSeconds(view.script) : 0);
  targetRef.current = target;
  const remaining = target - elapsed;
  const words = countWords(view.script);
  const busySending = sending !== null;

  const micName = micId ? (mics.find((m) => m.id === micId)?.label ?? 'Chosen microphone') : (defaultLabel || 'Default microphone');
  const recording = phase === 'recording';
  const full = recording && !minimised;
  const unread = Math.max(0, messages.length - seen);
  const tabs = remote ? (['script', 'messages'] as const) : (['script'] as const);
  const ring = micLevel === 'problem' ? 'bg-danger' : micLevel === 'warn' ? 'bg-warn' : micLevel === 'ok' ? 'bg-ok' : 'bg-ink-faint';

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-surface-0 text-ink" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {!full && <header className="shrink-0 border-b border-line px-4 pb-2 pt-2 lg:pb-3">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-gold-soft text-sm font-bold text-gold">U</span>
          <span className="truncate text-sm font-bold tracking-tight text-ink">UUDA <span className="font-semibold text-gold">STUDIO</span></span>
        </div>
        <button type="button" disabled={recording} onClick={() => setSheetOpen(true)} aria-label={`Microphone: ${micName}. Change or test`} className="flex h-11 max-w-[46%] shrink-0 items-center gap-2 rounded-full border border-line-strong bg-surface-2 pl-3 pr-2 text-sm text-ink hover:bg-surface-3 disabled:opacity-50 lg:max-w-xs">
          <span className={`h-2 w-2 shrink-0 rounded-full ${ring}`} aria-hidden />
          <Mic className="h-4 w-4 shrink-0 text-ink-dim" aria-hidden />
          <span className="min-w-0 truncate">{micName}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-dim" aria-hidden />
        </button>
      </div>
      <div className="mt-1.5 min-w-0">
        <h1 className="truncate text-base font-semibold leading-tight lg:text-xl">{view.title}</h1>
        <div className="truncate text-xs text-ink-dim">Voice recording{view.producer ? ` · from ${view.producer}` : ''}{view.talent ? ` · for ${view.talent}` : ''}</div>
      </div>
      </header>}
      {recording && minimised && (
        <button type="button" onClick={() => setMinimised(false)} className="flex h-11 shrink-0 items-center justify-center gap-2 border-b border-danger/40 bg-danger/10 text-sm font-semibold text-danger">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" aria-hidden /> Recording {formatClock(elapsed)} <Maximize2 className="h-4 w-4" aria-hidden /> Return
        </button>
      )}
      {!full && tabs.length > 1 && (
        <div role="tablist" aria-label="Page sections" className="grid shrink-0 grid-cols-2 border-b border-line bg-surface-1">
          {tabs.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} disabled={recording && t === 'messages'} onClick={() => setTab(t)} className={`relative h-11 text-sm font-semibold disabled:opacity-40 ${tab === t ? 'border-b-2 border-accent text-ink' : 'text-ink-dim'}`}>
              {t === 'script' ? 'Script' : 'Messages'}
              {t === 'messages' && unread > 0 && tab !== 'messages' && <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-ink">{unread}</span>}
            </button>
          ))}
        </div>
      )}
      <MicSheet
        open={sheetOpen}
        onClose={() => { setSheetOpen(false); clearFresh(); }}
        mics={mics}
        defaultLabel={defaultLabel}
        micId={micId}
        onMicId={(id) => { setMicId(id); writeStore(MIC_KEY, id); setMicLevel(''); }}
        fresh={fresh}
        onAllow={async () => { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); } catch { /* shown by the test */ } await refresh(); }}
        bits={bits}
        onBits={(b) => { setBits(b); writeStore(BITS_KEY, String(b)); }}
        disabled={!cap.ok || busySending}
        onResult={(i, r) => { infoRef.current = i; setMicLevel(r.overall); }}
      />

      {tab === 'messages' && remote ? (
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col lg:px-4 lg:py-3">
          <ThreadView
            fill
            messages={messages}
            self="talent"
            folder={['Jobs', view.title || 'Recording']}
            audioSrc={(a) => audioUrl(remote.jobId, a.id, remote.key)}
            onSend={async (text) => { await postMessage(remote.jobId, remote.key, who() || 'Talent', text); await loadThread(); }}
            placeholder="Write to the producer"
          />
        </div>
      ) : (
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {/* The meter sits on the script itself, so the talent sees the words and the level together */}
      {full && (
        <div className="flex shrink-0 items-center gap-3 border-b border-line bg-surface-1 px-4 py-2" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
          <div className="min-w-0 flex-1"><LevelMeter state={meter.state} /></div>
          <span className="font-num text-lg text-ink" aria-label="Time recorded">{formatClock(elapsed)}</span>
          <button type="button" onClick={() => setMinimised(true)} aria-label="Minimise" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line-strong bg-surface-2 text-ink-dim hover:bg-surface-3"><Minimize2 className="h-5 w-5" /></button>
        </div>
      )}
      {recording && !full && <div className="pointer-events-none absolute inset-x-0 top-0 z-10 border-b border-line bg-surface-1/90 px-4 py-2 backdrop-blur"><LevelMeter state={meter.state} /></div>}
      <div
        ref={readerRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
        onTouchStart={() => hold(true)} onTouchEnd={() => hold(false)} onTouchCancel={() => hold(false)}
        onMouseDown={() => hold(true)} onMouseUp={() => hold(false)} onMouseLeave={() => hold(false)}
      >
      {recording && !full && <div className="h-10 shrink-0" aria-hidden />}
      {!cap.ok && <div role="alert" className="m-4 rounded-card border border-warn/40 bg-warn/10 p-3 text-sm text-ink">{cap.problem}</div>}
      {lowSpace && <div role="alert" className="m-4 rounded-card border border-warn/40 bg-warn/10 p-3 text-sm text-ink">{lowSpace}</div>}

      {saved && !take && phase === 'ready' && (
        <div className="m-4 flex flex-wrap items-center gap-3 rounded-card border border-line-strong bg-surface-2 p-3 text-sm">
          <span className="min-w-0 flex-1">A recording from earlier is still on this device ({formatClock((saved.chunkCount * 4096) / saved.sampleRate)} long).</span>
          <Button size="sm" variant="primary" onClick={() => void recover()}>Get it back</Button>
          <Button size="sm" variant="ghost" onClick={() => void forget()}>Delete it</Button>
        </div>
      )}

      <section className="px-4 py-4 lg:mx-auto lg:w-full lg:max-w-3xl" aria-label="Script">
        {remote && thread?.job.reference && (
          <div className="mb-4 rounded-card border border-line bg-surface-2 p-3">
            <div className="mb-1.5 text-xs font-medium text-ink-dim">Reference</div>
            <audio controls preload="none" src={audioUrl(remote.jobId, thread.job.reference.id, remote.key)} className="w-full" aria-label="Reference recording" />
            {(() => { const e = expiryLine(thread.job.reference.expiresAt); return e ? <p className={`mt-1.5 text-[11px] ${e.soon ? 'text-warn' : 'text-ink-faint'}`}>{e.text}</p> : null; })()}
          </div>
        )}
        {view.notes && (
          <div className="mb-4 rounded-card border border-accent/30 bg-accent/10 p-3" aria-label="Director's notes">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-accent">Director's notes</div>
            <p className="whitespace-pre-wrap text-sm text-ink">{view.notes}</p>
          </div>
        )}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-dim">
          <span>{words > 0 ? `${words} words to read` : 'No script'}</span>
          <div className="flex items-center gap-1" role="group" aria-label="Reading aids">
            <button type="button" aria-pressed={autoScroll} onClick={() => setAutoScroll((a) => !a)} className={`h-11 rounded-full border px-3 text-xs font-semibold ${autoScroll ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-surface-1 text-ink'}`}>Auto-scroll</button>
            {autoScroll && (<>
              <button type="button" aria-label="Scroll slower" disabled={scrollSpeed <= 0.25} onClick={() => setScrollSpeed((v) => Math.max(0.25, v - 0.25))} className="grid h-11 w-11 place-items-center rounded-full border border-line bg-surface-1 text-ink disabled:opacity-40"><Minus className="h-4 w-4" /></button>
              <span className="w-9 text-center font-num text-[11px] text-ink">{scrollSpeed}x</span>
              <button type="button" aria-label="Scroll faster" disabled={scrollSpeed >= 2} onClick={() => setScrollSpeed((v) => Math.min(2, v + 0.25))} className="grid h-11 w-11 place-items-center rounded-full border border-line bg-surface-1 text-ink disabled:opacity-40"><Plus className="h-4 w-4" /></button>
            </>)}
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="Text size">
            <button type="button" aria-label="Smaller text" disabled={sizeIdx === 0} onClick={() => { setSizeIdx(sizeIdx - 1); writeStore(SIZE_KEY, String(sizeIdx - 1)); }} className="grid h-11 w-11 place-items-center rounded-full border border-line bg-surface-1 text-ink hover:bg-surface-3 disabled:opacity-40"><span className="text-xs font-bold" aria-hidden>A-</span></button>
            <button type="button" aria-label="Larger text" disabled={sizeIdx === SIZES.length - 1} onClick={() => { setSizeIdx(sizeIdx + 1); writeStore(SIZE_KEY, String(sizeIdx + 1)); }} className="grid h-11 w-11 place-items-center rounded-full border border-line bg-surface-1 text-ink hover:bg-surface-3 disabled:opacity-40"><span className="text-base font-bold" aria-hidden>A+</span></button>
          </div>
        </div>
        <Script job={{ v: 1, title: view.title, script: view.script }} size={SIZES[sizeIdx]} />
      </section>

      <div className="h-24 shrink-0" aria-hidden />
      </div>
      {recording && autoScroll && held && <div role="status" className="pointer-events-none absolute inset-x-0 top-14 mx-auto w-fit rounded-full bg-surface-1/95 px-3 py-1 text-xs font-semibold text-ink shadow">Paused while you hold the screen</div>}
      </div>

      {full ? (
      <section className="shrink-0 border-t border-line-strong bg-surface-1 px-4 py-3 lg:w-[400px] lg:border-l lg:border-t-0" aria-label="Recording controls">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold ${practiceRef.current ? 'text-ink-dim' : elapsed < LEAD_IN ? 'text-warn' : 'text-ok'}`}>
              {practiceRef.current ? 'Rehearsing' : elapsed < LEAD_IN ? `Stay quiet for ${Math.ceil(LEAD_IN - elapsed)}...` : 'Read now'}
            </div>
            {target > 0 && <div className={`font-num text-xs ${remaining < 0 ? 'text-warn' : 'text-ink-dim'}`}>{remaining >= 0 ? `${formatClock(remaining)} left` : `${formatClock(-remaining)} over`}</div>}
            {confirmStop && <div className="text-xs font-semibold text-danger">Tap again to stop</div>}
          </div>
          <button type="button" onClick={stopPressed} aria-label={confirmStop ? 'Tap again to stop' : 'Stop recording'} className={`grid h-16 w-16 shrink-0 place-items-center rounded-full bg-danger transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${confirmStop ? 'ring-4 ring-danger/40' : ''}`}>
            <span className="h-6 w-6 rounded-[4px] bg-white" aria-hidden />
          </button>
        </div>
        {error && <div role="alert" className="mt-3 rounded-card border border-danger/40 bg-danger/10 p-3 text-sm text-ink">{error}</div>}
      </section>
      ) : (
      <section className="max-h-[58dvh] shrink-0 overflow-y-auto border-t border-line-strong bg-surface-1 px-4 py-3 lg:max-h-none lg:w-[400px] lg:border-l lg:border-t-0" aria-label="Recording controls">
        {error && <div role="alert" className="mb-3 rounded-card border border-danger/40 bg-danger/10 p-3 text-sm text-ink">{error}</div>}
        {notice && <div role="status" className="mb-3 rounded-card border border-line-strong bg-surface-2 p-3 text-sm text-ink">{notice}</div>}

        {phase === 'recording' ? (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" aria-hidden /><span className="text-sm font-semibold text-danger">{practiceRef.current ? 'Rehearsing' : 'Recording'}</span></div>
              <div className="font-num text-2xl text-ink" aria-label="Time recorded">{formatClock(elapsed)}</div>
              {target > 0 && <div className={`font-num text-xs ${remaining < 0 ? 'text-warn' : 'text-ink-dim'}`}>{remaining >= 0 ? `${formatClock(remaining)} left` : `${formatClock(-remaining)} over`}</div>}
            </div>
            {!practiceRef.current && (
              <div role="status" className={`mb-3 rounded-card border p-2 text-center text-sm font-semibold ${elapsed < LEAD_IN ? 'border-warn/40 bg-warn/10 text-ink' : 'border-ok/40 bg-ok/10 text-ink'}`}>
                {elapsed < LEAD_IN ? `Stay quiet for ${Math.ceil(LEAD_IN - elapsed)}...` : 'Read now'}
              </div>
            )}
            <Button size="lg" variant={confirmStop ? 'danger' : 'secondary'} className="h-14 w-full text-base" onClick={stopPressed} leftIcon={<Square className="h-4 w-4" />}>
              {confirmStop ? 'Tap again to stop' : 'Stop'}
            </Button>
            <p className="mt-2 text-center text-[11px] text-ink-faint">Keep this page open and the screen on. Stop needs two taps so a pocket touch cannot end the take.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {take && (
              <div className="rounded-card border border-line bg-surface-2 p-3">
                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-ink-dim">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${take.practice ? 'border border-line bg-surface-1 text-ink-dim' : 'bg-accent text-accent-ink'}`}>{take.practice ? 'Rehearsal' : 'Your take'}</span>
                  <span className="font-num">{formatClock(take.seconds)} · {(wavBytes(take.seconds, take.sampleRate, take.bits) / 1048576).toFixed(1)} MB</span>
                </div>
                {take.issues && take.issues.length > 0 && (
                  <div role="alert" className="mb-3 rounded-card border border-warn/40 bg-warn/10 p-2"><div className="mb-1.5 text-xs font-semibold text-ink">Problems with this recording</div>
                    <ul className="space-y-1.5">{take.issues.map((i) => <li key={i.id} className="flex items-start gap-2 text-sm text-ink"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />{i.text}</li>)}</ul>
                  </div>
                )}
                {take.report && take.report.overall !== 'ok' && !sentCount && (
                  <div className="mb-3 rounded-card border border-line bg-surface-1 p-2"><div className="mb-1.5 text-xs font-semibold text-ink-dim">Before you send</div><Findings report={take.report} /></div>
                )}
                {!take.practice && !view.talent && (
                  <Input label="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="So the producer knows whose take this is" className="mb-3" />
                )}
                <audio key={take.url} src={take.url} controls className="mb-3 w-full" aria-label={take.practice ? 'Play rehearsal' : 'Play your take'} />
                {take.practice ? (
                  <p className="text-xs text-ink-dim">Rehearsals are never saved or sent.</p>
                ) : (
                  <>
                    {remote && (
                      <textarea value={sendNote} onChange={(e) => setSendNote(e.target.value)} rows={2} maxLength={4000} aria-label="Add a note with your take" placeholder="Add a note with your take (optional)" disabled={busySending} className="mb-2 w-full resize-y rounded-card border border-line-strong bg-surface-1 p-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40" />
                    )}
                    <div className="flex flex-wrap gap-2">
                      {remote ? (
                        <Button size="md" variant="primary" disabled={busySending} onClick={() => void send()} leftIcon={<Send className="h-4 w-4" />}>{busySending ? `Sending ${Math.round((sending ?? 0) * 100)}%` : 'Send to producer'}</Button>
                      ) : (
                        <>
                          <SaveMenu look="button" label="Save WAV" folder={['Jobs', view.title || 'Recording']} name={fileFor(take)} getBlob={async () => take.blob} />
                        </>
                      )}
                      <Button size="md" variant="ghost" disabled={busySending} onClick={() => void dropTake()} leftIcon={<Trash2 className="h-4 w-4" />}>Delete</Button>
                    </div>
                    <p className="mt-2 text-xs text-ink-dim">
                      {remote ? 'Until you press Send, this take only exists on this device. The server keeps it for 30 days.' : `Save the file and send it to ${view.producer || 'the producer'}.`}
                    </p>
                  </>
                )}
              </div>
            )}
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Button size="lg" variant={take && !take.practice ? 'secondary' : 'primary'} className="h-14 w-full whitespace-nowrap text-base" disabled={!cap.ok || busySending} onClick={() => void start(false)} leftIcon={take && !take.practice ? <RotateCcw className="h-4 w-4" /> : <Mic className="h-4 w-4" />}>
                {confirmReplace ? 'Tap again to delete your take and retake' : take && !take.practice ? 'Retake' : sentCount > 0 ? 'Record another take' : 'Record'}
              </Button>
              <Button size="lg" variant="ghost" className="h-14 text-base" disabled={!cap.ok || busySending} onClick={() => void start(true)}>Rehearse</Button>
            </div>
            {target > 0 && <p className="text-center text-[11px] text-ink-faint">About {formatClock(target)}{view.targetSeconds ? '' : ' (estimated)'}. Headphones help.</p>}
          </div>
        )}
      </section>
      )}
      </div>
      )}
    </main>
  );
};

export default GuestPage;
