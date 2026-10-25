import React, { useState } from 'react';
import { CheckCircle2, Download, FileAudio, Loader2, XCircle } from 'lucide-react';
import type { Project } from '../types';
import { renderProjectOffline, exportAudioBufferToWavAsync, exportAudioBufferToMp3, triggerFileDownload } from '../audio/mastering';
import { encodeProjectFile } from '../storage/projectFile';
import { audioEngine } from '../audio/engine';

type ExportFormat = 'wav' | 'mp3' | 'uuda';

interface ExportPanelProps {
  project: Project;
  onClose?: () => void;
}

function safeBaseName(title: string): string {
  const cleaned = title.trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').replace(/\.+$/g, '');
  return cleaned || 'Uuda Studio Export';
}

export const ExportPanel: React.FC<ExportPanelProps> = ({ project, onClose }) => {
  const [outputTitle, setOutputTitle] = useState(project.name || 'Uuda Studio Export');
  const [format, setFormat] = useState<ExportFormat>('wav');
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const handleExport = async () => {
    if (!project.tracks.length) {
      setStatus({ kind: 'error', message: 'The timeline is empty. Add audio before exporting.' });
      return;
    }
    const baseName = safeBaseName(outputTitle);
    setIsExporting(true);
    setStatus(null);
    setProgress(format === 'uuda' ? 'Packaging project and referenced audio…' : 'Rendering the current mix…');
    try {
      if (format === 'uuda') {
        // The project package includes project metadata and the exact PCM samples for referenced assets.
        const projectForExport = { ...project, name: outputTitle.trim() || baseName };
        const blob = encodeProjectFile(projectForExport, (assetId) => audioEngine.getAsset(assetId));
        const filename = `${baseName}.uuda`;
        triggerFileDownload(blob, filename);
        setStatus({ kind: 'success', message: `Project exported as ${filename}. It contains the project and its referenced audio and can be reopened in Uuda Studio.` });
        setProgress(null);
        return;
      }

      const rendered = await renderProjectOffline(project, project.sampleRate || 48000, {
        onProgress: (p) => setProgress(p.message),
      });
      let blob: Blob;
      let filename: string;
      if (format === 'wav') {
        setProgress('Encoding 24-bit PCM WAV…');
        blob = await exportAudioBufferToWavAsync(rendered, 24);
        filename = `${baseName}.wav`;
      } else {
        setProgress('Encoding 320 kbps MP3…');
        blob = await exportAudioBufferToMp3(rendered, 320);
        filename = `${baseName}.mp3`;
      }
      triggerFileDownload(blob, filename);
      const size = blob.size >= 1024 * 1024
        ? `${(blob.size / (1024 * 1024)).toFixed(2)} MB`
        : `${Math.max(1, Math.round(blob.size / 1024))} KB`;
      setStatus({ kind: 'success', message: `Exported ${filename} (${size}). The current mix was rendered without applying a second mastering pass.` });
      setProgress(null);
    } catch (error) {
      setProgress(null);
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Export failed. Please try again.' });
    } finally {
      setIsExporting(false);
    }
  };

  const formats: Array<{ value: ExportFormat; title: string; detail: string }> = [
    { value: 'wav', title: '.wav', detail: '24-bit PCM audio' },
    { value: 'mp3', title: '.mp3', detail: '320 kbps audio' },
    { value: 'uuda', title: '.uuda', detail: 'Reopenable project + audio' },
  ];

  return (
    <section className="flex h-full min-w-0 flex-col bg-[#101015] text-zinc-100">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <Download className="h-4 w-4 text-emerald-400" />
          <div>
            <h2 className="text-sm font-bold">Export</h2>
            <p className="text-[10px] text-zinc-500">Generate an output from the current mix</p>
          </div>
        </div>
        {onClose && <button type="button" onClick={onClose} aria-label="Close export panel" className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"><XCircle className="h-4 w-4" /></button>}
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <div className="space-y-1.5">
          <label htmlFor="export-output-title" className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400">Output / track title</label>
          <input
            id="export-output-title"
            value={outputTitle}
            onChange={(event) => setOutputTitle(event.target.value)}
            maxLength={180}
            placeholder="Enter output title"
            className="w-full rounded-lg border border-zinc-700 bg-[#09090d] px-3 py-2.5 text-sm outline-none focus:border-cyan-500"
          />
          <p className="text-[10px] text-zinc-500">The title is used for the downloaded filename{format === 'uuda' ? ' and the saved project name' : ''}.</p>
        </div>

        <div className="space-y-2">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400">Output format</label>
          <div className="grid grid-cols-3 gap-2">
            {formats.map((item) => (
              <button key={item.value} type="button" onClick={() => { setFormat(item.value); setStatus(null); }}
                aria-pressed={format === item.value}
                className={`rounded-lg border p-3 text-left transition-colors ${format === item.value ? 'border-cyan-400 bg-cyan-500/10 text-white' : 'border-zinc-800 bg-[#17171e] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'}`}>
                <span className="block text-sm font-bold">{item.title}</span>
                <span className="mt-1 block text-[10px] leading-snug">{item.detail}</span>
              </button>
            ))}
          </div>
        </div>

        {format === 'uuda' && (
          <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3 text-xs leading-relaxed text-zinc-300">
            <div className="mb-1 flex items-center gap-2 font-semibold text-indigo-300"><FileAudio className="h-4 w-4" /> Self-contained project file</div>
            This packages project metadata and the audio assets referenced by the timeline. It is not an audio render and can be reopened in Uuda Studio.
          </div>
        )}

        {progress && (
          <div role="status" className="rounded-lg border border-zinc-800 bg-black/30 p-3 text-xs text-zinc-300">
            <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin text-cyan-400" />{progress}
          </div>
        )}

        {status && (
          <div role="status" className={`flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed ${status.kind === 'success' ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-200' : 'border-rose-500/40 bg-rose-500/5 text-rose-200'}`}>
            {status.kind === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{status.message}</span>
          </div>
        )}

        <button type="button" onClick={handleExport} disabled={isExporting || !project.tracks.length}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-xs font-extrabold text-white shadow-lg transition-colors hover:from-emerald-500 hover:to-teal-500 disabled:cursor-not-allowed disabled:opacity-50">
          {isExporting ? <><Loader2 className="h-4 w-4 animate-spin" /> Exporting…</> : <><Download className="h-4 w-4" /> Export {format.toUpperCase()}</>}
        </button>
      </div>
    </section>
  );
};
