/**
 * Export: name the file, choose a format, and save. It works the same for every project, mastered or not.
 * Mastering is an optional step in front of it; the summary row shows what will be applied and links back to it.
 */
import React, { useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Download, FileAudio, Loader2, Sparkles, X, XCircle } from 'lucide-react';
import type { Project } from '../types';
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
  onClose?: () => void;
}

interface Finished {
  filename: string;
  blob: Blob;
  kind: 'audio' | 'project';
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
  : bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const lufs = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;

export const ExportPanel: React.FC<ExportPanelProps> = ({ project, mastering, mixKey, onEditMastering, onClose }) => {
  const [title, setTitle] = useState(project.name || 'Uuda Studio Export');
  const [format, setFormat] = useState<ExportFormat>('wav');
  const [kbps, setKbps] = useState<Mp3Bitrate>(192);
  const [useMastering, setUseMastering] = useState(mastering.active);
  const [optimise48, setOptimise48] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ percent: number; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const cancelled = useRef(false);

  const hasAudio = project.tracks.some((t) => t.clips.length > 0);
  const isAudio = format !== 'uuda';
  const sampleRate = project.sampleRate || 48000;
  const seconds = useMemo(() => planMixdown(project, sampleRate).totalFrames / sampleRate, [project, sampleRate]);
  const mp3TooHigh = format === 'mp3' && sampleRate > MP3_MAX_RATE;
  const blocked = mp3TooHigh && !optimise48;
  const outRate = mp3TooHigh ? MP3_MAX_RATE : sampleRate;
  const sizeBytes = format === 'wav' ? seconds * sampleRate * 6 : format === 'mp3' ? seconds * kbps * 125 : 0;
  const PRESET_NAMES: Record<string, string> = { podcast: 'Podcast voice', broadcast: 'Broadcast and radio', music: 'Music and wide stereo', custom: 'Custom', bypass: 'Custom' };
  const preset = mastering.type === 'broadcast' && mastering.broadcastPreset
    ? BROADCAST_PRESETS[mastering.broadcastPreset as BroadcastPreset].label.replace(/ \(.*/, '')
    : PRESET_NAMES[mastering.type] ?? 'Custom';
  const matched = analysisIsCurrent(mastering, mixKey) && mastering.analysis?.settingsKey === masteringKey(mastering);

  const exportAudio = async (): Promise<Finished> => {
    const applied = useMastering;
    const out = await exportProjectToFile(project, {
      format: format as 'wav' | 'mp3',
      wavBitDepth: 24,
      mp3Kbps: kbps,
      mastering: applied ? { settings: mastering, gainDb: matched && outRate === sampleRate ? mastering.analysis!.gainDb : undefined } : null,
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
    return { filename: `${safeBaseName(title)}.${format}`, blob: out.blob, kind: 'audio', stats, verifiedFromFile, mastered: applied };
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
        const blob = encodeProjectFile({ ...project, name: title.trim() || safeBaseName(title) }, (id) => audioEngine.getAsset(id));
        result = { filename: `${safeBaseName(title)}.uuda`, blob, kind: 'project', verifiedFromFile: false, mastered: false };
      } else {
        result = await exportAudio();
      }
      triggerFileDownload(result.blob, result.filename);
      setFinished(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Export failed.';
      if (!cancelled.current) setError(message);
    } finally {
      setRunning(false); setProgress(null);
    }
  };

  const formats: Array<{ value: ExportFormat; name: string; detail: string }> = [
    { value: 'wav', name: 'WAV', detail: '24-bit, lossless' },
    { value: 'mp3', name: 'MP3', detail: 'Small, plays everywhere' },
    { value: 'uuda', name: 'Project', detail: 'Reopen in Uuda Studio' },
  ];

  return (
    <section className="flex h-full min-w-0 flex-col bg-[#101015] text-zinc-100">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Download className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-bold">Export</h2>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close export" className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        )}
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5">
        <div>
          <label htmlFor="export-title" className="mb-1.5 block text-sm font-semibold text-zinc-100">Title</label>
          <div className="flex items-stretch overflow-hidden rounded-lg border border-zinc-700 bg-[#09090d] focus-within:border-cyan-500">
            <input
              id="export-title" value={title} maxLength={180} placeholder="Name your file"
              onChange={(e) => setTitle(e.target.value)} disabled={running}
              className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none"
            />
            <span className="flex items-center border-l border-zinc-800 px-3 font-mono text-xs text-zinc-500">.{format}</span>
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-sm font-semibold text-zinc-100">Format</div>
          <div role="radiogroup" aria-label="Format" className="grid grid-cols-3 gap-2">
            {formats.map((f) => (
              <button
                key={f.value} type="button" role="radio" aria-checked={format === f.value} disabled={running}
                onClick={() => { setFormat(f.value); setFinished(null); setError(null); }}
                className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${format === f.value ? 'border-cyan-400 bg-cyan-500/10 text-white' : 'border-zinc-800 bg-[#17171e] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'}`}
              >
                <span className="block text-sm font-bold">{f.name}</span>
                <span className="mt-0.5 block text-[11px] leading-snug">{f.detail}</span>
              </button>
            ))}
          </div>
          {mp3TooHigh && (
            <div role="group" aria-label="Sample rate" className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3.5 text-xs leading-relaxed">
              <p className="text-amber-100">
                This project runs at {sampleRate / 1000} kHz. MP3 holds up to 48 kHz, which covers everything you can hear.
              </p>
              {optimise48 ? (
                <p className="mt-2 flex items-center justify-between gap-3 text-emerald-200">
                  <span>The MP3 will be converted to 48 kHz. Your project stays at {sampleRate / 1000} kHz.</span>
                  <button type="button" onClick={() => setOptimise48(false)} disabled={running} className="shrink-0 font-semibold text-cyan-300 hover:text-cyan-100">Change</button>
                </p>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => { setFormat('wav'); setFinished(null); }} className="rounded-lg border border-zinc-600 bg-zinc-800/60 py-2 font-semibold text-zinc-100 hover:border-cyan-400">
                    Export as WAV
                  </button>
                  <button type="button" onClick={() => setOptimise48(true)} className="rounded-lg bg-emerald-500 py-2 font-semibold text-emerald-950 hover:brightness-110">
                    Optimise to 48 kHz
                  </button>
                </div>
              )}
            </div>
          )}
          {format === 'mp3' && (
            <div className="mt-3">
              <div className="mb-1.5 text-xs text-zinc-400">Bitrate</div>
              <div className="grid grid-cols-4 gap-1.5">
                {MP3_BITRATES.map((b) => (
                  <button
                    key={b} type="button" aria-pressed={kbps === b} disabled={running} onClick={() => setKbps(b)}
                    className={`rounded-md border py-1.5 text-xs font-semibold transition-colors ${kbps === b ? 'border-cyan-400 bg-cyan-500/10 text-white' : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
                  >
                    {b}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-zinc-500">kbps. 192 suits most uses; 320 keeps the most detail.</p>
            </div>
          )}
          {format === 'uuda' && (
            <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-zinc-400">
              <FileAudio className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
              Saves the timeline with its audio so you can reopen and keep editing. It is not a rendered mix.
            </p>
          )}
        </div>

        {isAudio && (
          <div>
            <div className="mb-1.5 text-sm font-semibold text-zinc-100">Mastering</div>
            <div className="rounded-xl border border-zinc-800 bg-[#0e0e14] p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                    <Sparkles className={`h-4 w-4 ${useMastering ? 'text-emerald-400' : 'text-zinc-500'}`} />
                    {useMastering ? preset : 'Not applied'}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                    {!useMastering
                      ? 'Exports your original mix.'
                      : matched
                        ? `Lands at ${lufs(mastering.targetLufs)} LUFS, peaks under ${lufs(mastering.ceilingDbTP)} dBTP. Loudness is already measured, so export runs in one pass.`
                        : `Lands at ${lufs(mastering.targetLufs)} LUFS, peaks under ${lufs(mastering.ceilingDbTP)} dBTP. Loudness is measured first, which adds a pass.`}
                  </p>
                </div>
                <button
                  type="button" role="switch" aria-checked={useMastering} aria-label="Apply mastering" disabled={running}
                  onClick={() => setUseMastering((v) => !v)}
                  className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${useMastering ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${useMastering ? 'left-[1.375rem]' : 'left-0.5'}`} />
                </button>
              </div>
              <button type="button" onClick={onEditMastering} disabled={running} className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-cyan-300 hover:text-cyan-100 disabled:opacity-50">
                <ArrowLeft className="h-3.5 w-3.5" /> {useMastering ? 'Edit mastering' : 'Open mastering'}
              </button>
            </div>
          </div>
        )}

        {isAudio && hasAudio && (
          <p className="text-xs text-zinc-500">
            {formatTrackLength(seconds)} of audio, about {formatSize(sizeBytes)} as {format.toUpperCase()}.
          </p>
        )}

        {running && progress && (
          <div role="status" className="space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-300">
              <span className="flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />{progress.message}</span>
              <span className="font-mono tabular-nums text-zinc-400">{progress.percent}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-[width] duration-300" style={{ width: `${progress.percent}%` }} />
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/5 p-3 text-xs leading-relaxed text-rose-200">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span>
          </div>
        )}

        {finished && !running && (
          <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5 text-xs leading-relaxed">
            <div className="flex items-start gap-2 text-emerald-100">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <div className="min-w-0">
                <div className="truncate font-semibold">{finished.filename}</div>
                <div className="text-emerald-200/80">{formatSize(finished.blob.size)}, sent to your downloads.</div>
              </div>
            </div>
            {finished.stats && finished.mastered && (
              <p className="mt-2 text-zinc-300">
                {finished.verifiedFromFile ? 'Measured in the saved file' : 'Measured as written'}: {lufs(finished.stats.integratedLUFS)} LUFS, true peak {lufs(finished.stats.truePeakDbTP)} dBTP
                {Math.abs(finished.stats.integratedLUFS - mastering.targetLufs) <= 1 ? ', on target.' : `, ${Math.abs(finished.stats.integratedLUFS - mastering.targetLufs).toFixed(1)} LU from the ${lufs(mastering.targetLufs)} target.`}
              </p>
            )}
            <button type="button" onClick={() => triggerFileDownload(finished.blob, finished.filename)} className="mt-2.5 font-semibold text-cyan-300 hover:text-cyan-100">
              Download again
            </button>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-zinc-800 bg-[#13131a] px-4 py-3">
        {running ? (
          <button type="button" onClick={() => { cancelled.current = true; }} className="w-full rounded-xl border border-zinc-700 py-3 text-sm font-semibold text-zinc-200 hover:bg-zinc-800">
            Cancel export
          </button>
        ) : (
          <button
            type="button" onClick={handleExport} disabled={!hasAudio || !title.trim() || blocked}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 py-3 text-sm font-bold text-zinc-950 shadow-[0_6px_24px_rgba(16,185,129,0.25)] transition-[filter] hover:brightness-110 disabled:opacity-40"
          >
            <Download className="h-4 w-4" /> Export {format === 'uuda' ? 'project' : format.toUpperCase()}
          </button>
        )}
      </div>
    </section>
  );
};
