/** "Run checks" and "Copy problem report": the same tests as the setup assistant, run one after another, and a plain-text summary to send for help. */
import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '../../components/ui';
import { DESK_MESSAGES, deskVerdict, measureDesk } from '../room/deskCheck';
import { liveSettings } from '../settings/liveSettings';
import { useLiveSettings } from '../settings/useLiveSettings';
import { measureNetwork, networkVerdict } from '../setup/networkCheck';
import { gearLabel } from '../setup/setupPlan';
import { detectChirp, makeChirp, routeAdvice } from '../setup/routeTest';
import { micConstraints } from '../room/callPlan';
import { recentErrors } from './errorLog';
import { buildReport, type ReportInput } from './problemReport';

type Checks = ReportInput['checks'];
interface Row { label: string; ok: boolean; text: string }

async function microphoneAndRoute(deviceId: string, gear: Parameters<typeof routeAdvice>[1]): Promise<{ mic: Row; route: Row; inputs: string[]; outputs: string[] }> {
  let stream: MediaStream | null = null;
  let ac: AudioContext | null = null;
  const names = async (kind: MediaDeviceKind) => { try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === kind).map((d) => d.label || 'Unnamed'); } catch { return []; } };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints('broadcast', true, deviceId || undefined) });
  } catch {
    return { mic: { label: 'Microphone', ok: false, text: 'The microphone is blocked or missing. Allow it in the browser and plug it in.' }, route: { label: 'Echo loop test', ok: false, text: 'Skipped, because the microphone could not be opened.' }, inputs: await names('audioinput'), outputs: await names('audiooutput') };
  }
  const inputs = await names('audioinput'); const outputs = await names('audiooutput');
  try {
    ac = new AudioContext(); await ac.resume();
    const chunks: Float32Array[] = [];
    const sp = ac.createScriptProcessor(4096, 1, 1); const mute = ac.createGain(); mute.gain.value = 0;
    sp.onaudioprocess = (e) => { chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    ac.createMediaStreamSource(stream).connect(sp); sp.connect(mute); mute.connect(ac.destination);
    const tpl = makeChirp(ac.sampleRate);
    await new Promise((r) => setTimeout(r, 500));
    const buf = ac.createBuffer(1, tpl.length, ac.sampleRate); buf.copyToChannel(tpl, 0);
    const src = ac.createBufferSource(); src.buffer = buf; src.connect(ac.destination); src.start();
    await new Promise((r) => setTimeout(r, 2500));
    const rec = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0; for (const c of chunks) { rec.set(c, o); o += c.length; }
    const hit = detectChirp(rec, tpl, ac.sampleRate);
    const adv = routeAdvice(hit.found, gear);
    return { mic: { label: 'Microphone', ok: true, text: 'The microphone opened.' }, route: { label: 'Echo loop test', ok: adv.tone === 'ok', text: adv.text }, inputs, outputs };
  } catch {
    return { mic: { label: 'Microphone', ok: true, text: 'The microphone opened.' }, route: { label: 'Echo loop test', ok: false, text: 'The test could not run.' }, inputs, outputs };
  } finally {
    stream.getTracks().forEach((t) => t.stop()); void ac?.close().catch(() => undefined);
  }
}

export const DiagnosticsPanel: React.FC = () => {
  const s = useLiveSettings();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState('');
  const [copied, setCopied] = useState(false);

  const run = async () => {
    setBusy(true); setRows([]); setReport(''); setCopied(false);
    const checks: Checks = {};
    const out: Row[] = [];
    const push = (r: Row) => { out.push(r); setRows([...out]); };
    const dv = deskVerdict(await measureDesk());
    checks.computer = dv; push({ label: 'This computer', ok: dv === 'fine', text: dv === 'fine' ? 'Fast enough for a broadcast.' : DESK_MESSAGES[dv] ?? '' });
    const nv = networkVerdict(await measureNetwork());
    checks.network = `${nv.level}, delay ${nv.medianMs} ms, variation ${nv.jitterMs} ms, suits ${nv.guests} guest${nv.guests === 1 ? '' : 's'}`;
    push({ label: 'Internet connection', ok: nv.level === 'good', text: nv.messages[0] });
    const profile = s.profiles.find((p) => p.id === s.activeProfileId) ?? null;
    const m = await microphoneAndRoute(s.inputDeviceId, profile?.gear ?? 'laptop');
    checks.microphone = m.mic.ok ? 'opened' : 'blocked or missing'; push(m.mic);
    checks.route = m.route.ok ? 'no loop found' : m.route.text.slice(0, 80); push(m.route);
    setReport(buildReport({
      when: new Date(), browser: navigator.userAgent.replace(/\s*\([^)]*\)/g, '').slice(0, 120), platform: (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? 'unknown',
      inputs: m.inputs, outputs: m.outputs, checks, errors: recentErrors(),
      studio: profile ? { gear: gearLabel(profile.gear), mode: profile.defaultMode, programContains: profile.programContains, headphones: profile.headphones, quality: liveSettings.get().quality } : null,
    }));
    setBusy(false);
  };
  const copy = () => { void navigator.clipboard?.writeText(report).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => undefined); };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-ink-dim">Runs the computer, connection, microphone and echo loop checks one after another (about 20 seconds). It plays one short sound, so set the volume to normal first.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => { void run(); }}>{busy ? 'Running checks…' : rows.length ? 'Run checks again' : 'Run checks'}</Button>
        <Button variant="secondary" disabled={!report} onClick={copy}>{copied ? 'Copied' : 'Copy problem report'}</Button>
      </div>
      {rows.map((r) => (
        <p key={r.label} className={`flex items-start gap-2 rounded-control border px-3 py-2 text-xs text-ink ${r.ok ? 'border-ok/40 bg-ok/10' : 'border-gold/40 bg-gold/10'}`}>
          {r.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />}<span><b>{r.label}:</b> {r.text}</span>
        </p>))}
      {report && <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-control border border-line bg-surface-2 p-3 text-[11px] text-ink-dim">{report}</pre>}
      {report && <p className="text-xs text-ink-faint">The report holds no audio, names, event titles or links. Paste it into a message to whoever is helping you.</p>}
    </div>
  );
};
