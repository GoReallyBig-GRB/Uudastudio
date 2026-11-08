import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Mic, RotateCcw, Share2, Square, Trash2, Minus, Plus } from 'lucide-react';
import { Button, Input } from '../components/ui';
import { MicCapture } from './capture';
import { checkRecording } from './env';
import { countWords, estimateSeconds, formatClock, jobFromHash, parseScript, type GuestJob } from './job';
import { beginSession, deleteSession, findSaved, finishSession, loadSession, saveChunk, type SavedSession } from './takeStore';
import { takeFileName, totalSamples, wavBlob, wavBytes } from './wavWriter';

interface Take {
  n: number;
  sessionId: string;
  chunks: Int16Array[];
  sampleRate: number;
  seconds: number;
  blob: Blob;
  url: string;
}

const NAME_KEY = 'uuda-guest-name';
const SIZE_KEY = 'uuda-guest-text-size';
const SIZES = [16, 18, 20, 24, 28, 34];

const readStore = (k: string): string => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const writeStore = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* not saved */ } };

const makeTake = (n: number, sessionId: string, chunks: Int16Array[], sampleRate: number): Take => {
  const blob = wavBlob(chunks, sampleRate);
  return { n, sessionId, chunks, sampleRate, seconds: totalSamples(chunks) / sampleRate, blob, url: URL.createObjectURL(blob) };
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

/** The page a voice talent opens from the producer's link: script, record, retake, download or share the WAV. */
export const GuestPage: React.FC = () => {
  const hash = window.location.hash;
  const job = useMemo(() => jobFromHash(hash), [hash]);
  const jobKey = hash.slice(0, 200);
  const cap = useMemo(
    () => checkRecording({ userAgent: navigator.userAgent, hasMediaDevices: !!navigator.mediaDevices?.getUserMedia, isSecureContext: window.isSecureContext, hasAudioContext: typeof AudioContext !== 'undefined' || 'webkitAudioContext' in window }),
    [],
  );

  const [name, setName] = useState(() => readStore(NAME_KEY));
  const [sizeIdx, setSizeIdx] = useState(() => { const i = Number(readStore(SIZE_KEY)); return Number.isInteger(i) && i >= 0 && i < SIZES.length ? i : 2; });
  const [phase, setPhase] = useState<'ready' | 'recording'>('ready');
  const [takes, setTakes] = useState<Take[]>([]);
  const [current, setCurrent] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);
  const [saved, setSaved] = useState<SavedSession | null>(null);
  const [notice, setNotice] = useState('');
  const capRef = useRef<MicCapture | null>(null);
  const chunksRef = useRef<Int16Array[]>([]);
  const sessionRef = useRef('');
  const samplesRef = useRef(0);
  const takesRef = useRef<Take[]>([]);
  takesRef.current = takes;

  useEffect(() => { if (job) document.title = `${job.title} · Uuda recording`; }, [job]);
  useEffect(() => { void findSaved(jobKey).then(setSaved); }, [jobKey]);
  useEffect(() => () => takesRef.current.forEach((t) => URL.revokeObjectURL(t.url)), []);
  useEffect(() => {
    if (phase !== 'recording') return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);
  useEffect(() => { if (!confirmStop) return; const t = window.setTimeout(() => setConfirmStop(false), 3500); return () => window.clearTimeout(t); }, [confirmStop]);

  const finish = useCallback(async (lost: boolean) => {
    const c = capRef.current;
    if (!c) return;
    capRef.current = null;
    await c.stop();
    setPhase('ready');
    setConfirmStop(false);
    setLevel(0);
    const chunks = chunksRef.current;
    if (totalSamples(chunks) === 0) { void deleteSession(sessionRef.current); return; }
    await finishSession(sessionRef.current);
    const take = makeTake(takesRef.current.length + 1, sessionRef.current, chunks, c.sampleRate);
    setTakes((t) => [...t, take]);
    setCurrent(take.n - 1);
    if (lost) setNotice('The microphone stopped. What was recorded so far is kept as a take.');
  }, []);

  const start = async () => {
    setError(''); setNotice('');
    if (!name.trim()) { setError('Type your name first, so the producer knows whose take this is.'); return; }
    writeStore(NAME_KEY, name.trim());
    const c = new MicCapture();
    chunksRef.current = []; samplesRef.current = 0; setElapsed(0);
    sessionRef.current = `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      await c.start({
        onBlock: (pcm, i) => {
          chunksRef.current.push(pcm);
          samplesRef.current += pcm.length;
          setElapsed(samplesRef.current / c.sampleRate);
          void saveChunk(sessionRef.current, i, pcm);
        },
        onLevel: (p) => setLevel(p),
        onLost: () => void finish(true),
      });
    } catch (e) {
      await c.stop();
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      setError(denied ? 'The microphone is blocked. Allow it for this page in the browser (the lock or settings icon next to the address), then press Record again.' : e instanceof DOMException && e.name === 'NotFoundError' ? 'No microphone was found. Plug one in or check your device.' : 'The microphone could not be started. Close other apps that use it and try again.');
      return;
    }
    capRef.current = c;
    await beginSession({ id: sessionRef.current, jobKey, sampleRate: c.sampleRate, startedAt: Date.now() });
    // blocks that arrived before the session record existed are saved by index again
    chunksRef.current.forEach((pcm, i) => void saveChunk(sessionRef.current, i, pcm));
    setPhase('recording');
  };

  const stopPressed = () => { if (!confirmStop) { setConfirmStop(true); return; } void finish(false); };

  const recover = async () => {
    if (!saved) return;
    const chunks = await loadSession(saved.id);
    if (chunks.length === 0) { setSaved(null); return; }
    const take = makeTake(takes.length + 1, saved.id, chunks, saved.sampleRate);
    setTakes((t) => [...t, take]); setCurrent(take.n - 1); setSaved(null);
  };
  const forget = async () => { if (saved) await deleteSession(saved.id); setSaved(null); };

  const discard = async (t: Take) => {
    URL.revokeObjectURL(t.url);
    await deleteSession(t.sessionId);
    setTakes((all) => all.filter((x) => x.n !== t.n));
    setCurrent(0);
  };

  const fileFor = (t: Take) => takeFileName(job?.title ?? '', name, t.n);
  const download = (t: Take) => { const a = document.createElement('a'); a.href = t.url; a.download = fileFor(t); document.body.appendChild(a); a.click(); a.remove(); };
  const share = async (t: Take) => {
    const file = new File([t.blob], fileFor(t), { type: 'audio/wav' });
    try { await navigator.share({ files: [file], title: job?.title ?? 'Recording', text: `Recording from ${name.trim() || 'the talent'}` }); } catch { /* cancelled */ }
  };
  const canShare = (t: Take) => { try { return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([t.blob], fileFor(t), { type: 'audio/wav' })] }); } catch { return false; } };

  if (!job) {
    return (
      <main className="grid min-h-screen place-items-center bg-surface-0 p-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-lg font-semibold text-ink">This link did not open</h1>
          <p className="mt-2 text-sm text-ink-dim">The recording link looks incomplete. It may have been cut off when it was sent. Ask the producer to send it again.</p>
        </div>
      </main>
    );
  }

  const target = job.targetSeconds ?? (job.script.trim() ? estimateSeconds(job.script) : 0);
  const remaining = target - elapsed;
  const take = takes[current];
  const words = countWords(job.script);

  return (
    <main className="flex min-h-screen flex-col bg-surface-0 text-ink" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="border-b border-line px-4 pb-3 pt-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-accent">Voice recording</div>
        <h1 className="text-xl font-semibold leading-tight">{job.title}</h1>
        {job.producer && <div className="text-sm text-ink-dim">from {job.producer}</div>}
      </header>

      {!cap.ok && <div role="alert" className="m-4 rounded-card border border-warn/40 bg-warn/10 p-3 text-sm text-ink">{cap.problem}</div>}

      {saved && takes.length === 0 && phase === 'ready' && (
        <div className="m-4 flex flex-wrap items-center gap-3 rounded-card border border-line-strong bg-surface-2 p-3 text-sm">
          <span className="min-w-0 flex-1">A recording from earlier is still on this device ({formatClock((saved.chunkCount * 4096) / saved.sampleRate)} long).</span>
          <Button size="sm" variant="primary" onClick={() => void recover()}>Get it back</Button>
          <Button size="sm" variant="ghost" onClick={() => void forget()}>Delete it</Button>
        </div>
      )}

      <section className="flex-1 px-4 py-4" aria-label="Script">
        <div className="mb-3 flex items-center justify-between gap-2 text-xs text-ink-dim">
          <span>{words > 0 ? `${words} words to read` : 'No script'}</span>
          <div className="flex items-center gap-1" role="group" aria-label="Text size">
            <button type="button" aria-label="Smaller text" disabled={sizeIdx === 0} onClick={() => { setSizeIdx(sizeIdx - 1); writeStore(SIZE_KEY, String(sizeIdx - 1)); }} className="grid h-11 w-11 place-items-center rounded-full border border-line bg-surface-1 text-ink hover:bg-surface-3 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
            <button type="button" aria-label="Larger text" disabled={sizeIdx === SIZES.length - 1} onClick={() => { setSizeIdx(sizeIdx + 1); writeStore(SIZE_KEY, String(sizeIdx + 1)); }} className="grid h-11 w-11 place-items-center rounded-full border border-line bg-surface-1 text-ink hover:bg-surface-3 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
          </div>
        </div>
        <Script job={job} size={SIZES[sizeIdx]} />
      </section>

      <section className="sticky bottom-0 border-t border-line-strong bg-surface-1 px-4 py-3" aria-label="Recording controls">
        {error && <div role="alert" className="mb-3 rounded-card border border-danger/40 bg-danger/10 p-3 text-sm text-ink">{error}</div>}
        {notice && <div role="status" className="mb-3 rounded-card border border-line-strong bg-surface-2 p-3 text-sm text-ink">{notice}</div>}

        {phase === 'recording' ? (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" aria-hidden /><span className="text-sm font-semibold text-danger">Recording</span></div>
              <div className="font-num text-2xl text-ink" aria-label="Time recorded">{formatClock(elapsed)}</div>
              {target > 0 && <div className={`font-num text-xs ${remaining < 0 ? 'text-warn' : 'text-ink-dim'}`}>{remaining >= 0 ? `${formatClock(remaining)} left` : `${formatClock(-remaining)} over`}</div>}
            </div>
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
            <Input label="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="So the producer knows whose take this is" />
            {take && (
              <div className="rounded-card border border-line bg-surface-2 p-3">
                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-ink-dim">
                  <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Takes">
                    {takes.map((t, i) => (
                      <button key={t.n} type="button" role="tab" aria-selected={i === current} onClick={() => setCurrent(i)} className={`h-8 rounded-full px-3 text-xs font-semibold ${i === current ? 'bg-accent text-accent-ink' : 'border border-line bg-surface-1 text-ink-dim hover:text-ink'}`}>Take {t.n}</button>
                    ))}
                  </div>
                  <span className="font-num">{formatClock(take.seconds)} · {(wavBytes(take.seconds, take.sampleRate) / 1048576).toFixed(1)} MB</span>
                </div>
                <audio key={take.url} src={take.url} controls className="mb-3 w-full" aria-label={`Play take ${take.n}`} />
                <div className="flex flex-wrap gap-2">
                  <Button size="md" variant="primary" onClick={() => download(take)} leftIcon={<Download className="h-4 w-4" />}>Download WAV</Button>
                  {canShare(take) && <Button size="md" variant="secondary" onClick={() => void share(take)} leftIcon={<Share2 className="h-4 w-4" />}>Share</Button>}
                  <Button size="md" variant="ghost" onClick={() => void discard(take)} leftIcon={<Trash2 className="h-4 w-4" />}>Delete take</Button>
                </div>
                <p className="mt-2 text-xs text-ink-dim">Listen to it first. When you are happy, download the file (or Share) and send it to {job.producer || 'the producer'} by email or WhatsApp. Attach the file; do not paste a link to it.</p>
              </div>
            )}
            <Button size="lg" variant={take ? 'secondary' : 'primary'} className="h-14 w-full text-base" disabled={!cap.ok} onClick={() => void start()} leftIcon={take ? <RotateCcw className="h-4 w-4" /> : <Mic className="h-4 w-4" />}>
              {take ? 'Record another take' : 'Record'}
            </Button>
            {target > 0 && <p className="text-center text-[11px] text-ink-faint">Aim for about {formatClock(target)}{job.targetSeconds ? '' : ' (estimated from the script)'}. Use headphones and a quiet room.</p>}
          </div>
        )}
      </section>
    </main>
  );
};

export default GuestPage;
