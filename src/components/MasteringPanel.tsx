/**
 * Mastering: a processor on the master bus that you audition live and then export.
 *
 * One switch compares your mix with and without mastering while it plays. Presets set the starting point, the
 * fine-tune controls adjust it, and a background loudness measurement keeps the make-up gain on target for any length
 * of project. Exporting is a separate step: the Export button opens the Export screen with these settings carried over.
 */
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { AlertCircle, ChevronDown, Loader2, Pause, Play, RotateCcw, Upload } from 'lucide-react';
import { audioEngine, type MasterLiveMetering } from '../audio/engine';
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

const PRESETS: Array<{ type: Exclude<MasteringProfileType, 'bypass'>; name: string; blurb: string }> = [
  { type: 'podcast', name: 'Podcast voice', blurb: 'Even voices and warm compression for podcast and streaming platforms.' },
  { type: 'broadcast', name: 'Broadcast and radio', blurb: 'Firm compression and extra presence for radio, TV and spots.' },
  { type: 'music', name: 'Music and wide stereo', blurb: 'Keeps stereo width and bass, with a transparent limiter.' },
  { type: 'custom', name: 'Custom', blurb: 'Start from a neutral setting and shape it yourself.' },
];

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

const fmt = (v: number, digits = 1) => (Number.isFinite(v) && v > -69 ? v.toFixed(digits) : '–');
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
const lufsText = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;

const Slider: React.FC<{
  label: string; value: number; min: number; max: number; step: number; unit: string; display?: string;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step, unit, display, onChange }) => (
  <label className="block">
    <div className="mb-1 flex items-baseline justify-between text-xs">
      <span className="text-zinc-300">{label}</span>
      <span className="font-mono tabular-nums text-zinc-100">{display ?? value}<span className="ml-0.5 text-zinc-500">{unit}</span></span>
    </div>
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-cyan-400"
    />
  </label>
);

export const MasteringPanel: React.FC<MasteringPanelProps> = ({
  settings, mixKey, hasAudio, isPlaying, onChange, onMeasureNow, onTogglePlay, onExport,
}) => {
  const status = useSyncExternalStore(masteringController.subscribe, masteringController.getStatus);
  const [fineTuneOpen, setFineTuneOpen] = useState(false);
  const [meters, setMeters] = useState<MasterLiveMetering | null>(null);

  useEffect(() => {
    if (!isPlaying) { setMeters(null); return; }
    const id = window.setInterval(() => setMeters(audioEngine.getMasterLiveMetering()), 120);
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
  const hasSettingsMeasurement = !!analysis && analysis.settingsKey === masteringKey(settings);

  const choosePreset = (type: MasteringProfileType) => onChange({ ...presetValues(type), active: settings.active });
  const chooseStandard = (key: BroadcastPreset) => onChange({ ...presetValues('broadcast', key) });

  const statusLine = (() => {
    if (!hasAudio) return { tone: 'muted', text: 'Add audio to the timeline to match its loudness.' };
    if (!settings.active) return { tone: 'muted', text: 'Mastering is off. Playback and export use your original mix.' };
    if (status.state === 'error') return { tone: 'error', text: status.error ?? 'Loudness measurement failed.' };
    if (status.state === 'analyzing') return { tone: 'busy', text: `Measuring loudness… ${status.percent}%` };
    if (status.state === 'waiting') return { tone: 'busy', text: 'Change noticed. Measuring loudness in a moment…' };
    if (matched && analysis) {
      return { tone: 'ok', text: `On target. Your mix measures ${lufsText(analysis.mixLufs)} LUFS and mastering lands it at ${lufsText(settings.targetLufs)} LUFS (${signed(analysis.gainDb)} dB make-up gain).` };
    }
    return { tone: 'muted', text: hasSettingsMeasurement ? 'The mix changed since the last measurement.' : 'Loudness has not been measured yet.' };
  })();
  const showMeasureNow = hasAudio && settings.active && (status.state === 'error' || (status.state === 'idle' && !matched));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
        {/* Compare: the memorable control */}
        <section aria-label="Compare mastering">
          <div role="group" aria-label="Mastering on or off" className="grid grid-cols-2 rounded-xl border border-zinc-800 bg-[#0b0b10] p-1">
            <button
              type="button" aria-pressed={!settings.active} onClick={() => onChange({ active: false })}
              className={`rounded-lg py-2.5 text-sm font-semibold transition-colors ${!settings.active ? 'bg-zinc-700/70 text-zinc-50' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              Original
            </button>
            <button
              type="button" aria-pressed={settings.active} onClick={() => onChange({ active: true })}
              className={`rounded-lg py-2.5 text-sm font-semibold transition-all ${settings.active ? 'bg-emerald-500 text-emerald-950 shadow-[0_0_18px_rgba(16,185,129,0.35)]' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              Mastered
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs leading-relaxed text-zinc-400">
              Switch while the track plays to hear the difference. Export uses whichever side is selected.
            </p>
            <button
              type="button" onClick={onTogglePlay} disabled={!hasAudio}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/70 px-3 text-xs font-semibold text-zinc-100 transition-colors hover:border-cyan-500/60 hover:text-cyan-200 disabled:opacity-40"
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {isPlaying ? 'Pause' : 'Play'}
            </button>
          </div>
        </section>

        {/* Presets */}
        <section aria-label="Preset">
          <h3 className="mb-2 text-sm font-semibold text-zinc-100">Preset</h3>
          <div role="radiogroup" className="divide-y divide-zinc-800/80 overflow-hidden rounded-xl border border-zinc-800">
            {PRESETS.map((p) => {
              const selected = settings.type === p.type;
              const target = p.type === 'broadcast' && settings.type === 'broadcast' ? settings.targetLufs : presetValues(p.type).targetLufs;
              return (
                <div key={p.type} className={selected ? 'bg-cyan-500/[0.07]' : ''}>
                  <button
                    type="button" role="radio" aria-checked={selected} onClick={() => choosePreset(p.type)}
                    className="flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors hover:bg-zinc-800/40"
                  >
                    <span className={`mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${selected ? 'border-cyan-400 bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]' : 'border-zinc-600'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`text-sm font-semibold ${selected ? 'text-zinc-50' : 'text-zinc-200'}`}>{p.name}</span>
                        {p.type !== 'custom' && (
                          <span className="font-mono text-xs tabular-nums text-zinc-400">{lufsText(target)} LUFS</span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs leading-snug text-zinc-500">{p.blurb}</span>
                    </span>
                  </button>
                  {selected && p.type === 'broadcast' && (
                    <div className="flex gap-1.5 px-3.5 pb-3 pl-[2.375rem]">
                      {(Object.keys(BROADCAST_PRESETS) as BroadcastPreset[]).map((key) => (
                        <button
                          key={key} type="button" onClick={() => chooseStandard(key)} aria-pressed={settings.broadcastPreset === key}
                          title={BROADCAST_PRESETS[key].standard}
                          className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${settings.broadcastPreset === key ? 'border-cyan-500/70 bg-cyan-500/15 text-cyan-100' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}
                        >
                          {BROADCAST_PRESETS[key].label.replace(/ \(.*/, '')}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Loudness match */}
        <section aria-label="Loudness match" aria-live="polite">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-zinc-100">Loudness</h3>
            {showMeasureNow && (
              <button type="button" onClick={onMeasureNow} className="text-xs font-semibold text-cyan-300 hover:text-cyan-100">
                {status.state === 'error' ? 'Try again' : 'Measure now'}
              </button>
            )}
          </div>
          <div className="mt-2 flex items-start gap-2.5 text-xs leading-relaxed">
            {statusLine.tone === 'busy' && <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-cyan-300" />}
            {statusLine.tone === 'error' && <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />}
            {statusLine.tone === 'ok' && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-400" />}
            <p className={statusLine.tone === 'error' ? 'text-rose-300' : statusLine.tone === 'ok' ? 'text-zinc-200' : 'text-zinc-400'}>{statusLine.text}</p>
          </div>
          {status.state === 'analyzing' && (
            <div className="mt-2.5 flex items-center gap-3">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full rounded-full bg-cyan-400 transition-[width] duration-300" style={{ width: `${status.percent}%` }} />
              </div>
              <button type="button" onClick={() => masteringController.cancel()} className="text-xs text-zinc-400 hover:text-zinc-100">Cancel</button>
            </div>
          )}
        </section>

        {/* Fine-tune */}
        <section aria-label="Fine-tune">
          <button
            type="button" onClick={() => setFineTuneOpen((o) => !o)} aria-expanded={fineTuneOpen}
            className="flex w-full items-center justify-between text-left"
          >
            <span className="text-sm font-semibold text-zinc-100">
              Fine-tune
              {modified && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-300">Adjusted</span>}
            </span>
            <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${fineTuneOpen ? 'rotate-180' : ''}`} />
          </button>
          {fineTuneOpen && (
            <div className="mt-3 space-y-4 rounded-xl border border-zinc-800 bg-[#0e0e14] p-3.5">
              <Slider label="Target loudness" value={settings.targetLufs} min={-30} max={-8} step={0.5} unit="LUFS" display={lufsText(settings.targetLufs)} onChange={(v) => onChange({ targetLufs: v })} />
              <Slider label="Peak ceiling" value={settings.ceilingDbTP} min={-3} max={0} step={0.1} unit="dBTP" display={lufsText(settings.ceilingDbTP)} onChange={(v) => onChange({ ceilingDbTP: v })} />
              <Slider label="Voice presence" value={settings.midPresenceGainDb} min={-3} max={6} step={0.5} unit="dB" display={signed(settings.midPresenceGainDb)} onChange={(v) => onChange({ midPresenceGainDb: v })} />
              <Slider label="Compression" value={settings.compressionRatio} min={1} max={8} step={0.1} unit=": 1" display={settings.compressionRatio.toFixed(1)} onChange={(v) => onChange({ compressionRatio: v })} />
              <div className="grid grid-cols-2 gap-4">
                <Slider label="Attack" value={settings.attackMs} min={1} max={100} step={1} unit="ms" onChange={(v) => onChange({ attackMs: v })} />
                <Slider label="Release" value={settings.releaseMs} min={20} max={500} step={5} unit="ms" onChange={(v) => onChange({ releaseMs: v })} />
              </div>
              {modified && (
                <button
                  type="button" onClick={() => choosePreset(settings.type)}
                  className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-100"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reset to preset
                </button>
              )}
            </div>
          )}
        </section>

        {/* Live meters */}
        <section aria-label="Live meters">
          <h3 className="mb-2 text-sm font-semibold text-zinc-100">While playing</h3>
          <dl className="grid grid-cols-4 gap-2">
            {[
              { label: 'Momentary', value: meters ? fmt(meters.momentaryLUFS) : '–', unit: 'LUFS' },
              { label: 'Short-term', value: meters ? fmt(meters.shortTermLUFS) : '–', unit: 'LUFS' },
              { label: 'True peak', value: meters ? fmt(meters.truePeakDbTP) : '–', unit: 'dBTP', warn: !!meters && meters.truePeakDbTP > settings.ceilingDbTP + 0.1 && settings.active },
              { label: 'Reduction', value: meters ? Math.abs(meters.gainReductionDb).toFixed(1) : '–', unit: 'dB' },
            ].map((m) => (
              <div key={m.label} className="rounded-lg bg-[#0b0b10] px-2 py-2">
                <dt className="text-[11px] text-zinc-500">{m.label}</dt>
                <dd className={`mt-0.5 font-mono text-sm tabular-nums ${m.warn ? 'text-rose-300' : 'text-zinc-100'}`}>
                  {m.value}<span className="ml-0.5 text-[10px] text-zinc-500">{m.unit}</span>
                </dd>
              </div>
            ))}
          </dl>
          {!isPlaying && <p className="mt-2 text-xs text-zinc-500">Press play to watch the levels.</p>}
        </section>
      </div>

      {/* Hand-off to Export */}
      <div className="shrink-0 border-t border-zinc-800 bg-[#13131a] px-4 py-3">
        <button
          type="button" onClick={onExport} disabled={!hasAudio}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 py-3 text-sm font-bold text-zinc-950 shadow-[0_6px_24px_rgba(16,185,129,0.25)] transition-[filter] hover:brightness-110 disabled:opacity-40"
        >
          <Upload className="h-4 w-4" />
          Export {settings.active ? 'mastered mix' : 'original mix'}
        </button>
      </div>
    </div>
  );
};
