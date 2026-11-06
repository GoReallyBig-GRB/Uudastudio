/**
 * Uuda Studio - New from template.
 * Pick a built-in starter or load a template file, look at what it sets up, and create the project.
 * If the current project has work in it, the choice is explicit: save it first, or use the template without saving.
 * Built on the shared dialog frame: rounded panel, pill buttons and badges, tokens only.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Upload, Cloud, Trash2, Mic, Music, Volume2, Layers, ArrowDownToLine, SlidersHorizontal, AlertTriangle } from 'lucide-react';
import { BUILT_IN_TEMPLATES } from '../templates/builtIn';
import { parseTemplate, TrackRole, UudaTemplate } from '../templates/template';
import { Button, ModalShell, cn } from './ui';
import { CloudTemplate, listCloudTemplates, deleteCloudTemplate, TemplateSyncError } from '../templates/templateApi';

interface TemplatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The current project has tracks, so using a template replaces something */
  hasWork: boolean;
  projectName: string;
  /** Signed in: templates saved to the account are listed too */
  signedIn: boolean;
  /** Bump to reload the account list (after saving one) */
  refreshKey?: number;
  onUseTemplate: (template: UudaTemplate, saveFirst: boolean) => void;
}

const ROLE_ICON: Record<TrackRole, React.ReactNode> = {
  voice: <Mic className="h-3.5 w-3.5 text-ink-dim" aria-hidden="true" />,
  music: <Music className="h-3.5 w-3.5 text-ink-dim" aria-hidden="true" />,
  sfx: <Volume2 className="h-3.5 w-3.5 text-ink-dim" aria-hidden="true" />,
  other: <Layers className="h-3.5 w-3.5 text-ink-dim" aria-hidden="true" />,
};

const ROLE_LABEL: Record<TrackRole, string> = { voice: 'Voice', music: 'Music', sfx: 'Effects', other: 'Track' };

export const TemplatesModal: React.FC<TemplatesModalProps> = ({ isOpen, onClose, hasWork, projectName, signedIn, refreshKey = 0, onUseTemplate }) => {
  const [fromFiles, setFromFiles] = useState<UudaTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string>(BUILT_IN_TEMPLATES[0].id);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [cloud, setCloud] = useState<CloudTemplate[]>([]);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Load the account's templates each time the window opens (and when one has just been saved)
  useEffect(() => {
    if (!isOpen || !signedIn) {
      setCloud([]);
      setCloudError(null);
      return;
    }
    let cancelled = false;
    setCloudLoading(true);
    setCloudError(null);
    listCloudTemplates()
      .then((items) => { if (!cancelled) setCloud(items); })
      .catch((err) => { if (!cancelled) setCloudError(err instanceof TemplateSyncError ? err.message : 'Could not load your saved templates.'); })
      .finally(() => { if (!cancelled) setCloudLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, signedIn, refreshKey]);

  const removeCloud = async (id: string) => {
    setDeletingId(id);
    setCloudError(null);
    try {
      await deleteCloudTemplate(id);
      setCloud((prev) => prev.filter((t) => t.id !== id));
      setSelectedId((cur) => (cur === id ? BUILT_IN_TEMPLATES[0].id : cur));
      setConfirmDeleteId(null);
    } catch (err) {
      setCloudError(err instanceof TemplateSyncError ? err.message : 'Could not delete that template.');
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    if (isOpen) setError(null);
  }, [isOpen]);

  const all = [...BUILT_IN_TEMPLATES, ...cloud.map((c) => c.template), ...fromFiles];
  const cloudIds = new Set(cloud.map((c) => c.id));
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
  /** Small rounded label: quiet by default, cyan only for the account badge */
  const badge = (tone: 'quiet' | 'accent') =>
    cn('shrink-0 rounded-full border px-2 py-px text-[10px] font-medium', tone === 'accent' ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line bg-surface-3 text-ink-dim');

  return (
    <ModalShell
      open={isOpen}
      onClose={onClose}
      title="New from template"
      description="Starts an empty project with tracks, effects and ducking already set up"
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          {hasWork && <Button variant="secondary" size="sm" onClick={() => onUseTemplate(selected, false)}>Use without saving</Button>}
          <Button variant="primary" size="sm" onClick={() => onUseTemplate(selected, hasWork)}>{hasWork ? 'Save, then use' : 'Create project'}</Button>
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-[15rem_1fr]">
        {/* List */}
        <div className="space-y-1.5">
          {all.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedId(t.id)}
              aria-pressed={t.id === selected.id}
              className={cn(
                'w-full cursor-pointer rounded-control border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                t.id === selected.id ? 'border-accent/40 bg-accent-soft' : 'border-line bg-surface-2 hover:border-line-strong hover:bg-surface-3',
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className={cn('truncate text-xs font-semibold', t.id === selected.id ? 'text-accent' : 'text-ink')}>{t.name}</span>
                {t.builtIn ? (
                  <span className={badge('quiet')}>Starter</span>
                ) : cloudIds.has(t.id) ? (
                  <span className={badge('accent')}>Account</span>
                ) : (
                  <span className={badge('quiet')}>File</span>
                )}
              </div>
              <div className="mt-0.5 text-[10px] text-ink-faint">{t.tracks.length} tracks</div>
            </button>
          ))}
          <Button variant="secondary" size="sm" className="w-full border-dashed" leftIcon={<Upload className="h-3.5 w-3.5" aria-hidden="true" />} onClick={() => fileRef.current?.click()}>
            Open template file
          </Button>
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
          {!signedIn && (
            <p className="flex gap-1.5 px-1 pt-1 text-[11px] text-ink-faint">
              <Cloud className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Sign in to keep templates on your account.
            </p>
          )}
          {signedIn && cloudLoading && <p className="px-1 pt-1 text-[11px] text-ink-faint">Loading your templates…</p>}
          {cloudError && (
            <p role="alert" className="flex gap-1.5 px-1 pt-1 text-[11px] text-danger">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {cloudError}
            </p>
          )}
          {error && (
            <p role="alert" className="flex gap-1.5 px-1 pt-1 text-[11px] text-danger">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
        </div>

        {/* Preview */}
        <div className="min-w-0 space-y-4">
          <div>
            <div className="flex items-start gap-2">
              <h3 className="min-w-0 flex-1 text-sm font-semibold text-ink">{selected.name}</h3>
              {cloudIds.has(selected.id) && (
                confirmDeleteId === selected.id ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="text-[11px] text-danger">Delete from your account?</span>
                    <Button variant="danger" size="sm" disabled={deletingId === selected.id} onClick={() => void removeCloud(selected.id)}>
                      {deletingId === selected.id ? 'Deleting…' : 'Delete'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)}>Keep</Button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(selected.id)}
                    aria-label="Delete this template from your account"
                    title="Delete from your account"
                    className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-dim transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )
              )}
            </div>
            {selected.description && <p className="mt-1 text-xs text-ink-dim">{selected.description}</p>}
            {selected.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selected.tags.map((tag) => (
                  <span key={tag} className="rounded-full border border-line bg-surface-3 px-2.5 py-0.5 text-[10px] text-ink-dim">{tag}</span>
                ))}
              </div>
            )}
          </div>

          <ol className="space-y-1.5">
            {selected.tracks.map((t, i) => {
              const role: TrackRole = t.role;
              return (
                <li key={i} className="flex items-start gap-2.5 rounded-control border border-line bg-surface-2 px-3 py-2">
                  <span className="font-num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[10px] font-semibold text-ink-dim">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {ROLE_ICON[role]}
                      <span className="truncate text-xs font-semibold text-ink">{t.name}</span>
                      <span className="shrink-0 text-[10px] text-ink-faint">{ROLE_LABEL[role]}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-dim">
                      {t.plugins && t.plugins.length > 0 && (
                        <span className="flex items-center gap-1">
                          <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                          {t.plugins.length} {t.plugins.length === 1 ? 'plugin' : 'plugins'}
                        </span>
                      )}
                      {t.ducking && t.ducking.enabled && (
                        <span className="flex items-center gap-1">
                          <ArrowDownToLine className="h-3 w-3" aria-hidden="true" />
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
            <p className="text-[11px] text-ink-dim">Master bus: {selected.masterPlugins.length} {selected.masterPlugins.length === 1 ? 'plugin' : 'plugins'}</p>
          )}
          <p className="text-[11px] text-ink-faint">Tracks start empty. Record, import or generate audio into them.</p>
        </div>
      </div>

      {hasWork && (
        <p className="mt-5 flex gap-1.5 rounded-control border border-warn/30 bg-warn/10 px-3 py-2 text-[11px] text-warn">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          This replaces the open project{projectName ? ` "${projectName}"` : ''}. Save it first if you want to keep it.
        </p>
      )}
    </ModalShell>
  );
};
