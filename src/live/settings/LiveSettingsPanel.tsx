/** Live settings: only what belongs to live events. Opens from the gear in the Live events window; the main Settings are untouched. */
import React, { useEffect, useState } from 'react';
import { Button, ModalShell, SegmentedControl, Slider, Switch } from '../../components/ui';
import type { LiveMode } from '../events';
import type { LiveQuota } from '../api';
import { liveSettings, type CallQuality } from './liveSettings';
import { useLiveSettings } from './useLiveSettings';
import { sheetLink } from '../setup/sheetLink';
import { DiagnosticsPanel } from '../guide/DiagnosticsPanel';

const SELECT = 'h-10 w-full rounded-control border border-line-strong bg-surface-3 px-3 text-sm text-ink hover:border-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60';

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <section className="flex flex-col gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
    <div><h3 className="text-sm font-semibold text-ink">{title}</h3>{hint && <p className="mt-0.5 text-xs text-ink-dim">{hint}</p>}</div>
    {children}
  </section>
);

export const LiveSettingsPanel: React.FC<{ open: boolean; onClose: () => void; quota: LiveQuota | null; onRunSetup: () => void }> = ({ open, onClose, quota, onRunSetup }) => {
  const s = useLiveSettings();
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!open) { setConfirmReset(false); return; }
    void navigator.mediaDevices?.enumerateDevices().then((d) => { setInputs(d.filter((x) => x.kind === 'audioinput')); setOutputs(d.filter((x) => x.kind === 'audiooutput')); }).catch(() => undefined);
  }, [open]);

  const inputValue = inputs.some((d) => d.deviceId === s.inputDeviceId) ? s.inputDeviceId : '';
  const lastOut = outputs.find((d) => d.deviceId === s.programDeviceId);

  return (
    <ModalShell open={open} onClose={onClose} above size="md" title="Live settings" description="These only affect live events, and are kept on this computer."
      footer={<Button variant="secondary" onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-5">
        <Section title="Your studio" hint="The setup assistant asks what equipment you have, shows how to connect it and checks your microphone.">
          <div><Button variant="secondary" onClick={onRunSetup}>{s.profiles.length ? 'Run the setup assistant again' : 'Run the setup assistant'}</Button></div>
          {s.profiles.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {s.profiles.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 rounded-control border border-line bg-surface-2 px-3 py-2">
                  <span className="min-w-0 truncate text-sm text-ink">{p.name}{p.id === s.activeProfileId ? <span className="ml-2 text-xs text-ok">in use</span> : null}</span>
                  <span className="flex shrink-0 gap-1.5">
                    <Button variant="secondary" size="sm" aria-label={`Engineer sheet for ${p.name}`} onClick={() => window.open(sheetLink(window.location.origin, { goal: p.goal, gear: p.gear, hostOnAirViaMixer: p.programContains === 'guests' }, p.name), '_blank', 'noopener')}>Sheet</Button>
                    {p.id !== s.activeProfileId && <Button variant="secondary" size="sm" onClick={() => { liveSettings.useProfile(p.id); }}>Use</Button>}
                    <Button variant="secondary" size="sm" onClick={() => liveSettings.deleteProfile(p.id)} aria-label={`Delete ${p.name}`}>Delete</Button>
                  </span>
                </li>))}
            </ul>)}
        </Section>

        <Section title="New events" hint="What a new event starts as. You can still change it for each event.">
          <SegmentedControl<LiveMode> label="Start new events as" value={s.defaultMode} onChange={(v) => liveSettings.set({ defaultMode: v })}
            options={[{ value: 'conversation', label: 'Conversation' }, { value: 'broadcast', label: 'Broadcast' }]} />
        </Section>

        <Section title="Your microphone" hint="The microphone or mixer input used for the call. If it is not plugged in, the computer's default is used.">
          <select aria-label="Microphone or mixer input" className={SELECT} value={inputValue} onChange={(e) => liveSettings.set({ inputDeviceId: e.target.value })}>
            <option value="">Default</option>
            {inputs.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Input ${i + 1}`}</option>)}
          </select>
          <Switch checked={s.headphones} onChange={(v) => liveSettings.set({ headphones: v })} label="I usually wear headphones" />
        </Section>

        <Section title="Program out (Broadcast)" hint="Where the finished mix goes. Choose the device itself during a broadcast; it never starts on its own.">
          <SegmentedControl<'all' | 'guests'> label="Program contains" value={s.programContains} onChange={(v) => liveSettings.set({ programContains: v })}
            options={[{ value: 'all', label: 'Me and the guests' }, { value: 'guests', label: 'Guests only' }]} />
          <p className="text-xs text-ink-dim">Choose "Guests only" when your microphone is wired to a hardware mixer that already puts you on air.</p>
          <p className="text-xs text-ink-faint">Last used device: {lastOut ? (lastOut.label || 'Unnamed output') : 'none yet'}</p>
        </Section>

        <Section title="Guest channels (Broadcast)" hint="Where each new guest's channel starts. You can change a guest during the broadcast.">
          <Switch checked={s.guestStrip.lowCut} onChange={(v) => liveSettings.set({ guestStrip: { lowCut: v } })} label="Low cut" />
          <Switch checked={s.guestStrip.compressor} onChange={(v) => liveSettings.set({ guestStrip: { compressor: v } })} label="Compressor" />
          <Slider label="Presence" value={s.guestStrip.presence} min={-6} max={6} step={0.5} unit="dB" onChange={(v) => liveSettings.set({ guestStrip: { presence: v } })} />
        </Section>

        <Section title="Call quality" hint="High sounds cleaner and uses more data. It applies the next time you join the call.">
          <SegmentedControl<CallQuality> label="Call quality" value={s.quality} onChange={(v) => liveSettings.set({ quality: v })}
            options={[{ value: 'standard', label: 'Standard' }, { value: 'high', label: 'High' }]} />
        </Section>

        <Section title="Your plan" hint="Fixed for now, shown so you know what to expect.">
          {quota ? (
            <ul className="text-xs text-ink-dim">
              <li>Up to {quota.maxPeople} people in a room, including you</li>
              <li>{Math.round(quota.sessionMinutes / 60)} hours per live session</li>
              <li>{quota.left} of {quota.limit} live sessions left this week</li>
            </ul>
          ) : <p className="text-xs text-ink-faint">Sign in to see your plan limits.</p>}
        </Section>

        <Section title="Diagnostics" hint="Check this computer and send a report if something is wrong.">
          <DiagnosticsPanel />
        </Section>

        <Section title="Reset">
          {!confirmReset
            ? <div><Button variant="secondary" onClick={() => setConfirmReset(true)} className="border-danger/40 text-danger">Reset live settings</Button></div>
            : <div className="flex flex-wrap items-center gap-2"><p className="text-xs text-ink">Put every live setting back to its starting value?</p>
                <Button variant="secondary" onClick={() => { liveSettings.reset(); setConfirmReset(false); }} className="border-danger/40 text-danger">Yes, reset</Button>
                <Button variant="secondary" onClick={() => setConfirmReset(false)}>Cancel</Button></div>}
        </Section>
      </div>
    </ModalShell>
  );
};
