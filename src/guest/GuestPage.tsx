import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Mic, RotateCcw, Send, Share2, Square, Trash2, Minus, Plus } from 'lucide-react';
import { Button, Input } from '../components/ui';
import { MicCapture } from './capture';
import { MODE_TEXT } from './channels';
import { checkRoom, type RoomReport } from './roomCheck';
import { Findings, SetupPanel, int16ToFloat, type SetupInfo } from './SetupPanel';
import { checkRecording } from './env';
import { countWords, estimateSeconds, formatClock, jobFromHash, parseScript, type GuestJob } from './job';
import { beginSession, deleteSession, findSaved, finishSession, loadSession, saveChunk, type SavedSession } from './takeStore';
import { takeFileName, totalSamples, wavBlob, wavBytes } from './wavWriter';
import { audioUrl, getThread, postMessage, sendAudio, type ThreadMessage, type ThreadResponse } from '../jobs/api';
import { parseTalentHash } from '../jobs/links';
import { ThreadView } from '../jobs/ThreadView';
import { usePolling } from '../jobs/usePolling';

interface Take {
  n: number;
  sessionId: string;
  chunks: Int16Array[];
  sampleRate: number;
  seconds: number;
  blob: Blob;
  url: string;
  /** A rehearsal: never saved to the device, never sent */
  practice: boolean;
  /** What was heard in the quiet lead-in and the speech (real takes only) */
  report?: RoomReport;
  /** One line about the microphone, added to the Send message */
  capture?: string;
}

const NAME_KEY = 'uuda-guest-name';
const SIZE_KEY = 'uuda-guest-text-size';
const MIC_KEY = 'uuda-guest-mic';
const SIZES = [16, 18, 20, 24, 28, 34];
/** Seconds of quiet at the start of a real take; the room noise heard here is what the producer's cleaner learns from */
const LEAD_IN = 3;

const readStore = (k: string): string => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const writeStore = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* not saved */ } };

const makeTake = (n: number, sessionId: string, chunks: Int16Array[], sampleRate: number, practice = false): Take => {
  const blob = wavBlob(chunks, sampleRate);
  return { n, sessionId, chunks, sampleRate, seconds: totalSamples(chunks) / sampleRate, blob, url: URL.createObjectURL(blob), practice };
};

const Script: React.FC<{ job: GuestJob; size: number }> = ({ job, size }) => {
  const parts = useMemo(() => parseScript(job.script), [job.script]);
  if (parts.length === 0) return <p className="text-ink-dim" style={{ fontSize: size }}>The producer has not added a script. Record what they asked for.</p>;
  return (
    <div className="whitespace-pre-wrap leading-relaxed text-ink" style={{ fontSize: size }}>
      {parts.map((p, i) =>
        p.kind === 'note' ? (
          <span key={i} className="mx-0.5 inline-block rounded border border-accent/40 bg-accent/10 px-1.5 py-px align-baseline text-[0.7em] font-semibold italic text-accent" aria-label={`Director's note: ${p.text}`}>
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </div>
  );
};

/** What the page shows about the job, wherever it came from (the link itself, or the server) */
interface View {
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
  const loadThread = useCallback(async () => {
    if (!remote) return;
    const after = messages.length ? messages[messages.length - 1].id : 0;
    try {
      const t = await getThread(remote.jobId, remote.key, after);
      setThread(t); setLoadError('');
      if (t.messages.length) setMessages((all) => [...all, ...t.messages.filter((m) => !all.some((x) => x.id === m.id))]);
    } catch (e) { if (!thread) setLoadError(e instanceof Error ? e.message : 'The job could not be opened.'); }
  }, [remote, messages, thread]);
  usePolling(loadThread, 6000, !!remote);

  const view: View | null = remote
    ? thread ? { title: thread.job.title, script: thread.job.script, notes: thread.job.notes, producer: thread.job.producer, targetSeconds: thread.job.targetSeconds ?? undefined, referenceId: thread.job.reference?.id } : null
    : offlineJob ? { title: offlineJob.title, script: offlineJob.script, notes: '', producer: offlineJob.producer ?? '', targetSeconds: offlineJob.targetSeconds } : null;

  const [name, setName] = useState(() => readStore(NAME_KEY));
  const [sizeIdx, setSizeIdx] = useState(() => { const i = Number(readStore(SIZE_KEY)); return Number.isInteger(i) && i >= 0 && i < SIZES.length ? i : 2; });
  const [phase, setPhase] = useState<'ready' | 'recording'>('ready');
  const [take, setTake] = useState<Take | null>(null);
  const [practiceNext, setPracticeNext] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [saved, setSaved] = useState<SavedSession | null>(null);
  const [notice, setNotice] = useState('');
  const [sentCount, setSentCount] = useState(0);
  const [sending, setSending] = useState<number | null>(null);
  const [sendNote, setSendNote] = useState('');
  const [micId, setMicId] = useState(() => readStore(MIC_KEY));
  const [setupOpen, setSetupOpen] = useState(false);
  const infoRef = useRef<SetupInfo | null>(null);
  const capRef = useRef<MicCapture | null>(null);
  const chunksRef = useRef<Int16Array[]>([]);
  const sessionRef = useRef('');
  const samplesRef = useRef(0);
  const practiceRef = useRef(false);
  const takeRef = useRef<Take | null>(null);
  takeRef.current = take;

  useEffect(() => { if (view) document.title = `${view.title} · Uuda recording`; }, [view?.title]);
  useEffect(() => { void findSaved(jobKey).then(setSaved); }, [jobKey]);
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
    setLevel(0);
    const chunks = chunksRef.current;
    const practice = practiceRef.current;
    if (totalSamples(chunks) === 0) { if (!practice) void deleteSession(sessionRef.current); return; }
    if (!practice) await finishSession(sessionRef.current);
    const t = makeTake(1, practice ? '' : sessionRef.current, chunks, c.sampleRate, practice);
    if (!practice) {
      t.report = checkRoom(int16ToFloat(chunks), c.sampleRate);
      t.capture = `Recorded on: ${c.label || 'microphone'}, ${Math.round(c.sampleRate / 100) / 10} kHz, ${MODE_TEXT[c.channelMode]}`;
    }
    setTake(t);
    if (lost) setNotice('The microphone stopped. What was recorded so far is kept as your take.');
  }, []);

  const start = async (practice: boolean) => {
    setError(''); setNotice('');
    if (!practice && !name.trim()) { setError('Type your name first, so the producer knows whose take this is.'); return; }
    // Recording over an unsent take deletes it, so ask first
    if (take && !take.practice && !confirmReplace) { setConfirmReplace(true); return; }
    setConfirmReplace(false);
    if (!practice) writeStore(NAME_KEY, name.trim());
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
        onLevel: (p) => setLevel(p),
        onLost: () => void finish(true),
      }, micId || undefined);
    } catch (e) {
      await c.stop();
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      setError(denied ? 'The microphone is blocked. Allow it for this page in the browser (the lock or settings icon next to the address), then press Record again.' : e instanceof DOMException && (e.name === 'OverconstrainedError' || e.name === 'NotReadableError') && micId ? 'The chosen microphone is not available. Pick another one in Your microphone, or plug it back in.' : e instanceof DOMException && e.name === 'NotFoundError' ? 'No microphone was found. Plug one in or check your device.' : 'The microphone could not be started. Close other apps that use it and try again.');
      return;
    }
    await dropTake();
    capRef.current = c;
    if (!practice) {
      await beginSession({ id: sessionRef.current, jobKey, sampleRate: c.sampleRate, startedAt: Date.now() });
      // blocks that arrived before the session record existed are saved by index again
      chunksRef.current.forEach((pcm, i) => void saveChunk(sessionRef.current, i, pcm));
    }
    setPhase('recording');
  };

  const stopPressed = () => { if (!confirmStop) { setConfirmStop(true); return; } void finish(false); };

  // Space starts and stops a take on a keyboard. Stopping keeps the two-press guard.
  const spaceRef = useRef<() => void>(() => undefined);
  spaceRef.current = () => { if (phase === 'recording') stopPressed(); else if (cap.ok && sending === null && !take) void start(false); };
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
    setTake(makeTake(1, saved.id, chunks, saved.sampleRate)); setSaved(null);
  };
  const forget = async () => { if (saved) await deleteSession(saved.id); setSaved(null); };

  const fileFor = (t: Take) => takeFileName(view?.title ?? '', name, t.n);
  const download = (t: Take) => { const a = document.createElement('a'); a.href = t.url; a.download = fileFor(t); document.body.appendChild(a); a.click(); a.remove(); };
  const share = async (t: Take) => {
    const file = new File([t.blob], fileFor(t), { type: 'audio/wav' });
    try { await navigator.share({ files: [file], title: view?.title ?? 'Recording', text: `Recording from ${name.trim() || 'the talent'}` }); } catch { /* cancelled */ }
  };
  const canShare = (t: Take) => { try { return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([t.blob], fileFor(t), { type: 'audio/wav' })] }); } catch { return false; } };

  /** Sends the take into the thread. The take is only removed from the device after the server says it has it. */
  const send = async () => {
    if (!remote || !take || take.practice) return;
    if (!name.trim()) { setError('Type your name first, so the producer knows whose take this is.'); return; }
    writeStore(NAME_KEY, name.trim());
    setError(''); setSending(0);
    try {
      await sendAudio(remote.jobId, remote.key, take.blob, { name: fileFor(take), who: name.trim(), text: [sendNote.trim(), take.capture].filter(Boolean).join('\n\n') }, (f) => setSending(f));
      await dropTake();
      setSendNote(''); setSentCount((n) => n + 1); setNotice('Sent. The producer can hear it now. You can reply below or record another take.');
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
  const remaining = target - elapsed;
  const words = countWords(view.script);
  const busySending = sending !== null;

  return (
    <main className="flex min-h-screen flex-col bg-surface-0 text-ink lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[auto_1fr]" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="border-b border-line px-4 pb-3 pt-4 lg:col-span-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-accent">Voice recording</div>
        <h1 className="text-xl font-semibold leading-tight">{view.title}</h1>
        {view.producer && <div className="text-sm text-ink-dim">from {view.producer}</div>}
      </header>

      <div className="flex min-w-0 flex-1 flex-col lg:col-start-1 lg:row-start-2">
      {!cap.ok && <div role="alert" className="m-4 rounded-card border border-warn/40 bg-warn/10 p-3 text-sm text-ink">{cap.problem}</div>}

      {saved && !take && phase === 'ready' && (
        <div className="m-4 flex flex-wrap items-center gap-3 rounded-card border border-line-strong bg-surface-2 p-3 text-sm">
          <span className="min-w-0 flex-1">A recording from earlier is still on this device ({formatClock((saved.chunkCount * 4096) / saved.sampleRate)} long).</span>
          <Button size="sm" variant="primary" onClick={() => void recover()}>Get it back</Button>
          <Button size="sm" variant="ghost" onClick={() => void forget()}>Delete it</Button>
        </div>
      )}

      <section className="px-4 py-4" aria-label="Script">
        {remote && thread?.job.reference && (
          <div className="mb-4 rounded-card border border-line bg-surface-2 p-3">
            <div className="mb-1.5 text-xs font-medium text-ink-dim">Reference: listen to how it should sound</div>
            <audio controls preload="none" src={audioUrl(remote.jobId, thread.job.reference.id, remote.key)} className="w-full" aria-label="Reference recording" />
          </div>
        )}
        {view.notes && (
          <div className="mb-4 rounded-card border border-accent/30 bg-accent/10 p-3" aria-label="Director's notes">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-accent">Director's notes</div>
            <p className="whitespace-pre-wrap text-sm text-ink">{view.notes}</p>
          </div>
        )}
        <div className="mb-3 flex items-center justify-between gap-2 text-xs text-ink-dim">
          <span>{words > 0 ? `${words} words to read` : 'No script'}</span>
          <div className="flex items-center gap-1" role="group" aria-label="Text size">
            <button type="button" aria-label="Smaller text" disabled={sizeIdx === 0} onClick={() => { setSizeIdx(sizeIdx - 1); writeStore(SIZE_KEY, String(sizeIdx - 1)); }} className="grid h-11 w-11 place-items-center rounded-full border border-line bg-surface-1 text-ink hover:bg-surface-3 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
            <button type="button" aria-label="Larger text" disabled={sizeIdx === SIZES.length - 1} onClick={() => { setSizeIdx(sizeIdx + 1); writeStore(SIZE_KEY, String(sizeIdx + 1)); }} className="grid h-11 w-11 place-items-center rounded-full border border-line bg-surface-1 text-ink hover:bg-surface-3 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
          </div>
        </div>
        <Script job={{ v: 1, title: view.title, script: view.script }} size={SIZES[sizeIdx]} />
      </section>

      {remote && (
        <section className="flex-1 border-t border-line px-4 py-4" aria-label="Messages with the producer">
          <h2 className="mb-2 text-sm font-semibold">Messages</h2>
          <ThreadView
            messages={messages}
            self="talent"
            audioSrc={(a) => audioUrl(remote.jobId, a.id, remote.key)}
            onSend={async (text) => { await postMessage(remote.jobId, remote.key, name.trim() || 'Talent', text); await loadThread(); }}
            placeholder="Write to the producer"
          />
        </section>
      )}
      {!remote && <div className="flex-1" />}
      </div>

      <section className={`${take && phase !== 'recording' ? '' : 'sticky bottom-0 '}border-t border-line-strong bg-surface-1 px-4 py-3 lg:sticky lg:bottom-auto lg:top-0 lg:col-start-2 lg:row-start-2 lg:max-h-screen lg:self-start lg:overflow-y-auto lg:border-l lg:border-t-0`} aria-label="Recording controls">
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
            <div className="mb-3 h-2 overflow-hidden rounded-full bg-surface-3" role="meter" aria-label="Input level" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(level.toFixed(2))}>
              <div className={`h-full rounded-full ${level > 0.95 ? 'bg-danger' : level > 0.7 ? 'bg-warn' : 'bg-ok'}`} style={{ width: `${Math.min(100, level * 100)}%`, transition: 'width 60ms linear' }} />
            </div>
            <Button size="lg" variant={confirmStop ? 'danger' : 'secondary'} className="h-14 w-full text-base" onClick={stopPressed} leftIcon={<Square className="h-4 w-4" />}>
              {confirmStop ? 'Tap again to stop' : 'Stop'}
            </Button>
            <p className="mt-2 text-center text-[11px] text-ink-faint">Keep this page open and the screen on. Stop needs two taps so a pocket touch cannot end the take.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <button type="button" aria-expanded={setupOpen} onClick={() => setSetupOpen((o) => !o)} className="mb-2 text-xs font-medium text-accent hover:underline">{setupOpen ? 'Hide microphone setup' : 'Microphone and room check'}</button>
              {setupOpen && <SetupPanel micId={micId} onMicId={(id) => { setMicId(id); writeStore(MIC_KEY, id); }} disabled={!cap.ok || busySending} onInfo={(i) => { infoRef.current = i; }} />}
            </div>
            <Input label="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="So the producer knows whose take this is" />
            {take && (
              <div className="rounded-card border border-line bg-surface-2 p-3">
                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-ink-dim">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${take.practice ? 'border border-line bg-surface-1 text-ink-dim' : 'bg-accent text-accent-ink'}`}>{take.practice ? 'Rehearsal' : 'Your take'}</span>
                  <span className="font-num">{formatClock(take.seconds)} · {(wavBytes(take.seconds, take.sampleRate) / 1048576).toFixed(1)} MB</span>
                </div>
                {take.report && take.report.overall !== 'ok' && !sentCount && (
                  <div className="mb-3 rounded-card border border-line bg-surface-1 p-2"><div className="mb-1.5 text-xs font-semibold text-ink-dim">Before you send</div><Findings report={take.report} /></div>
                )}
                <audio key={take.url} src={take.url} controls className="mb-3 w-full" aria-label={take.practice ? 'Play rehearsal' : 'Play your take'} />
                {take.practice ? (
                  <p className="text-xs text-ink-dim">A rehearsal is never saved or sent. When you are ready, press Record.</p>
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
                          <Button size="md" variant="primary" onClick={() => download(take)} leftIcon={<Download className="h-4 w-4" />}>Download WAV</Button>
                          {canShare(take) && <Button size="md" variant="secondary" onClick={() => void share(take)} leftIcon={<Share2 className="h-4 w-4" />}>Share</Button>}
                        </>
                      )}
                      <Button size="md" variant="ghost" disabled={busySending} onClick={() => void dropTake()} leftIcon={<Trash2 className="h-4 w-4" />}>Delete</Button>
                    </div>
                    <p className="mt-2 text-xs text-ink-dim">
                      {remote ? 'Listen first. Send puts it in the messages above for the producer. Until you press Send it only exists on this device.' : `Listen first. When you are happy, download the file (or Share) and send it to ${view.producer || 'the producer'} by email or WhatsApp. Attach the file; do not paste a link to it.`}
                    </p>
                  </>
                )}
              </div>
            )}
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Button size="lg" variant={take && !take.practice ? 'secondary' : 'primary'} className="h-14 w-full text-base" disabled={!cap.ok || busySending} onClick={() => void start(false)} leftIcon={take && !take.practice ? <RotateCcw className="h-4 w-4" /> : <Mic className="h-4 w-4" />}>
                {confirmReplace ? 'Tap again to delete your take and retake' : take && !take.practice ? 'Retake' : sentCount > 0 ? 'Record another take' : 'Record'}
              </Button>
              <Button size="lg" variant="ghost" className="h-14 text-base" disabled={!cap.ok || busySending} onClick={() => void start(true)}>Rehearse</Button>
            </div>
            {target > 0 && <p className="text-center text-[11px] text-ink-faint">Aim for about {formatClock(target)}{view.targetSeconds ? '' : ' (estimated from the script)'}. Use headphones and a quiet room. Rehearse as often as you like: nothing is saved.</p>}
          </div>
        )}
      </section>
    </main>
  );
};

export default GuestPage;
