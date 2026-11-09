import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Mic } from 'lucide-react';
import { Button } from '../components/ui';
import { MicCapture } from './capture';
import { MODE_TEXT, type ChannelMode } from './channels';
import { listMics, type MicInfo } from './devices';
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

interface Props {
  micId: string;
  onMicId: (id: string) => void;
  disabled: boolean;
  /** Called with what the microphone turned out to be, after a test */
  onInfo: (i: SetupInfo) => void;
}

/** Choose the microphone and listen to the room for ten seconds before recording. Nothing from the test is kept or sent. */
export const SetupPanel: React.FC<Props> = ({ micId, onMicId, disabled, onInfo }) => {
  const [mics, setMics] = useState<MicInfo[]>([]);
  const [phase, setPhase] = useState<'idle' | 'quiet' | 'read'>('idle');
  const [report, setReport] = useState<RoomReport | null>(null);
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [error, setError] = useState('');
  const capRef = useRef<MicCapture | null>(null);

  useEffect(() => {
    void listMics().then(setMics);
    const md = navigator.mediaDevices;
    const refresh = () => void listMics().then(setMics);
    md?.addEventListener?.('devicechange', refresh);
    return () => { md?.removeEventListener?.('devicechange', refresh); void capRef.current?.stop(); };
  }, []);

  const chosen = mics.find((m) => m.id === micId);

  const test = async () => {
    setError(''); setReport(null); setInfo(null);
    const c = new MicCapture();
    const chunks: Int16Array[] = [];
    let samples = 0;
    let finished = false;
    const done = async () => {
      if (finished) return;
      finished = true;
      capRef.current = null;
      const sr = c.sampleRate, label = c.label, mode = c.channelMode;
      await c.stop();
      setPhase('idle');
      const r = checkRoom(int16ToFloat(chunks), sr);
      setReport(r);
      const i = { micLabel: label, sampleRate: sr, channelMode: mode };
      setInfo(i); onInfo(i);
      void listMics().then(setMics);
    };
    try {
      await c.start({
        onBlock: (pcm) => {
          chunks.push(pcm); samples += pcm.length;
          const s = samples / c.sampleRate;
          setPhase(s < QUIET_SECONDS ? 'quiet' : 'read');
          if (s >= TEST_SECONDS) void done();
        },
        onLevel: () => undefined,
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

  const testing = phase !== 'idle';
  return (
    <div className="rounded-card border border-line bg-surface-2 p-3" aria-label="Microphone setup">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Mic className="h-4 w-4 text-accent" aria-hidden />Your microphone</div>
      <label className="block text-xs text-ink-dim" htmlFor="guest-mic">Microphone</label>
      <select id="guest-mic" value={micId} disabled={disabled || testing} onChange={(e) => { onMicId(e.target.value); setReport(null); setInfo(null); }} className="mb-2 mt-1 h-11 w-full rounded-card border border-line-strong bg-surface-1 px-2 text-sm text-ink focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        <option value="">Default microphone</option>
        {mics.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      {chosen?.bluetooth && <p role="alert" className="mb-2 rounded-card border border-warn/40 bg-warn/10 p-2 text-xs text-ink">Bluetooth headsets record at phone-call quality. For a clean voice, use the phone's own microphone, a wired headset or a USB microphone.</p>}
      {testing ? (
        <div role="status" className="rounded-card border border-line-strong bg-surface-1 p-3 text-center">
          <div className="text-lg font-semibold">{phase === 'quiet' ? 'Stay quiet' : 'Now read the first line of the script'}</div>
          <div className="text-xs text-ink-dim">{phase === 'quiet' ? 'Listening to the room' : 'In your normal voice, at the distance you will record'}</div>
        </div>
      ) : (
        <Button size="md" variant="secondary" disabled={disabled} onClick={() => void test()} leftIcon={<Mic className="h-4 w-4" />}>{report ? 'Test again' : 'Test my setup (10 seconds)'}</Button>
      )}
      {error && <div role="alert" className="mt-2 rounded-card border border-danger/40 bg-danger/10 p-2 text-sm text-ink">{error}</div>}
      {report && !testing && (
        <div className="mt-3">
          <Findings report={report} />
          {info && <p className="mt-2 text-[11px] text-ink-faint">{info.micLabel || 'Microphone'} · {Math.round(info.sampleRate / 100) / 10} kHz · {MODE_TEXT[info.channelMode]}. Nothing from this test is saved or sent.</p>}
        </div>
      )}
    </div>
  );
};
