/** Three checks for a broadcast: this computer, the internet connection, and the echo-loop route test. Each runs only when asked. */
import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '../../components/ui';
import { DESK_MESSAGES, deskVerdict, measureDesk } from '../room/deskCheck';
import { measureNetwork, networkVerdict, type NetworkVerdict } from './networkCheck';
import { routeAdvice } from './routeTest';
import { useRouteTest } from './useRouteTest';
import type { Gear } from './setupPlan';

const Line: React.FC<{ tone: 'ok' | 'warn'; children: React.ReactNode }> = ({ tone, children }) => (
  <p role={tone === 'warn' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-control border px-3 py-2 text-xs text-ink ${tone === 'warn' ? 'border-gold/40 bg-gold/10' : 'border-ok/40 bg-ok/10'}`}>
    {tone === 'warn' ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" /> : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />}<span>{children}</span>
  </p>
);
const Card: React.FC<{ title: string; text: string; children: React.ReactNode }> = ({ title, text, children }) => (
  <section className="flex flex-col gap-2 rounded-card border border-line bg-surface-2 p-3">
    <div><h3 className="text-sm font-semibold text-ink">{title}</h3><p className="text-xs text-ink-dim">{text}</p></div>{children}
  </section>
);

export const ComputerCheck: React.FC = () => {
  const [state, setState] = useState<'idle' | 'running' | 'fine' | 'tight' | 'too-slow'>('idle');
  const run = async () => { setState('running'); setState(deskVerdict(await measureDesk())); };
  return (
    <Card title="This computer" text="Checks the computer can mix several guests at once. Takes a few seconds.">
      <div><Button variant="secondary" disabled={state === 'running'} onClick={() => { void run(); }}>{state === 'running' ? 'Checking…' : state === 'idle' ? 'Check this computer' : 'Check again'}</Button></div>
      {state === 'fine' && <Line tone="ok">This computer is fast enough for a broadcast.</Line>}
      {(state === 'tight' || state === 'too-slow') && <Line tone="warn">{DESK_MESSAGES[state]}</Line>}
    </Card>
  );
};

export const NetworkCheck: React.FC = () => {
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState<NetworkVerdict | null>(null);
  const run = async () => { setBusy(true); setV(networkVerdict(await measureNetwork())); setBusy(false); };
  return (
    <Card title="Internet connection" text="Sends a few tiny messages and one small upload to our server. Uses well under 1 MB.">
      <div><Button variant="secondary" disabled={busy} onClick={() => { void run(); }}>{busy ? 'Checking…' : v ? 'Check again' : 'Check my connection'}</Button></div>
      {v && (<>
        <Line tone={v.level === 'good' ? 'ok' : 'warn'}>{v.messages[0]}</Line>
        {v.medianMs > 0 && <p className="text-xs text-ink-dim">Delay to the server: {v.medianMs} ms, variation {v.jitterMs} ms.</p>}
        {v.messages.slice(1).map((m) => <p key={m} className="text-xs text-ink-dim">{m}</p>)}
      </>)}
    </Card>
  );
};

export const RouteTest: React.FC<{ gear: Gear; deviceId: string }> = ({ gear, deviceId }) => {
  const t = useRouteTest();
  const advice = t.state.phase === 'done' ? routeAdvice(t.state.found, gear) : null;
  return (
    <Card title="Echo loop test" text="Plays one short rising sound out of your computer and listens on your chosen input. Turn the volume to a normal level first.">
      <div><Button variant="secondary" disabled={t.state.phase === 'running'} onClick={() => { void t.run(deviceId); }}>{t.state.phase === 'running' ? 'Listening…' : t.state.phase === 'done' ? 'Test again' : 'Play the test sound'}</Button></div>
      {t.state.error && <Line tone="warn">{t.state.error}</Line>}
      {advice && <Line tone={advice.tone}>{advice.text}</Line>}
      {advice?.tone === 'ok' && <p className="text-xs text-ink-dim">If you also did not hear it from your speakers or headphones, check the output is the one Uuda uses.</p>}
    </Card>
  );
};
