/**
 * Uuda Studio - New from template.
 * Pick a built-in starter or load a template file, look at what it sets up, and create the project.
 * If the current project has work in it, the choice is explicit: save it first, or use the template without saving.
 */

import React, { useEffect, useRef, useState } from 'react';
import { LayoutTemplate, X, Upload, Mic, Music, Volume2, Layers, ArrowDownToLine, SlidersHorizontal, AlertTriangle } from 'lucide-react';
import { BUILT_IN_TEMPLATES } from '../templates/builtIn';
import { parseTemplate, TrackRole, UudaTemplate } from '../templates/template';

interface TemplatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The current project has tracks, so using a template replaces something */
  hasWork: boolean;
  projectName: string;
  onUseTemplate: (template: UudaTemplate, saveFirst: boolean) => void;
}

const ROLE_ICON: Record<TrackRole, React.ReactNode> = {
  voice: <Mic className="w-3.5 h-3.5 text-cyan-300" />,
  music: <Music className="w-3.5 h-3.5 text-emerald-300" />,
  sfx: <Volume2 className="w-3.5 h-3.5 text-amber-300" />,
  other: <Layers className="w-3.5 h-3.5 text-zinc-400" />,
};

const ROLE_LABEL: Record<TrackRole, string> = { voice: 'Voice', music: 'Music', sfx: 'Effects', other: 'Track' };

export const TemplatesModal: React.FC<TemplatesModalProps> = ({ isOpen, onClose, hasWork, projectName, onUseTemplate }) => {
  const [fromFiles, setFromFiles] = useState<UudaTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string>(BUILT_IN_TEMPLATES[0].id);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const all = [...BUILT_IN_TEMPLATES, ...fromFiles];
  const selected = all.find((t) => t.id === selectedId) || all[0];

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > 2_000_000) {
      setError('That file is too large to be a template.');
      return;
    }
    const result = parseTemplate(await file.text());
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Give a loaded file its own id so it can sit beside a starter of the same id
    const loaded: UudaTemplate = { ...result.template, id: `file-${Date.now().toString(36)}-${result.template.id}` };
    setFromFiles((prev) => [...prev, loaded]);
    setSelectedId(loaded.id);
  };

  const names = (t: UudaTemplate, idxs: number[]) => idxs.map((i) => t.tracks[i]?.name).filter(Boolean).join(', ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-2 sm:p-4 select-none">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New from template"
        className="w-full max-w-3xl h-[calc(100dvh-1rem)] sm:h-auto sm:max-h-[calc(100dvh-2rem)] flex flex-col bg-[#101016] border border-zinc-700 rounded-lg overflow-hidden text-xs text-zinc-200"
      >
        <div className="flex items-center gap-3 px-3 sm:px-5 py-3 border-b border-zinc-800 bg-[#13131D] shrink-0">
          <div className="w-8 h-8 rounded-sm bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-300 shrink-0">
            <LayoutTemplate className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-black uppercase tracking-wide text-white">New from template</h2>
            <p className="hidden sm:block text-[11px] text-zinc-500">Starts an empty project with tracks, effects and ducking already set up</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" title="Close" className="p-1.5 rounded-sm text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col sm:flex-row overflow-hidden">
          {/* List */}
          <div className="sm:w-60 shrink-0 border-b sm:border-b-0 sm:border-r border-zinc-800 bg-[#0D0D14] overflow-y-auto max-h-44 sm:max-h-none p-2 space-y-1.5">
            {all.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedId(t.id)}
                aria-pressed={t.id === selected.id}
                className={`w-full text-left px-2.5 py-2 rounded-sm border cursor-pointer ${
                  t.id === selected.id ? 'bg-[#181826] border-cyan-500/60' : 'bg-[#121218] border-zinc-800 hover:border-zinc-600'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-bold text-zinc-100 truncate">{t.name}</span>
                  {t.builtIn ? (
                    <span className="text-[9px] px-1 py-0.5 rounded-sm bg-purple-500/15 text-purple-300 font-mono font-bold shrink-0">Starter</span>
                  ) : (
                    <span className="text-[9px] px-1 py-0.5 rounded-sm bg-zinc-800 text-zinc-300 font-mono font-bold shrink-0">File</span>
                  )}
                </div>
                <div className="text-[10px] text-zinc-500 mt-0.5">{t.tracks.length} tracks</div>
              </button>
            ))}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-sm border border-dashed border-zinc-600 text-zinc-300 hover:text-cyan-300 hover:border-cyan-500/60 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              Open template file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                void handleFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            {error && (
              <p role="alert" className="flex gap-1.5 text-[11px] text-rose-300 px-1 pt-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                {error}
              </p>
            )}
          </div>

          {/* Preview */}
          <div className="flex-1 min-w-0 overflow-y-auto p-3 sm:p-5 space-y-3">
            <div>
              <h3 className="text-sm font-bold text-white">{selected.name}</h3>
              {selected.description && <p className="text-zinc-400 mt-1">{selected.description}</p>}
              {selected.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {selected.tags.map((tag) => (
                    <span key={tag} className="px-1.5 py-0.5 rounded-sm bg-zinc-800 text-zinc-300 text-[10px]">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <ol className="space-y-1.5">
              {selected.tracks.map((t, i) => {
                const role: TrackRole = t.role;
                return (
                <li key={i} className="flex items-start gap-2.5 px-2.5 py-2 rounded-sm bg-[#151522] border border-zinc-800">
                  <span className="w-5 h-5 rounded-sm bg-zinc-800 flex items-center justify-center font-mono text-[10px] font-bold text-zinc-300 shrink-0">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {ROLE_ICON[role]}
                      <span className="font-bold text-zinc-100 truncate">{t.name}</span>
                      <span className="text-[10px] text-zinc-500 shrink-0">{ROLE_LABEL[role]}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-zinc-400">
                      {t.plugins && t.plugins.length > 0 && (
                        <span className="flex items-center gap-1">
                          <SlidersHorizontal className="w-3 h-3" />
                          {t.plugins.length} {t.plugins.length === 1 ? 'plugin' : 'plugins'}
                        </span>
                      )}
                      {t.ducking && t.ducking.enabled && (
                        <span className="flex items-center gap-1 text-emerald-300">
                          <ArrowDownToLine className="w-3 h-3" />
                          {t.ducking.sourceTrackIndexes.length > 0 ? `Ducks under ${names(selected, t.ducking.sourceTrackIndexes)}` : 'Auto duck on'}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
                );
              })}
            </ol>

            {selected.masterPlugins && selected.masterPlugins.length > 0 && (
              <p className="text-[11px] text-zinc-400">Master bus: {selected.masterPlugins.length} {selected.masterPlugins.length === 1 ? 'plugin' : 'plugins'}</p>
            )}
            <p className="text-[11px] text-zinc-500">Tracks start empty. Record, import or generate audio into them.</p>
          </div>
        </div>

        <div className="px-3 sm:px-5 py-3 border-t border-zinc-800 bg-[#13131D] shrink-0 space-y-2">
          {hasWork && (
            <p className="flex gap-1.5 text-[11px] text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              This replaces the open project{projectName ? ` "${projectName}"` : ''}. Save it first if you want to keep it.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-sm text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer">
              Cancel
            </button>
            {hasWork && (
              <button
                type="button"
                onClick={() => onUseTemplate(selected, false)}
                className="px-3 py-1.5 rounded-sm border border-zinc-600 text-zinc-200 hover:bg-zinc-800 cursor-pointer"
              >
                Use without saving
              </button>
            )}
            <button
              type="button"
              onClick={() => onUseTemplate(selected, hasWork)}
              className="px-4 py-1.5 rounded-sm bg-cyan-500 hover:bg-cyan-400 text-black font-bold cursor-pointer"
            >
              {hasWork ? 'Save, then use' : 'Create project'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
