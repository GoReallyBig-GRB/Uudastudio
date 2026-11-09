import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Mic, X, Usb, Bluetooth, Laptop } from 'lucide-react';
import { Button } from '../components/ui';
import { MicCapture } from './capture';
import { MODE_TEXT, type ChannelMode } from './channels';
import type { MicInfo } from './devices';
import { checkRoom, type Level, type RoomReport } from './roomCheck';

const QUIET_SECONDS = 4;
const TEST_SECONDS = 10;

export const int16ToFloat = (chunks: readonly Int16Array[]): Float32Array => {
  const n = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) for (let i = 0; i < c.length; i++) out[o++] = c[i] / 32768;
  return out;
};

export const LEVEL_STYLE: Record<Level, { icon: React.ReactNode; cls: string }> = {
  ok: { icon: <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-hidden />, cls: 'text-ink' },
  warn: { icon: <AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-hidden />, cls: 'text-ink' },
  problem: { icon: <XCircle className="h-4 w-4 shrink-0 text-danger" aria-hidden />, cls: 'text-ink' },
};

export const Findings: React.FC<{ report: RoomReport }> = ({ report }) => (
  <ul className="space-y-1.5" aria-label="Setup check results">
    {report.findings.map((f) => (
      <li key={f.id} className={`flex items-start gap-2 text-sm ${LEVEL_STYLE[f.level].cls}`}>{LEVEL_STYLE[f.level].icon}<span>{f.text}</span></li>
    ))}
  </ul>
);

export interface SetupInfo { micLabel: string; sampleRate: number; channelMode: ChannelMode }

interface SheetProps {
  open: boolean;
  onClose: () => void;
  mics: MicInfo[];
  micId: string;
  onMicId: (id: string) => void;
  /** A microphone that was plugged in after the page opened */
  fresh: MicInfo | null;
  /** Ask the browser for the microphone (labels only appear after that) and re-list */
  onAllow: () => Promise<void>;
  disabled: boolean;
  onResult: (info: SetupInfo, report: RoomReport) => void;
}

const kindOf = (m: MicInfo) => (m.bluetooth ? 'bluetooth' : /usb|samson|rode|røde|blue|yeti|fifine|fduce|shure|audio-technica|focusrite|scarlett|at2020|q2u|usb audio/i.test(m.label) ? 'usb' : 'builtin');

/**
 * The microphone sheet: a bottom sheet on a phone, a dialog on a computer. Pick the microphone from clear cards, then listen to the
 * room for ten seconds. Nothing from the test is kept or sent.
 */
export const MicSheet: React.FC<SheetProps> = ({ open, onClose, mics, micId, onMicId, fresh, onAllow, disabled, onResult }) => {
  const [phase, setPhase] = useState<'idle' | 'quiet' | 'read'>('idle');
  const [level, setLevel] = useState(0);
  const [report, setReport] = useState<RoomReport | null>(null);
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [error, setError] = useState('');
  const capRef = useRef<MicCapture | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { if (open) closeRef.current?.focus(); else { void capRef.current?.stop(); capRef.current = null; setPhase('idle'); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && phase === 'idle') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, phase, onClose]);
  useEffect(() => () => { void capRef.current?.stop(); }, []);

  if (!open) return null;
  const testing = phase !== 'idle';
  const named = mics.some((m) => m.label && !/^Microphone \d+$/.test(m.label));
  const choose = (id: string) => { onMicId(id); setReport(null); setInfo(null); setError(''); };

  const test = async () => {
    setError(''); setReport(null); setInfo(null);
    const c = new MicCapture();
    const chunks: Int16Array[] = [];
    let samples = 0, finished = false;
    const done = async () => {
      if (finished) return;
      finished = true; capRef.current = null;
      const sr = c.sampleRate, label = c.label, mode = c.channelMode;
      await c.stop();
      setPhase('idle'); setLevel(0);
      const r = checkRoom(int16ToFloat(chunks), sr);
      const i = { micLabel: label, sampleRate: sr, channelMode: mode };
      setReport(r); setInfo(i); onResult(i, r);
      void onAllow();
    };
    try {
      await c.start({
        onBlock: (pcm) => {
          chunks.push(pcm); samples += pcm.length;
          const s = samples / c.sampleRate;
          setPhase(s < QUIET_SECONDS ? 'quiet' : 'read');
          if (s >= TEST_SECONDS) void done();
        },
        onLevel: (p) => setLevel(p),
        onLost: () => { if (!finished) { finished = true; capRef.current = null; setPhase('idle'); setError('The microphone stopped during the test. Check it is plugged in and try again.'); } },
      }, micId || undefined);
      capRef.current = c;
      setPhase('quiet');
    } catch (e) {
      await c.stop();
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      setError(denied ? 'The microphone is blocked. Allow it for this page in the browser, then test again.' : 'That microphone could not be started. Pick another one or close other apps that use it.');
    }
  };

  const card = (id: string, label: string, kind: 'usb' | 'bluetooth' | 'builtin', note?: string) => {
    const on = micId === id;
    const Icon = kind === 'usb' ? Usb : kind === 'bluetooth' ? Bluetooth : Laptop;
    return (
      <li key={id || 'default'}>
        <button type="button" role="radio" aria-checked={on} disabled={testing || disabled} onClick={() => choose(id)}
          className={`flex min-h-14 w-full items-center gap-3 rounded-card border px-3 py-2 text-left transition-colors disabled:opacity-60 ${on ? 'border-accent bg-accent/10' : 'border-line bg-surface-2 hover:bg-surface-3'}`}>
          <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${on ? 'border-accent' : 'border-line-strong'}`} aria-hidden>{on && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}</span>
          <Icon className="h-4 w-4 shrink-0 text-ink-dim" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">{label}</span>
            {(note || kind === 'bluetooth') && <span className={`block text-[11px] ${kind === 'bluetooth' ? 'text-warn' : 'text-ink-dim'}`}>{kind === 'bluetooth' ? 'Phone-call quality. Avoid for recording.' : note}</span>}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 lg:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget && !testing) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Microphone setup" className="flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-line-strong bg-surface-1 shadow-xl lg:max-w-lg lg:rounded-2xl" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Mic className="h-5 w-5 text-accent" aria-hidden />
          <h2 className="flex-1 text-base font-semibold">Microphone</h2>
          <button ref={closeRef} type="button" aria-label="Close" disabled={testing} onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full text-ink-dim hover:bg-surface-3 disabled:opacity-40"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 overflow-y-auto px-4 py-4">
          {fresh && micId !== fresh.id && (
            <div role="status" className="rounded-card border border-accent/40 bg-accent/10 p-3">
              <div className="text-sm font-semibold text-ink">New microphone detected</div>
              <div className="mb-2 text-sm text-ink-dim">{fresh.label}</div>
              <Button size="md" variant="primary" disabled={testing} onClick={() => choose(fresh.id)}>Use this microphone</Button>
            </div>
          )}
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-dim">1 · Choose your microphone</div>
            {!named && (
              <div className="mb-2 rounded-card border border-line bg-surface-2 p-3">
                <p className="mb-2 text-sm text-ink-dim">Allow the microphone to see the names of your devices.</p>
                <Button size="md" variant="secondary" disabled={testing} onClick={() => void onAllow()}>Show my microphones</Button>
              </div>
            )}
            <ul role="radiogroup" aria-label="Microphones" className="space-y-2">
              {card('', 'Default (what this device chooses)', 'builtin', 'Often the built-in microphone, even when a USB mic is plugged in')}
              {mics.map((m) => card(m.id, m.label, kindOf(m)))}
            </ul>
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-dim">2 · Listen to the room</div>
            {testing ? (
              <div role="status" className="rounded-card border border-line-strong bg-surface-2 p-4 text-center">
                <div className="text-lg font-semibold">{phase === 'quiet' ? 'Stay quiet' : 'Now read the first line of the script'}</div>
                <div className="mb-3 text-xs text-ink-dim">{phase === 'quiet' ? 'Listening to the room' : 'In your normal voice, at the distance you will record'}</div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-3" role="meter" aria-label="Input level" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(level.toFixed(2))}><div className={`h-full rounded-full ${level > 0.95 ? 'bg-danger' : level > 0.7 ? 'bg-warn' : 'bg-ok'}`} style={{ width: `${Math.min(100, level * 100)}%`, transition: 'width 60ms linear' }} /></div>
              </div>
            ) : (
              <Button size="lg" variant={report ? 'secondary' : 'primary'} className="h-12 w-full" disabled={disabled} onClick={() => void test()} leftIcon={<Mic className="h-4 w-4" />}>{report ? 'Test again' : 'Test my setup (10 seconds)'}</Button>
            )}
            {error && <div role="alert" className="mt-2 rounded-card border border-danger/40 bg-danger/10 p-2 text-sm text-ink">{error}</div>}
            {report && !testing && (
              <div className="mt-3 rounded-card border border-line bg-surface-2 p-3">
                <Findings report={report} />
                {info && <p className="mt-2 text-[11px] text-ink-faint">Heard through: {info.micLabel || 'microphone'} · {Math.round(info.sampleRate / 100) / 10} kHz · {MODE_TEXT[info.channelMode]}. Nothing from this test is saved or sent.</p>}
              </div>
            )}
          </div>
        </div>
        <div className="border-t border-line px-4 py-3"><Button size="lg" variant={report ? 'primary' : 'secondary'} className="h-12 w-full" disabled={testing} onClick={onClose}>Done</Button></div>
      </div>
    </div>
  );
};
