/**
 * Mastering: a processor on the master bus that you audition live, then export.
 *
 * The Original / Mastered switch is the centre of the screen: flip it while the mix plays to hear what mastering does.
 * Below it, one scale shows where the mix sits now and where mastering lands it. Presets set the starting point and
 * the fine-tune controls adjust it. Exporting is a separate screen; the footer button carries these settings there.
 */
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { ArrowRight, ChevronDown, Loader2, Pause, Play, RotateCcw } from 'lucide-react';
import { audioEngine } from '../audio/engine';
import { masteringController } from '../audio/masteringController';
import {
  BROADCAST_PRESETS,
  analysisIsCurrent,
  masteringKey,
  presetValues,
  type BroadcastPreset,
  type MasteringProfileType,
  type MasteringSettings,
} from '../audio/masteringSettings';

type PresetType = Exclude<MasteringProfileType, 'bypass'>;
const PRESETS: Array<{ type: PresetType; name: string; blurb: string }> = [
  { type: 'podcast', name: 'Podcast', blurb: 'Even, warm voices' },
  { type: 'broadcast', name: 'Broadcast', blurb: 'Radio, TV and spots' },
  { type: 'music', name: 'Music', blurb: 'Wide stereo, open bass' },
  { type: 'custom', name: 'Custom', blurb: 'Shape it yourself' },
];
const PRESET_LABEL: Record<PresetType, string> = { podcast: 'Podcast', broadcast: 'Broadcast', music: 'Music', custom: 'Custom' };

const SCALE_MIN = -30;
const SCALE_MAX = -8;
const pct = (lufs: number) => Math.min(100, Math.max(0, ((lufs - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100));
const neg = (v: number, digits = 1) => `${v < 0 ? '−' : v > 0 ? '+' : ''}${Math.abs(v).toFixed(digits)}`;
const lufsText = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;

interface MasteringPanelProps {
  settings: MasteringSettings;
  /** Mix fingerprint right now, to tell whether the saved measurement still applies */
  mixKey: string;
  hasAudio: boolean;
  isPlaying: boolean;
  onChange: (patch: Partial<MasteringSettings>) => void;
  onMeasureNow: () => void;
  onTogglePlay: () => void;
  onExport: () => void;
}

const Slider: React.FC<{
  label: string; value: number; min: number; max: number; step: number; unit: string; display?: string;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step, unit, display, onChange }) => (
  <label className="block">
    <span className="mb-1.5 flex items-baseline justify-between text-xs">
      <span className="text-zinc-400">{label}</span>
      <span className="mono-nums text-zinc-100">{display ?? value}<span className="ml-1 text-zinc-500">{unit}</span></span>
    </span>
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ ['--fill' as string]: `${((value - min) / (max - min)) * 100}%` }}
      className="uuda-range w-full cursor-pointer"
    />
  </label>
);

/** Where the mix sits now, where mastering lands it, and (while playing) what is coming out right now. */
const LoudnessScale: React.FC<{ mixLufs?: number; target: number; gainDb?: number; live?: number | null; active: boolean; busy: boolean }> = ({
  mixLufs, target, gainDb, live, active, busy,
}) => {
  const hasMix = mixLufs !== undefined && Number.isFinite(mixLufs);
  const from = hasMix ? pct(mixLufs!) : null;
  const to = pct(target);
  const clampLabel = (p: number) => Math.min(86, Math.max(14, p));
  return (
    <div className="px-1 pb-1 pt-7" aria-hidden="true">
      <div className="relative h-1.5 rounded-full bg-zinc-800">
        {from !== null && active && (
          <div
            className="absolute inset-y-0 rounded-full bg-gradient-to-r from-cyan-400/20 to-cyan-300 transition-all duration-500 ease-out motion-reduce:transition-none"
            style={{ left: `${Math.min(from, to)}%`, width: `${Math.abs(to - from)}%` }}
          />
        )}
        {busy && <div className="absolute inset-0 animate-pulse rounded-full bg-zinc-700/60 motion-reduce:animate-none" />}
        {from !== null && (
          <>
            <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-zinc-400 bg-[#101015]" style={{ left: `${from}%` }} />
            <span className="mono-nums absolute -top-6 -translate-x-1/2 whitespace-nowrap text-[11px] text-zinc-400" style={{ left: `${clampLabel(from)}%` }}>
              Mix {lufsText(mixLufs!)}
            </span>
          </>
        )}
        <span
          className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-all duration-300 motion-reduce:transition-none ${active ? 'border-cyan-300 bg-cyan-300 shadow-[0_0_14px_rgba(0,240,255,0.55)]' : 'border-zinc-600 bg-zinc-700'}`}
          style={{ left: `${to}%` }}
        />
        {typeof live === 'number' && live > SCALE_MIN - 5 && (
          <span className="absolute top-1/2 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90" style={{ left: `${pct(live)}%` }} />
        )}
      </div>
      <div className="relative mt-3 h-4 text-[11px]">
        <span className={`mono-nums absolute -translate-x-1/2 whitespace-nowrap ${active ? 'text-cyan-200' : 'text-zinc-500'}`} style={{ left: `${clampLabel(to)}%` }}>
          Target {lufsText(target)}
        </span>
      </div>
      {hasMix && gainDb !== undefined && active && (
        <p className="mono-nums mt-1 text-center text-[11px] text-zinc-500">{neg(gainDb)} dB make-up gain</p>
      )}
    </div>
  );
};

export const MasteringPanel: React.FC<MasteringPanelProps> = ({
  settings, mixKey, hasAudio, isPlaying, onChange, onMeasureNow, onTogglePlay, onExport,
}) => {
  const status = useSyncExternalStore(masteringController.subscribe, masteringController.getStatus);
  const [fineTuneOpen, setFineTuneOpen] = useState(false);
  const [live, setLive] = useState<number | null>(null);

  useEffect(() => {
    if (!isPlaying) { setLive(null); return; }
    const id = window.setInterval(() => setLive(audioEngine.getMasterLiveMetering().shortTermLUFS), 150);
    return () => window.clearInterval(id);
  }, [isPlaying]);

  const preset = presetValues(settings.type, settings.broadcastPreset);
  const modified = settings.type !== 'custom' && (
    settings.targetLufs !== preset.targetLufs || settings.ceilingDbTP !== preset.ceilingDbTP
    || settings.midPresenceGainDb !== preset.midPresenceGainDb || settings.compressionRatio !== preset.compressionRatio
    || settings.attackMs !== preset.attackMs || settings.releaseMs !== preset.releaseMs
  );
  const analysis = settings.analysis;
  const matched = analysisIsCurrent(settings, mixKey);
  const measuredForSettings = !!analysis && analysis.settingsKey === masteringKey(settings);
  const measuring = settings.active && (status.state === 'analyzing' || status.state === 'waiting');
  const typeKey = (settings.type === 'bypass' ? 'custom' : settings.type) as PresetType;

  const choosePreset = (type: MasteringProfileType) => onChange({ ...presetValues(type), active: settings.active });
  const chooseStandard = (key: BroadcastPreset) => onChange({ ...presetValues('broadcast', key) });

  const caption = !hasAudio
    ? 'Add audio to the timeline to try mastering.'
    : settings.active
      ? `Hearing your mix mastered to ${lufsText(settings.targetLufs)} LUFS.`
      : 'Hearing your original mix.';

  const statusLine = (() => {
    if (!hasAudio || !settings.active) return null;
    if (status.state === 'error') return { tone: 'error' as const, text: status.error ?? 'Loudness measurement failed.', action: 'Try again' };
    if (status.state === 'analyzing') return { tone: 'busy' as const, text: `Measuring loudness, ${status.percent}%`, action: 'Cancel' };
    if (status.state === 'waiting') return { tone: 'busy' as const, text: 'Settings changed. Measuring in a moment.' };
    if (matched) return null;
    return { tone: 'idle' as const, text: measuredForSettings ? 'The mix changed since the last measurement.' : 'Loudness not measured yet.', action: 'Measure now' };
  })();

  return (
    <div className="@container flex h-full min-h-0 flex-col bg-[#101015]">
      <div className="flex-1 space-y-7 overflow-y-auto px-5 pb-6 pt-5">
        {/* Compare */}
        <section aria-label="Compare">
          <div className="flex items-center gap-3">
            <button
              type="button" onClick={onTogglePlay} disabled={!hasAudio}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-100 transition-colors hover:border-zinc-500 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-40"
            >
              {isPlaying ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="ml-0.5 h-4 w-4" fill="currentColor" />}
            </button>
            <div
              role="group" aria-label="Original or mastered"
              className={`relative grid h-11 flex-1 grid-cols-2 rounded-full border border-zinc-800 bg-[#0a0a0e] p-1 ${hasAudio ? '' : 'opacity-50'}`}
            >
              <span
                aria-hidden="true"
                className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full transition-all duration-300 ease-out motion-reduce:transition-none ${settings.active ? 'translate-x-full bg-cyan-300 shadow-[0_0_18px_rgba(0,240,255,0.35)]' : 'bg-zinc-700'}`}
              />
              <button
                type="button" aria-pressed={!settings.active} disabled={!hasAudio} onClick={() => onChange({ active: false })}
                className={`relative z-10 rounded-full text-sm font-semibold transition-colors ${!settings.active ? 'text-zinc-50' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                Original
              </button>
              <button
                type="button" aria-pressed={settings.active} disabled={!hasAudio} onClick={() => onChange({ active: true })}
                className={`relative z-10 rounded-full text-sm font-semibold transition-colors ${settings.active ? 'text-zinc-950' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                Mastered
              </button>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-zinc-500" aria-live="polite">{caption}</p>
        </section>

        {/* Loudness */}
        <section aria-label="Loudness">
          <div className="rounded-2xl border border-zinc-800 bg-[#0e0e13] px-4 pb-4 pt-3">
            <h3 className="text-xs font-semibold text-zinc-300">Loudness</h3>
            <LoudnessScale
              mixLufs={analysis?.mixLufs}
              target={settings.targetLufs}
              gainDb={measuredForSettings ? analysis?.gainDb : undefined}
              live={isPlaying ? live : null}
              active={settings.active}
              busy={measuring}
            />
            {statusLine && (
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-zinc-800/80 pt-3 text-xs" role="status">
                <span className={`flex items-center gap-2 ${statusLine.tone === 'error' ? 'text-rose-300' : 'text-zinc-400'}`}>
                  {statusLine.tone === 'busy' && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300 motion-reduce:animate-none" />}
                  {statusLine.text}
                </span>
                {statusLine.action && (
                  <button
                    type="button"
                    onClick={statusLine.action === 'Cancel' ? () => masteringController.cancel() : onMeasureNow}
                    className="shrink-0 font-semibold text-cyan-300 hover:text-cyan-100"
                  >
                    {statusLine.action}
                  </button>
                )}
              </div>
            )}
            {status.state === 'analyzing' && settings.active && (
              <div className="mt-2.5 h-0.5 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-cyan-300 transition-[width] duration-300" style={{ width: `${status.percent}%` }} />
              </div>
            )}
          </div>
        </section>

        {/* Preset */}
        <section aria-label="Preset">
          <h3 className="mb-3 text-sm font-semibold text-zinc-100">Preset</h3>
          <div role="radiogroup" aria-label="Preset" className="grid grid-cols-2 gap-2.5">
            {PRESETS.map((p) => {
              const selected = typeKey === p.type;
              const target = selected ? settings.targetLufs : presetValues(p.type).targetLufs;
              return (
                <button
                  key={p.type} type="button" role="radio" aria-checked={selected} onClick={() => choosePreset(p.type)}
                  className={`rounded-xl border px-3.5 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${selected ? 'border-cyan-300/70 bg-cyan-300/[0.06]' : 'border-zinc-800 bg-[#0e0e13] hover:border-zinc-600'}`}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={`text-sm font-semibold ${selected ? 'text-zinc-50' : 'text-zinc-200'}`}>{p.name}</span>
                    {p.type !== 'custom' && <span className="mono-nums text-[11px] text-zinc-500">{lufsText(target)}</span>}
                  </span>
                  <span className="mt-1 block text-[11px] leading-snug text-zinc-500">{p.blurb}</span>
                </button>
              );
            })}
          </div>
          <div
            className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${typeKey === 'broadcast' ? 'mt-2.5 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
            aria-hidden={typeKey !== 'broadcast'}
          >
            <div className="overflow-hidden">
              <div role="radiogroup" aria-label="Broadcast standard" className="grid grid-cols-3 gap-1.5 rounded-xl border border-zinc-800 bg-[#0a0a0e] p-1">
                {(Object.keys(BROADCAST_PRESETS) as BroadcastPreset[]).map((key) => {
                  const on = settings.broadcastPreset === key;
                  return (
                    <button
                      key={key} type="button" role="radio" aria-checked={on} tabIndex={typeKey === 'broadcast' ? 0 : -1}
                      onClick={() => chooseStandard(key)} title={BROADCAST_PRESETS[key].standard}
                      className={`rounded-lg px-2 py-2 text-center transition-colors ${on ? 'bg-zinc-700/80 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200'}`}
                    >
                      <span className="block text-xs font-semibold">{BROADCAST_PRESETS[key].label.replace(/ \(.*/, '').replace('Commercial Spot Hot', 'Hot spot')}</span>
                      <span className="mono-nums block text-[10px] opacity-70">{lufsText(BROADCAST_PRESETS[key].targetLufs)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Fine-tune */}
        <section aria-label="Fine-tune">
          <button
            type="button" onClick={() => setFineTuneOpen((o) => !o)} aria-expanded={fineTuneOpen}
            className="flex w-full items-center justify-between text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              Fine-tune
              {modified && <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">Adjusted</span>}
            </span>
            <ChevronDown className={`h-4 w-4 text-zinc-500 transition-transform duration-300 motion-reduce:transition-none ${fineTuneOpen ? 'rotate-180' : ''}`} />
          </button>
          <div className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${fineTuneOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="overflow-hidden">
              <div className="mt-4 grid gap-x-6 gap-y-5 @lg:grid-cols-2">
                <Slider label="Target loudness" value={settings.targetLufs} min={-30} max={-8} step={0.5} unit="LUFS" display={lufsText(settings.targetLufs)} onChange={(v) => onChange({ targetLufs: v })} />
                <Slider label="Peak ceiling" value={settings.ceilingDbTP} min={-3} max={0} step={0.1} unit="dBTP" display={lufsText(settings.ceilingDbTP)} onChange={(v) => onChange({ ceilingDbTP: v })} />
                <Slider label="Voice presence" value={settings.midPresenceGainDb} min={-3} max={6} step={0.5} unit="dB" display={neg(settings.midPresenceGainDb)} onChange={(v) => onChange({ midPresenceGainDb: v })} />
                <Slider label="Compression" value={settings.compressionRatio} min={1} max={8} step={0.1} unit=": 1" display={settings.compressionRatio.toFixed(1)} onChange={(v) => onChange({ compressionRatio: v })} />
                <Slider label="Attack" value={settings.attackMs} min={1} max={100} step={1} unit="ms" onChange={(v) => onChange({ attackMs: v })} />
                <Slider label="Release" value={settings.releaseMs} min={20} max={500} step={5} unit="ms" onChange={(v) => onChange({ releaseMs: v })} />
              </div>
              {modified && (
                <button type="button" onClick={() => choosePreset(settings.type)} className="mt-5 flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-100">
                  <RotateCcw className="h-3.5 w-3.5" /> Reset to preset
                </button>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Hand-off to Export */}
      <div className="flex shrink-0 items-center justify-between gap-4 border-t border-zinc-800 bg-[#0c0c10] px-5 py-3.5">
        <div className="min-w-0 text-xs leading-snug">
          <div className="truncate font-semibold text-zinc-200">{settings.active ? `${PRESET_LABEL[typeKey]}${modified ? ' (adjusted)' : ''}` : 'Mastering off'}</div>
          <div className="truncate text-zinc-500">{settings.active ? `${lufsText(settings.targetLufs)} LUFS` : 'Exports your original mix'}</div>
        </div>
        <button
          type="button" onClick={onExport} disabled={!hasAudio}
          className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-zinc-50 px-5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:opacity-40"
        >
          Continue to export <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
