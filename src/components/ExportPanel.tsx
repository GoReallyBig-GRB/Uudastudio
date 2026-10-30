/**
 * Export: name the file, choose a format, save. It is the same screen for every project, mastered or not.
 * Mastering is an optional step in front of it; its row shows what will be applied and links back to it.
 */
import React, { useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Download, Loader2, X } from 'lucide-react';
import type { Project } from '../types';
import { selectionScope } from '../audio/exportScope';
import { exportProjectToFile, measureExportedBlob, triggerFileDownload, type LoudnessStats } from '../audio/exportProject';
import { masteringController } from '../audio/masteringController';
import { planMixdown } from '../audio/blockMixdown';
import { analysisIsCurrent, masteringKey, BROADCAST_PRESETS, type BroadcastPreset, type MasteringSettings } from '../audio/masteringSettings';
import { encodeProjectFile } from '../storage/projectFile';
import { audioEngine } from '../audio/engine';
import { formatTrackLength } from '../utils/formatters';

type ExportFormat = 'wav' | 'mp3' | 'uuda';
type Mp3Bitrate = 128 | 192 | 256 | 320;

/** Highest sample rate MP3 can carry */
const MP3_MAX_RATE = 48000;
const MP3_BITRATES: Mp3Bitrate[] = [128, 192, 256, 320];
/** Longer files are checked from the signal that was written instead of being decoded back into memory. */
const READBACK_VERIFY_MAX_SECONDS = 30 * 60;

interface ExportPanelProps {
  project: Project;
  mastering: MasteringSettings;
  mixKey: string;
  onEditMastering: () => void;
  onClose: () => void;
  /** Clips selected on the timeline. When there are any, the panel offers to export only those. */
  selectedClipIds?: ReadonlySet<string>;
  /** Opened from "Export" on a selection: start with the selected clips chosen. */
  startWithSelection?: boolean;
}

interface Finished {
  filename: string;
  blob: Blob;
  stats?: LoudnessStats;
  verifiedFromFile: boolean;
  mastered: boolean;
}

function safeBaseName(title: string): string {
  const cleaned = title.trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').replace(/\.+$/g, '');
  return cleaned || 'Uuda Studio Export';
}

const formatSize = (bytes: number) => bytes >= 1024 * 1024 * 1024
  ? `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  : bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(0)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const lufs = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;
const PRESET_NAMES: Record<string, string> = { podcast: 'Podcast', broadcast: 'Broadcast', music: 'Music', custom: 'Custom', bypass: 'Custom' };

const FORMATS: Array<{ value: ExportFormat; name: string; detail: string }> = [
  { value: 'wav', name: 'WAV', detail: '24-bit lossless' },
  { value: 'mp3', name: 'MP3', detail: 'Small, universal' },
  { value: 'uuda', name: 'Project', detail: 'Editable later' },
];

export const ExportPanel: React.FC<ExportPanelProps> = ({ project: fullProject, mastering, mixKey, onEditMastering, onClose, selectedClipIds, startWithSelection = false }) => {
  // Scope: the whole project, or only the selected clips (and their groups), from where they start to where they end
  const selection = useMemo(
    () => (selectedClipIds && selectedClipIds.size > 0 ? selectionScope(fullProject, selectedClipIds) : null),
    [fullProject, selectedClipIds],
  );
  const [scope, setScope] = useState<'all' | 'selection'>(startWithSelection && selection ? 'selection' : 'all');
  const useSelection = scope === 'selection' && !!selection && !!selection.range;
  const project = useSelection ? selection!.project : fullProject;
  const exportRange = useSelection ? selection!.range! : undefined;
  const [title, setTitle] = useState(fullProject.name || 'Uuda Studio Export');
  const [format, setFormat] = useState<ExportFormat>('wav');
  const [kbps, setKbps] = useState<Mp3Bitrate>(192);
  const [optimise48, setOptimise48] = useState(false);
  const [useMastering, setUseMastering] = useState(mastering.active);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ percent: number; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const cancelled = useRef(false);

  const hasAudio = project.tracks.some((t) => t.clips.length > 0);
  const isAudio = format !== 'uuda';
  const sampleRate = project.sampleRate || 48000;
  const seconds = useMemo(() => planMixdown(project, sampleRate, exportRange).totalFrames / sampleRate, [project, sampleRate, exportRange]);
  const mp3TooHigh = format === 'mp3' && sampleRate > MP3_MAX_RATE;
  const blocked = mp3TooHigh && !optimise48;
  const outRate = mp3TooHigh ? MP3_MAX_RATE : sampleRate;
  const sizeBytes = format === 'wav' ? seconds * outRate * 6 : format === 'mp3' ? seconds * kbps * 125 : 0;
  const presetName = mastering.type === 'broadcast' && mastering.broadcastPreset
    ? BROADCAST_PRESETS[mastering.broadcastPreset as BroadcastPreset].label.replace(/ \(.*/, '')
    : PRESET_NAMES[mastering.type] ?? 'Custom';
  const matched = analysisIsCurrent(mastering, mixKey) && mastering.analysis?.settingsKey === masteringKey(mastering);

  const exportAudio = async (): Promise<Finished> => {
    const applied = useMastering;
    const out = await exportProjectToFile(project, {
      format: format as 'wav' | 'mp3',
      wavBitDepth: 24,
      mp3Kbps: kbps,
      range: exportRange,
      // The saved loudness analysis describes the whole mix, so it is only reused for a whole-project export
      mastering: applied ? { settings: mastering, gainDb: matched && !useSelection && outRate === sampleRate ? mastering.analysis!.gainDb : undefined } : null,
      sampleRate: outRate,
      onProgress: (p) => setProgress({ percent: p.percent, message: p.message }),
      isCancelled: () => cancelled.current,
    });
    let stats = out.run.postStats;
    let verifiedFromFile = false;
    if (applied && stats.durationSeconds <= READBACK_VERIFY_MAX_SECONDS) {
      setProgress({ percent: 98, message: 'Checking the saved file...' });
      try { stats = await measureExportedBlob(out.blob); verifiedFromFile = true; } catch { /* keep the measurement of the written signal */ }
    }
    return { filename: `${safeBaseName(title)}.${format}`, blob: out.blob, stats, verifiedFromFile, mastered: applied };
  };

  const handleExport = async () => {
    if (blocked) return;
    if (!hasAudio) { setError('The timeline is empty. Add audio before exporting.'); return; }
    cancelled.current = false;
    setRunning(true); setError(null); setFinished(null);
    masteringController.cancel(); // one heavy job at a time
    setProgress({ percent: 0, message: format === 'uuda' ? 'Packaging project and audio...' : 'Starting...' });
    try {
      let result: Finished;
      if (format === 'uuda') {
        const blob = encodeProjectFile({ ...fullProject, name: title.trim() || safeBaseName(title) }, (id) => audioEngine.getAsset(id));
        result = { filename: `${safeBaseName(title)}.uuda`, blob, verifiedFromFile: false, mastered: false };
      } else {
        result = await exportAudio();
      }
      triggerFileDownload(result.blob, result.filename);
      setFinished(result);
    } catch (e) {
      if (!cancelled.current) setError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setRunning(false); setProgress(null);
    }
  };

  const closeIfIdle = () => { if (!running) onClose(); };
  const measuredOk = finished?.stats ? Math.abs(finished.stats.integratedLUFS - mastering.targetLufs) <= 1 : false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeIfIdle(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') closeIfIdle(); }}
    >
      <section
        role="dialog" aria-modal="true" aria-labelledby="export-heading"
        className="uuda-pop-in flex max-h-[92vh] w-full max-w-[540px] flex-col overflow-hidden rounded-3xl border border-zinc-800 bg-[#101015] text-zinc-100 shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
      >
        <header className="flex items-start justify-between gap-4 px-5 pb-2 pt-6 sm:px-7">
          <div>
            <h2 id="export-heading" className="text-xl font-semibold tracking-tight">Export</h2>
            <p className="mt-1 text-xs text-zinc-500">
              {hasAudio ? `${formatTrackLength(seconds) || '<1m'} of audio, ${sampleRate / 1000} kHz` : 'Nothing on the timeline yet'}
            </p>
          </div>
          <button type="button" onClick={closeIfIdle} disabled={running} aria-label="Close" className="-mr-2 -mt-1 rounded-full p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30">
            <X className="h-4 w-4" />
          </button>
        </header>

        {finished && !running ? (
          <div className="flex flex-col items-center px-7 pb-8 pt-6 text-center" role="status">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-cyan-300 text-zinc-950 shadow-[0_0_30px_rgba(0,240,255,0.35)]">
              <Check className="h-7 w-7" strokeWidth={3} />
            </span>
            <h3 className="mt-5 max-w-full truncate text-lg font-semibold">{finished.filename}</h3>
            <p className="mt-1 text-sm text-zinc-400">{formatSize(finished.blob.size)}, sent to your downloads</p>
            {finished.stats && finished.mastered && (
              <dl className="mt-6 grid w-full grid-cols-2 gap-3 text-left">
                <div className="rounded-2xl border border-zinc-800 bg-[#0e0e13] px-4 py-3">
                  <dt className="text-[11px] text-zinc-500">Loudness</dt>
                  <dd className="mono-nums mt-0.5 text-lg">{lufs(finished.stats.integratedLUFS)}<span className="ml-1 text-xs text-zinc-500">LUFS</span></dd>
                  <dd className={`text-[11px] ${measuredOk ? 'text-cyan-300' : 'text-amber-300'}`}>{measuredOk ? `On target (${lufs(mastering.targetLufs)})` : `Target was ${lufs(mastering.targetLufs)}`}</dd>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-[#0e0e13] px-4 py-3">
                  <dt className="text-[11px] text-zinc-500">True peak</dt>
                  <dd className="mono-nums mt-0.5 text-lg">{lufs(finished.stats.truePeakDbTP)}<span className="ml-1 text-xs text-zinc-500">dBTP</span></dd>
                  <dd className="text-[11px] text-zinc-500">{finished.verifiedFromFile ? 'Measured in the saved file' : 'Measured as written'}</dd>
                </div>
              </dl>
            )}
            <div className="mt-7 flex w-full gap-3">
              <button type="button" onClick={() => triggerFileDownload(finished.blob, finished.filename)} className="h-12 flex-1 rounded-full border border-zinc-700 text-sm font-semibold text-zinc-100 transition-colors hover:bg-zinc-800">
                Download again
              </button>
              <button type="button" onClick={onClose} className="h-12 flex-1 rounded-full bg-zinc-50 text-sm font-semibold text-zinc-950 transition-colors hover:bg-white">
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className={`flex-1 space-y-7 overflow-y-auto px-5 pb-6 pt-5 transition-opacity sm:px-7 ${running ? 'pointer-events-none opacity-40' : ''}`} aria-busy={running}>
              <div>
                <label htmlFor="export-title" className="mb-2 block text-xs font-medium text-zinc-400">Name</label>
                <div className="flex items-baseline gap-2 border-b border-zinc-700 pb-2 transition-colors focus-within:border-cyan-300">
                  <input
                    id="export-title" value={title} maxLength={180} placeholder="Name your file" autoFocus
                    onChange={(e) => setTitle(e.target.value)} disabled={running}
                    className="min-w-0 flex-1 bg-transparent text-xl font-medium outline-none placeholder:text-zinc-600"
                  />
                  <span className="mono-nums shrink-0 text-sm text-zinc-500">.{format}</span>
                </div>
              </div>

              {selection && format !== 'uuda' && (
                <div>
                  <div className="mb-2 text-xs font-medium text-zinc-400">What to export</div>
                  <div role="radiogroup" aria-label="What to export" className="grid grid-cols-2 gap-2.5">
                    {([
                      { value: 'all' as const, name: 'Whole project', detail: 'Every track and clip' },
                      { value: 'selection' as const, name: `Selected (${selection.clipCount} ${selection.clipCount === 1 ? 'clip' : 'clips'})`, detail: `${selection.trackCount} ${selection.trackCount === 1 ? 'track' : 'tracks'}, only their own length` },
                    ]).map((o) => (
                      <button
                        key={o.value} type="button" role="radio" aria-checked={scope === o.value}
                        onClick={() => setScope(o.value)}
                        className={`rounded-2xl border px-4 py-3 text-left transition-colors ${scope === o.value ? 'border-cyan-300/60 bg-cyan-300/10' : 'border-zinc-800 bg-[#0e0e13] hover:bg-zinc-900'}`}
                      >
                        <div className="text-sm font-semibold">{o.name}</div>
                        <div className="text-[11px] text-zinc-500">{o.detail}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="mb-2 text-xs font-medium text-zinc-400">Format</div>
                <div role="radiogroup" aria-label="Format" className="grid grid-cols-3 gap-2.5">
                  {FORMATS.map((f) => {
                    const on = format === f.value;
                    return (
                      <button
                        key={f.value} type="button" role="radio" aria-checked={on}
                        onClick={() => { setFormat(f.value); setFinished(null); setError(null); }}
                        className={`rounded-2xl border px-3.5 py-3.5 text-left transition-colors focus-visible sm:px-4:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${on ? 'border-cyan-300/70 bg-cyan-300/[0.06]' : 'border-zinc-800 bg-[#0e0e13] hover:border-zinc-600'}`}
                      >
                        <span className={`block text-base font-semibold ${on ? 'text-zinc-50' : 'text-zinc-300'}`}>{f.name}</span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">{f.detail}</span>
                      </button>
                    );
                  })}
                </div>

                <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${format === 'mp3' ? 'mt-3 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`} aria-hidden={format !== 'mp3'}>
                  <div className="overflow-hidden">
                    <div role="radiogroup" aria-label="MP3 bitrate" className="grid grid-cols-4 gap-1 rounded-full border border-zinc-800 bg-[#0a0a0e] p-1">
                      {MP3_BITRATES.map((b) => (
                        <button
                          key={b} type="button" role="radio" aria-checked={kbps === b} tabIndex={format === 'mp3' ? 0 : -1} onClick={() => setKbps(b)}
                          className={`rounded-full py-1.5 text-xs font-semibold transition-colors ${kbps === b ? 'bg-zinc-700 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200'}`}
                        >
                          {b} <span className="font-normal opacity-60">kbps</span>
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-[11px] text-zinc-500">192 suits most uses. 320 keeps the most detail.</p>
                  </div>
                </div>

                {format === 'uuda' && (
                  <p className="mt-3 text-xs leading-relaxed text-zinc-500">Saves the timeline with its audio so you can reopen it in Uuda Studio. It is not a rendered mix.</p>
                )}

                {mp3TooHigh && (
                  <div role="group" aria-label="Sample rate" className="mt-3 rounded-2xl border border-amber-400/30 bg-amber-400/[0.05] p-4 text-xs leading-relaxed">
                    <p className="text-amber-100">This project runs at {sampleRate / 1000} kHz. MP3 holds up to 48 kHz, which covers everything you can hear.</p>
                    {optimise48 ? (
                      <p className="mt-2 flex items-center justify-between gap-3 text-zinc-300">
                        <span>The MP3 will be converted to 48 kHz. Your project stays at {sampleRate / 1000} kHz.</span>
                        <button type="button" onClick={() => setOptimise48(false)} className="shrink-0 font-semibold text-cyan-300 hover:text-cyan-100">Change</button>
                      </p>
                    ) : (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => { setFormat('wav'); setFinished(null); }} className="h-10 rounded-full border border-zinc-600 text-xs font-semibold text-zinc-100 transition-colors hover:bg-zinc-800">Export as WAV</button>
                        <button type="button" onClick={() => setOptimise48(true)} className="h-10 rounded-full bg-zinc-50 text-xs font-semibold text-zinc-950 transition-colors hover:bg-white">Optimise to 48 kHz</button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {isAudio && (
                <div>
                  <div className="mb-2 text-xs font-medium text-zinc-400">Mastering</div>
                  <div className="rounded-2xl border border-zinc-800 bg-[#0e0e13] px-4 py-3.5">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-zinc-100">{useMastering ? presetName : 'Original mix'}</div>
                        <div className="mt-0.5 text-xs leading-snug text-zinc-500">
                          {useMastering
                            ? `${lufs(mastering.targetLufs)} LUFS, peaks under ${lufs(mastering.ceilingDbTP)} dBTP${matched ? '' : '. Loudness is measured first.'}`
                            : 'No mastering applied'}
                        </div>
                      </div>
                      <button
                        type="button" role="switch" aria-checked={useMastering} aria-label="Apply mastering"
                        onClick={() => setUseMastering((v) => !v)}
                        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${useMastering ? 'bg-cyan-300' : 'bg-zinc-700'}`}
                      >
                        <span className={`absolute top-1 h-5 w-5 rounded-full shadow transition-all duration-200 motion-reduce:transition-none ${useMastering ? 'left-6 bg-zinc-950' : 'left-1 bg-zinc-300'}`} />
                      </button>
                    </div>
                    <button type="button" onClick={onEditMastering} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-cyan-300 hover:text-cyan-100">
                      <ArrowLeft className="h-3.5 w-3.5" /> {useMastering ? 'Edit mastering' : 'Open mastering'}
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <p role="alert" className="rounded-2xl border border-rose-400/30 bg-rose-400/[0.06] px-4 py-3 text-xs leading-relaxed text-rose-200">{error}</p>
              )}
            </div>

            <footer className="shrink-0 border-t border-zinc-800 bg-[#0c0c10] px-5 py-5 sm:px-7">
              {running && progress ? (
                <div role="status">
                  <div className="mb-2.5 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-zinc-300"><Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300 motion-reduce:animate-none" />{progress.message}</span>
                    <span className="mono-nums text-zinc-400">{progress.percent}%</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
                    <div className="h-full rounded-full bg-cyan-300 transition-[width] duration-300" style={{ width: `${progress.percent}%` }} />
                  </div>
                  <button type="button" onClick={() => { cancelled.current = true; }} className="mt-4 h-11 w-full rounded-full border border-zinc-700 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800">Cancel export</button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <p className="mono-nums whitespace-nowrap text-xs text-zinc-500">
                    {isAudio && hasAudio ? `About ${formatSize(sizeBytes)}` : format === 'uuda' ? 'Project file' : ''}
                  </p>
                  <button
                    type="button" onClick={handleExport} disabled={!hasAudio || !title.trim() || blocked}
                    className="flex h-12 items-center gap-2 whitespace-nowrap rounded-full bg-zinc-50 px-6 text-sm font-semibold text-zinc-950 transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:opacity-40"
                  >
                    <Download className="h-4 w-4" /> Export {format === 'uuda' ? 'project' : format.toUpperCase()}
                  </button>
                </div>
              )}
            </footer>
          </>
        )}
      </section>
    </div>
  );
};
