import React, { useEffect, useState } from 'react';
import { Bluetooth, Disc3, Headphones, Laptop, Mic, Sliders, SlidersVertical, Usb, Volume2 } from 'lucide-react';
import { Button, ModalShell } from './ui';
import { audioEngine } from '../audio/engine';
import { canChooseOutput, applyOutput, loadOutputId, saveOutputId } from '../audio/outputDevice';
import { CHOICES, kindFor, rememberKind } from '../audio/deviceKindOverride';
import { KIND_TEXT, withoutDefaultTwin, type AudioDevice, type DeviceKind, type SystemDefaults } from '../audio/deviceWatch';
import { loadRecordingDeviceSettings, saveRecordingDeviceSettings } from '../storage/presets';

const ICON: Record<DeviceKind, React.ComponentType<{ className?: string }>> = { usb: Usb, interface: Sliders, mixer: SlidersVertical, deck: Disc3, bluetooth: Bluetooth, headphones: Headphones, builtin: Laptop };

interface Props {
  open: boolean;
  onClose: () => void;
  devices: AudioDevice[];
  defaults?: SystemDefaults;
  /** A device plugged in after the app opened */
  fresh: AudioDevice | null;
  /** Whether device names are known (they need the microphone to be allowed once) */
  named: boolean;
  requestAccess: () => Promise<void>;
  /** Show the pickers on their own, with no window around them (used inside Settings) */
  inline?: boolean;
}

/** Shown when the app loads and whenever gear is plugged in: pick the microphone to record with and where to listen. */
export const AudioDevicesSheet: React.FC<Props> = ({ open, onClose, devices, defaults = {}, fresh, named, requestAccess, inline = false }) => {
  const [micId, setMicId] = useState('');
  const [outId, setOutId] = useState('');
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);
  const [, bump] = useState(0);
  const sinkOk = canChooseOutput(audioEngine.getContext());

  useEffect(() => { if (open || inline) { setMicId(loadRecordingDeviceSettings().deviceId); setOutId(loadOutputId()); setError(''); } }, [open, inline]);

  const chooseMic = (id: string) => { setMicId(id); saveRecordingDeviceSettings({ ...loadRecordingDeviceSettings(), deviceId: id }); };
  const chooseOut = async (id: string) => {
    setError('');
    const ctx = await audioEngine.init();
    if (await applyOutput(ctx, id)) { setOutId(id); saveOutputId(id); } else setError('That output could not be used. Check it is connected and try again.');
  };
  const useFresh = () => { if (!fresh) return; if (fresh.direction === 'input') chooseMic(fresh.id); else void chooseOut(fresh.id); };

  const shown = withoutDefaultTwin(devices, defaults);
  const inputs = shown.filter((d) => d.direction === 'input');
  const outputs = shown.filter((d) => d.direction === 'output');
  const freshDone = !!fresh && (fresh.direction === 'input' ? micId === fresh.id : outId === fresh.id);

  const card = (id: string, label: string, detected: DeviceKind, selected: boolean, onPick: () => void, note?: string, canTag = false) => {
    const kind = canTag ? kindFor(label, detected) : detected;
    const Icon = ICON[kind];
    return (
      <li key={id || 'default'} className="flex items-stretch gap-2">
        <button type="button" role="radio" aria-checked={selected} onClick={onPick}
          className={`flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-card border px-3 py-2 text-left transition-colors ${selected ? 'border-accent bg-accent-soft' : 'border-line bg-surface-2 hover:bg-surface-3'}`}>
          <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${selected ? 'border-accent' : 'border-line-strong'}`} aria-hidden>{selected && <span className="h-2 w-2 rounded-full bg-accent" />}</span>
          <Icon className="h-4 w-4 shrink-0 text-ink-dim" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">{label}</span>
            <span className={`block text-[11px] ${kind === 'bluetooth' ? 'text-warn' : 'text-ink-dim'}`}>{kind === 'bluetooth' ? 'Bluetooth records at phone-call quality. Avoid it for recording.' : note ?? KIND_TEXT[kind]}</span>
          </span>
        </button>
        {canTag && (
          <select aria-label={`What is ${label}?`} title="Tell Uuda what this device is" value={CHOICES.some((c) => c.kind === kind) ? kind : ''}
            onChange={(e) => { rememberKind(label, (e.target.value || null) as DeviceKind | null); bump((n) => n + 1); }}
            className="w-[116px] shrink-0 rounded-control border border-line bg-surface-2 px-2 text-xs text-ink-dim hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
            <option value="">{KIND_TEXT[detected]} (auto)</option>
            {CHOICES.map((c) => <option key={c.kind} value={c.kind}>{c.label}</option>)}
          </select>
        )}
      </li>
    );
  };

  const body = (
      <div className="space-y-5">
        {fresh && (
          <div role="status" className="rounded-card border border-accent/40 bg-accent-soft p-3">
            <div className="text-sm font-semibold text-ink">New {fresh.direction === 'input' ? 'microphone' : 'output'} detected</div>
            <div className="mb-2 text-sm text-ink-dim">{fresh.label} · {KIND_TEXT[kindFor(fresh.label, fresh.kind)]}</div>
            {freshDone ? <div className="text-sm font-medium text-ok">In use</div>
              : fresh.direction === 'output' && !sinkOk ? <div className="text-xs text-ink-dim">This browser plays through your system's output. Choose it in your system sound settings.</div>
              : <Button size="sm" variant="primary" onClick={useFresh} leftIcon={fresh.direction === 'input' ? <Mic className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}>{fresh.direction === 'input' ? 'Use as my microphone' : 'Play through it'}</Button>}
          </div>
        )}
        {!named && (
          <div className="rounded-card border border-line bg-surface-2 p-3">
            <p className="mb-2 text-sm text-ink-dim">Allow the microphone once so the browser can show the names of your devices.</p>
            <Button size="md" variant="secondary" disabled={asking} onClick={() => { setAsking(true); void requestAccess().finally(() => setAsking(false)); }}>Show my devices</Button>
          </div>
        )}
        <section aria-label="Microphones">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-dim">Microphone</div>
          <ul role="radiogroup" aria-label="Microphones" className="space-y-2">
            {card('', 'System default', 'builtin', micId === '', () => chooseMic(''), defaults.input?.label ? `Follows your system: ${defaults.input.label}` : undefined)}
            {inputs.map((d) => card(d.id, d.label, d.kind, micId === d.id, () => chooseMic(d.id), undefined, true))}
          </ul>
        </section>
        <section aria-label="Playback">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-dim">Listen through</div>
          {sinkOk ? (
            <ul role="radiogroup" aria-label="Outputs" className="space-y-2">
              {card('', 'System default', 'builtin', outId === '', () => void chooseOut(''), defaults.output?.label ? `Follows your system: ${defaults.output.label}` : undefined)}
              {outputs.map((d) => card(d.id, d.label, d.kind, outId === d.id, () => void chooseOut(d.id), undefined, true))}
            </ul>
          ) : (
            <p className="rounded-card border border-line bg-surface-2 p-3 text-sm text-ink-dim">This browser plays through whatever output your system uses. Headphones and interfaces are picked in your system sound settings.</p>
          )}
          {error && <div role="alert" className="mt-2 rounded-card border border-danger/40 bg-danger/10 p-2 text-sm text-ink">{error}</div>}
        </section>
      </div>
  );

  if (inline) return body;
  return (
    <ModalShell open={open} onClose={onClose} title="Audio devices" description="Choose the microphone you record with and where you listen." size="sm"
      footer={<Button variant="primary" size="md" onClick={onClose}>Done</Button>}>
      {body}
    </ModalShell>
  );
};
