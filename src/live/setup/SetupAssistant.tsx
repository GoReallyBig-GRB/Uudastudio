/** The setup assistant: a few plain questions, a picture of how to connect things, and a microphone check. It saves what it learns as a studio. */
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Headphones, Laptop, Mic, Podcast, Radio, SlidersHorizontal, Usb, Bluetooth } from 'lucide-react';
import { Button, ModalShell, Switch } from '../../components/ui';
import { liveSettings, type StudioProfile } from '../settings/liveSettings';
import { useLiveSettings } from '../settings/useLiveSettings';
import { GEARS, GOALS, SIGHTS, gearLabel, guessGear, inputWarning, isMixerGear, recommend, suggestInput, type Gear, type Goal, type Sight } from './setupPlan';
import { SetupDiagram } from './SetupDiagram';
import { useMicTest } from './useMicTest';

type Step = 'goal' | 'gear' | 'sight' | 'ask' | 'connect' | 'test' | 'finish' | 'done';
const SELECT = 'h-10 w-full rounded-control border border-line-strong bg-surface-3 px-3 text-sm text-ink hover:border-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60';

const GOAL_ICON: Record<Goal, React.ReactNode> = { podcast: <Podcast className="h-5 w-5" />, radio: <Radio className="h-5 w-5" />, 'on-air': <Radio className="h-5 w-5" /> };
const GEAR_ICON: Record<Gear, React.ReactNode> = {
  'usb-mic': <Mic className="h-5 w-5" />, 'usb-mixer': <SlidersHorizontal className="h-5 w-5" />, interface: <Usb className="h-5 w-5" />, laptop: <Laptop className="h-5 w-5" />,
  bluetooth: <Bluetooth className="h-5 w-5" />, 'analog-desk': <SlidersHorizontal className="h-5 w-5" />, 'digital-desk': <SlidersHorizontal className="h-5 w-5" />,
};

const Choice: React.FC<{ icon: React.ReactNode; title: string; text: string; selected: boolean; onClick: () => void }> = ({ icon, title, text, selected, onClick }) => (
  <button type="button" aria-pressed={selected} onClick={onClick}
    className={`flex w-full items-start gap-3 rounded-card border p-3 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${selected ? 'border-accent bg-accent/10' : 'border-line-strong bg-surface-2 hover:bg-surface-3'}`}>
    <span className="mt-0.5 text-ink-dim">{icon}</span>
    <span><span className="block text-sm font-medium text-ink">{title}</span><span className="block text-xs text-ink-dim">{text}</span></span>
  </button>
);

const Notice: React.FC<{ tone: 'warn' | 'ok'; children: React.ReactNode }> = ({ tone, children }) => (
  <p role={tone === 'warn' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-control border px-3 py-2 text-xs text-ink ${tone === 'warn' ? 'border-gold/40 bg-gold/10' : 'border-ok/40 bg-ok/10'}`}>
    {tone === 'warn' ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" /> : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />}<span>{children}</span>
  </p>
);

export const SetupAssistant: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const prefs = useLiveSettings();
  const [step, setStep] = useState<Step>('goal');
  const [goal, setGoal] = useState<Goal | null>(null);
  const [gear, setGear] = useState<Gear | null>(null);
  const [seen, setSeen] = useState<Sight[]>([]);
  const [guess, setGuess] = useState<{ gear: Gear; sure: boolean } | null>(null);
  const [onAir, setOnAir] = useState<boolean | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [headphones, setHeadphones] = useState(prefs.headphones);
  const [name, setName] = useState('');
  const mic = useMicTest();

  useEffect(() => { if (open) { setStep('goal'); setGoal(null); setGear(null); setSeen([]); setGuess(null); setOnAir(null); setDeviceId(''); setHeadphones(liveSettings.get().headphones); setName(''); } else mic.stop(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const needsAsk = gear !== null && goal !== 'podcast' && isMixerGear(gear);
  const plan = useMemo(() => (goal && gear ? recommend({ goal, gear, hostOnAirViaMixer: onAir === true }) : null), [goal, gear, onAir]);
  const order: Step[] = ['goal', 'gear', ...(needsAsk ? ['ask' as Step] : []), 'connect', 'test', 'finish'];
  const at = order.indexOf(step);

  // When the microphone opens, suggest the input that matches the equipment
  const devices = mic.state.devices;
  useEffect(() => {
    if (step !== 'test' || !gear || deviceId || devices.length === 0) return;
    const s = suggestInput(devices.map((d) => ({ deviceId: d.deviceId, label: d.label })), gear);
    if (s) setDeviceId(s.deviceId);
  }, [step, gear, deviceId, devices]);

  const goNext = () => {
    if (step === 'goal') setStep('gear');
    else if (step === 'gear' || step === 'sight') setStep(needsAsk ? 'ask' : 'connect');
    else if (step === 'ask') setStep('connect');
    else if (step === 'connect') setStep('test');
    else if (step === 'test') { mic.stop(); setStep('finish'); }
  };
  const goBack = () => {
    if (step === 'gear') setStep('goal');
    else if (step === 'sight') setStep('gear');
    else if (step === 'ask') setStep('gear');
    else if (step === 'connect') setStep(needsAsk ? 'ask' : 'gear');
    else if (step === 'test') { mic.stop(); setStep('connect'); }
    else if (step === 'finish') setStep('test');
  };

  const chosen = devices.find((d) => d.deviceId === deviceId);
  const warning = gear && chosen ? inputWarning(chosen.label, gear) : null;
  const tested = mic.state.result !== null;
  const canNext = step === 'goal' ? goal !== null : step === 'gear' ? gear !== null : step === 'ask' ? onAir !== null : true;

  const save = () => {
    if (!plan || !goal || !gear) return;
    const p: StudioProfile = { id: `s${Date.now().toString(36)}`, name: name.trim() || plan.title, goal, gear, defaultMode: plan.mode, inputDeviceId: deviceId, headphones, programContains: plan.programContains };
    liveSettings.saveProfile(p);
    liveSettings.useProfile(p.id);
    setStep('done');
  };

  const footer = step === 'done'
    ? <Button variant="primary" onClick={onClose}>Close</Button>
    : (<div className="flex w-full items-center justify-between gap-2">
        <div>{step !== 'goal' && <Button variant="secondary" leftIcon={<ChevronLeft className="h-4 w-4" />} onClick={goBack}>Back</Button>}</div>
        <div className="flex items-center gap-2">
          {step === 'test' && !tested && <Button variant="secondary" onClick={goNext}>Skip the test</Button>}
          {step === 'finish'
            ? <Button variant="primary" onClick={save}>Save and use this studio</Button>
            : step === 'sight' ? <Button variant="primary" onClick={() => { if (guess) { setGear(guess.gear); } goNext(); }} disabled={!guess}>Use this</Button>
            : <Button variant="primary" rightIcon={<ChevronRight className="h-4 w-4" />} onClick={goNext} disabled={!canNext}>Next</Button>}
        </div>
      </div>);

  return (
    <ModalShell open={open} onClose={onClose} above size="md" title="Set up your studio"
      description={step === 'done' ? undefined : step === 'sight' ? 'Let us work out what you have.' : `Step ${Math.max(1, at + 1)} of ${order.length}`} footer={footer}>
      <div className="flex flex-col gap-3">
        {step === 'goal' && (<>
          <p className="text-sm text-ink">What are you going to do?</p>
          {GOALS.map((g) => <Choice key={g.id} icon={GOAL_ICON[g.id]} title={g.label} text={g.text} selected={goal === g.id} onClick={() => setGoal(g.id)} />)}
        </>)}

        {step === 'gear' && (<>
          <p className="text-sm text-ink">What will you use as your microphone?</p>
          {GEARS.map((g) => <Choice key={g.id} icon={GEAR_ICON[g.id]} title={g.label} text={g.text} selected={gear === g.id} onClick={() => setGear(g.id)} />)}
          <button type="button" onClick={() => { setSeen([]); setGuess(null); setStep('sight'); }} className="self-start text-xs text-accent underline-offset-2 hover:underline cursor-pointer">I am not sure what I have</button>
        </>)}

        {step === 'sight' && (<>
          <p className="text-sm text-ink">Tick everything you can see:</p>
          {SIGHTS.map((s) => (
            <label key={s.id} className="flex items-center gap-2 rounded-control border border-line bg-surface-2 px-3 py-2 text-sm text-ink">
              <input type="checkbox" checked={seen.includes(s.id)} onChange={(e) => { const next = e.target.checked ? [...seen, s.id] : seen.filter((x) => x !== s.id); setSeen(next); setGuess(guessGear(next)); }} />{s.text}
            </label>))}
          {guess && <Notice tone={guess.sure ? 'ok' : 'warn'}>{guess.sure ? `This looks like: ${gearLabel(guess.gear)}.` : `We will start with the simplest setup (${gearLabel(guess.gear)}). You can change it any time.`}</Notice>}
        </>)}

        {step === 'ask' && (<>
          <p className="text-sm text-ink">Does your own voice already go on air through the mixer?</p>
          <Choice icon={<Mic className="h-5 w-5" />} title="Yes" text="My microphone is plugged into the mixer and its slider puts me on air." selected={onAir === true} onClick={() => setOnAir(true)} />
          <Choice icon={<Laptop className="h-5 w-5" />} title="No" text="I only talk through the computer." selected={onAir === false} onClick={() => setOnAir(false)} />
          <Choice icon={<AlertTriangle className="h-5 w-5" />} title="I am not sure" text="We will send you and the guests together. If you sound doubled on air, change Program contains to Guests only in Live settings." selected={false} onClick={() => setOnAir(false)} />
        </>)}

        {step === 'connect' && plan && (<>
          <h3 className="text-sm font-semibold text-ink">{plan.title}</h3>
          <SetupDiagram kind={plan.diagram} micLabel={gear === 'usb-mic' ? 'USB microphone' : gear === 'interface' ? 'Microphone' : gear === 'bluetooth' ? 'Headset' : 'Microphone'} />
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink">{plan.connect.map((c) => <li key={c}>{c}</li>)}</ol>
          {plan.needs.length > 0 && <Notice tone="warn">You may need: {plan.needs.join('; ')}.</Notice>}
          {plan.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
          <div className="rounded-control border border-line bg-surface-2 p-3"><p className="mb-1 text-xs font-medium text-ink">What Uuda will set up for you</p><ul className="list-disc pl-4 text-xs text-ink-dim">{plan.settings.map((s) => <li key={s}>{s}</li>)}</ul></div>
        </>)}

        {step === 'test' && (<>
          <p className="text-sm text-ink">Let us check your microphone. Nothing is played back, so there is no echo.</p>
          {!mic.state.listening && (<div><Button variant="primary" leftIcon={<Mic className="h-4 w-4" />} onClick={() => { void mic.start(deviceId); }}>Allow the microphone</Button></div>)}
          {mic.state.error && <Notice tone="warn">{mic.state.error}</Notice>}
          {mic.state.listening && (<>
            <label className="flex flex-col gap-1.5 text-xs text-ink-dim">Microphone or mixer input
              <select className={SELECT} value={deviceId} onChange={(e) => { setDeviceId(e.target.value); void mic.start(e.target.value); }}>
                <option value="">Default</option>
                {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Input ${i + 1}`}</option>)}
              </select>
            </label>
            {warning && <Notice tone="warn">{warning}</Notice>}
            <div className="h-3 overflow-hidden rounded-full bg-surface-0" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(mic.state.level * 100)}>
              <div className="h-full bg-ok transition-[width] duration-75" style={{ width: `${Math.round(mic.state.level * 100)}%` }} />
            </div>
            <p className="text-xs text-ink-dim">{mic.state.level < 0.05 ? 'Say something: the bar should move.' : 'The bar is moving, so the microphone works.'}</p>
            <Switch checked={headphones} onChange={setHeadphones} label="I am wearing headphones" />
            <div className="flex items-center gap-3">
              <Button variant="secondary" disabled={mic.state.recording} onClick={mic.record}>{mic.state.recording ? 'Listening…' : tested ? 'Test again' : 'Start the 5-second test'}</Button>
              {mic.state.recording && <span className="text-xs text-ink-dim">Count from one to five at your normal voice.</span>}
            </div>
            {mic.state.recording && <div className="h-1.5 overflow-hidden rounded-full bg-surface-0"><div className="h-full bg-accent" style={{ width: `${Math.round(mic.state.progress * 100)}%` }} /></div>}
            {mic.state.result && mic.state.result.messages.map((m, i) => <Notice key={m} tone={i === 0 && mic.state.result?.verdict === 'good' ? 'ok' : 'warn'}>{m}</Notice>)}
          </>)}
        </>)}

        {step === 'finish' && plan && (<>
          <p className="text-sm text-ink">Ready to save this studio.</p>
          <label className="flex flex-col gap-1.5 text-xs text-ink-dim">Name
            <input className={SELECT} value={name} maxLength={40} placeholder={plan.title} onChange={(e) => setName(e.target.value)} />
          </label>
          <ul className="list-disc pl-5 text-xs text-ink-dim">
            <li>Equipment: {gear ? gearLabel(gear) : ''}</li>
            <li>New events start as {plan.mode === 'broadcast' ? 'Broadcast' : 'Conversation'}</li>
            <li>Input: {chosen ? (chosen.label || 'selected input') : 'the computer\'s default'}</li>
            <li>Headphones: {headphones ? 'yes' : 'no'}</li>
            {plan.mode === 'broadcast' && <li>Program out sends {plan.programContains === 'guests' ? 'the guests only' : 'you and the guests'}</li>}
          </ul>
          {!tested && <Notice tone="warn">You skipped the microphone test. You can run this assistant again from Live settings.</Notice>}
        </>)}

        {step === 'done' && (<>
          <Notice tone="ok">Your studio is saved and in use. New events will use it.</Notice>
          <p className="text-xs text-ink-dim">You can change anything in Live settings, or run this assistant again whenever you change your equipment.</p>
          <p className="flex items-center gap-2 text-xs text-ink-dim"><Headphones className="h-3.5 w-3.5" />Next: create an event, share the link, and open the room.</p>
        </>)}
      </div>
    </ModalShell>
  );
};
