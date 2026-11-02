/**
 * X-PRO AUDIO - Main Header Bar
 * Transport (Play, Pause, Stop), Timecode display, Edit Menu, Zoom, Settings, and Import Audio.
 */

import React, { useRef, useState, useEffect } from 'react';
import {
  Play,
  Pause,
  Square,
  Upload,
  Settings,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronDown,
  RotateCcw,
  Scissors,
  Copy,
  Trash2,
  Check,
  RefreshCw,
  Sliders,
  AudioWaveform,
  Mic,
  Music,
  Download,
  SkipBack,
  SkipForward,
  Rewind,
  FastForward,
  FolderArchive,
  FolderOpen,
  FilePlus,
  Save,
  Edit3,
  UploadCloud,
  Sparkles,
  ExternalLink,
  LayoutTemplate,
} from 'lucide-react';
import { Project } from '../types';
import { ModalShell } from './ui';
import { audioEngine } from '../audio/engine';
import { formatTimecode } from '../utils/formatters';

type RecentProjectEntry = {
  id: string;
  name: string;
  lastOpenedAt: number;
  trackCount: number;
};

const RECENT_PROJECTS_STORAGE_KEY = 'uuda_recent_projects_v1';
const MAX_RECENT_PROJECTS = 5;

function readRecentProjects(): RecentProjectEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_PROJECTS_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is RecentProjectEntry =>
      !!entry &&
      typeof entry.id === 'string' &&
      typeof entry.name === 'string' &&
      typeof entry.lastOpenedAt === 'number' &&
      typeof entry.trackCount === 'number'
    ).slice(0, MAX_RECENT_PROJECTS);
  } catch {
    return [];
  }
}

/** How far the back and forward buttons jump */
const SKIP_STEPS: { seconds: number; label: string }[] = [
  { seconds: 10, label: '10 sec' },
  { seconds: 30, label: '30 sec' },
  { seconds: 60, label: '1 min' },
  { seconds: 120, label: '2 min' },
  { seconds: 300, label: '5 min' },
  { seconds: 600, label: '10 min' },
];
const readSkipStep = (): number => {
  try {
    const v = Number(localStorage.getItem('uuda_skip_step'));
    return SKIP_STEPS.some((s) => s.seconds === v) ? v : 10;
  } catch {
    return 10;
  }
};

// Header pill buttons (design tokens). Layout is shared; colours are idle (neutral) or on (cyan = switched on).
const PILL_LAYOUT = 'inline-flex h-8 shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold tracking-tight transition-colors duration-150 ease-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60';
const PILL_IDLE = 'border-line bg-surface-1 text-ink-dim hover:bg-surface-3 hover:text-ink';
const PILL_ON = 'border-accent/40 bg-accent-soft text-accent';

interface HeaderProps {
  project: Project;
  isPlaying: boolean;
  playheadSeconds?: number;
  pixelsPerSecond?: number;
  canUndo: boolean;
  canRedo: boolean;
  onOpenExport: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onReturnToStart?: () => void;
  /** Jump the playhead by this many seconds (negative = backward) */
  onSkip?: (deltaSeconds: number) => void;
  /** Send the playhead to the end of the audio */
  onGoToEnd?: () => void;
  onNewProject?: () => void;
  onSaveAndNewProject?: () => void;
  onOpenNewProjectInTab?: () => void;
  onOpenProjectFromFile?: (file: File) => void;
  onSaveProjectToFile?: () => void;
  onNewFromTemplate?: () => void;
  onSaveAsTemplate?: () => void;
  onSaveProjectAs?: () => void;
  onChooseProjectRoot?: () => void;
  onOpenProjectFromRoot?: () => void;
  projectRootDirectoryName?: string | null;
  onOpenRecord: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomFit?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  canPaste: boolean;
  hasSelectedClip: boolean;
  /** One or more clips selected (Cut and Copy work on several at once) */
  hasClipSelection?: boolean;
  onToggleMuteClip: () => void;
  onMoveClip: (dir: 'up' | 'down') => void;
  onOpenDsp: (type: import('./DspModals').DspModalType) => void;
  onOpenEffect?: (type: import('../types').EffectType) => void;
  /** Rename the project (the title sits at the top of the header; double-click it) */
  onRenameProject?: (name: string) => void;
  onDeleteSelected: () => void;
  onSelectAll: () => void;
  onImportFiles: (files: FileList) => void;
  onToggleAutoRefresh: () => void;
  onToggleDucking: () => void;
  onUpdateDuckingDb: (db: number) => void;
  onManualRefresh: () => void;
  onClearSession: () => void;
  onOpenPlugins?: () => void;
  onOpenVoiceoverModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  project,
  isPlaying,
  playheadSeconds,
  pixelsPerSecond,
  canUndo,
  canRedo,
  onOpenExport,
  onPlay,
  onPause,
  onStop,
  onReturnToStart,
  onSkip,
  onGoToEnd,
  onNewProject,
  onSaveAndNewProject,
  onOpenNewProjectInTab,
  onOpenProjectFromFile,
  onSaveProjectToFile,
  onNewFromTemplate,
  onSaveAsTemplate,
  onSaveProjectAs,
  onChooseProjectRoot,
  onOpenProjectFromRoot,
  projectRootDirectoryName,
  onOpenRecord,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onUndo,
  onRedo,
  onSplit,
  onDuplicate,
  onCopy,
  onCut,
  onPaste,
  canPaste,
  hasSelectedClip,
  hasClipSelection,
  onToggleMuteClip,
  onMoveClip,
  onOpenDsp,
  onOpenEffect,
  onRenameProject,
  onDeleteSelected,
  onSelectAll,
  onImportFiles,
  onToggleAutoRefresh,
  onToggleDucking,
  onUpdateDuckingDb,
  onManualRefresh,
  onClearSession,
  onOpenPlugins,
  onOpenVoiceoverModal,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const projectFileInputRef = useRef<HTMLInputElement | null>(null);

  const [skipStep, setSkipStep] = useState<number>(readSkipStep);
  const [isEditMenuOpen, setIsEditMenuOpen] = useState(false);
  const [isEffectsMenuOpen, setIsEffectsMenuOpen] = useState(false);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    const openSettings = () => setIsSettingsOpen(true);
    window.addEventListener('uuda:open-settings', openSettings);
    return () => {
      window.removeEventListener('uuda:open-settings', openSettings);
    };
  }, []);
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>(() => readRecentProjects());

  // Keep a small local index only; project/audio data remains in the existing save systems.
  useEffect(() => {
    if (!project.id || !project.name.trim()) return;

    const nextEntry: RecentProjectEntry = {
      id: project.id,
      name: project.name.trim(),
      lastOpenedAt: Date.now(),
      trackCount: project.tracks.length,
    };
    const next = [
      nextEntry,
      ...readRecentProjects().filter((entry) => entry.id !== nextEntry.id),
    ].slice(0, MAX_RECENT_PROJECTS);

    try {
      localStorage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Recent-project tracking is optional and must never block editing or autosave.
    }
    setRecentProjects(next);
  }, [project.id, project.name, project.tracks.length]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onImportFiles(e.target.files);
      e.target.value = '';
    }
  };

  useEffect(() => {
    const openProjectPicker = () => projectFileInputRef.current?.click();
    window.addEventListener('uuda:open-project-picker', openProjectPicker);
    return () => window.removeEventListener('uuda:open-project-picker', openProjectPicker);
  }, []);

  const handleProjectFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (onOpenProjectFromFile) {
        onOpenProjectFromFile(file);
      }
      e.target.value = '';
    }
  };

  return (
    <header className="h-14 bg-surface-0 border-b border-line px-4 flex items-center justify-between gap-4 select-none shrink-0 z-40">
      {/* Hidden File Input for Import Audio */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4,audio/x-m4a"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Hidden File Input for Open Project from Computer */}
      <input
        ref={projectFileInputRef}
        type="file"
        accept=".uuda,.json,.uuda.json"
        onChange={handleProjectFileChange}
        className="hidden"
      />

      {/* Brand, File Menu, and Project Name */}
      <div className="flex items-center gap-3 min-w-0 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-control bg-gold-soft text-gold flex items-center justify-center">
            <AudioWaveform className="w-4 h-4 stroke-[2.5]" />
          </div>
          <span className="font-bold tracking-tight text-sm text-ink flex items-center gap-1.5">
            UUDA <span className="text-gold font-semibold text-xs tracking-[0.18em]">STUDIO</span>
          </span>
        </div>

        <div className="h-4 w-px bg-line" />

        {/* File Menu Dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setIsProjectMenuOpen(!isProjectMenuOpen);
              setIsEditMenuOpen(false);
            }}
            title="File Menu: Open, Save, Import, and Export"
            className={`${PILL_LAYOUT} ${PILL_IDLE}`}
          >
            <FolderArchive className="w-3.5 h-3.5" />
            <span>File</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {isProjectMenuOpen && (
            <div
              onClick={() => setIsProjectMenuOpen(false)}
              className="left-0 absolute top-full mt-1.5 w-64 max-h-[calc(100dvh-4.5rem)] overflow-y-auto overscroll-contain [scrollbar-width:thin] bg-surface-2 border border-line-strong rounded-card shadow-float z-50 text-xs text-ink-dim uuda-pop-in py-1.5"
            >
              <button
                onClick={onNewProject}
                className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <FilePlus className="w-4 h-4 text-ink-dim" />
                <div>
                  <div className="font-medium">New Project...</div>
                </div>
              </button>

              {onNewFromTemplate && (
                <button
                  onClick={onNewFromTemplate}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <LayoutTemplate className="w-4 h-4 text-ink-dim" />
                  <div>
                    <div className="font-medium">New from Template...</div>
                  </div>
                </button>
              )}

              {onSaveAndNewProject && (
                <button
                  onClick={onSaveAndNewProject}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Save className="w-4 h-4 text-ink-dim" />
                  <div>
                    <div className="font-medium">Save & Start New</div>
                  </div>
                </button>
              )}

              {onOpenNewProjectInTab && (
                <button
                  onClick={onOpenNewProjectInTab}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4 text-ink-dim" />
                  <div>
                    <div className="font-medium">New Project in New Tab</div>
                  </div>
                </button>
              )}

              <button
                onClick={() => projectFileInputRef.current?.click()}
                className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <FolderOpen className="w-4 h-4 text-ink-dim" />
                <div>
                  <div className="font-medium">Open Project from Computer...</div>
                </div>
              </button>

              {onChooseProjectRoot && (
                <button
                  onClick={onChooseProjectRoot}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <FolderArchive className="w-4 h-4 text-ink-dim" />
                  <div>
                    <div className="font-medium">Choose Root Folder...</div>
                  </div>
                </button>
              )}

              {onOpenProjectFromRoot && (
                <button
                  onClick={onOpenProjectFromRoot}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4 text-ink-dim" />
                  <div>
                    <div className="font-medium">Open from Root Folder...</div>
                  </div>
                </button>
              )}

              <div className="h-px bg-line my-1" />
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-ink-faint font-semibold">
                Recent Projects
              </div>
              {recentProjects.length > 0 ? recentProjects.map((recent) => (
                <button
                  key={recent.id}
                  onClick={() => projectFileInputRef.current?.click()}
                  title={`Choose the saved .uuda file for “${recent.name}”`}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4 text-ink-dim shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{recent.name}</div>
                    <div className="text-[10px] text-zinc-500">
                      {recent.trackCount} {recent.trackCount === 1 ? 'track' : 'tracks'} · {new Date(recent.lastOpenedAt).toLocaleDateString()}
                    </div>
                  </div>
                </button>
              )) : (
                <div className="px-3 py-2 text-[10px] text-zinc-500">Projects you open will appear here.</div>
              )}
              <div className="px-3 pb-1 text-[10px] text-zinc-600">
                Recent names are stored locally; choose a saved .uuda file to reopen a project.
              </div>

              {onSaveAsTemplate && (
                <button
                  onClick={onSaveAsTemplate}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <LayoutTemplate className="w-4 h-4 text-ink-dim" />
                  <div>
                    <div className="font-medium">Save as Template...</div>
                  </div>
                </button>
              )}

              <button
                onClick={onSaveProjectToFile}
                className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <Save className="w-4 h-4 text-ink-dim" />
                <div>
                  <div className="font-medium">Save Project to Computer</div>
                </div>
              </button>

              {onSaveProjectAs && (
                <button
                  onClick={onSaveProjectAs}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Save className="w-4 h-4 text-ink-dim" />
                  <div>
                    <div className="font-medium">Save As...</div>
                  </div>
                </button>
              )}

              <div className="h-px bg-line my-1" />

              <button
                onClick={() => window.dispatchEvent(new CustomEvent('uuda:rename-project'))}
                className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <Edit3 className="w-4 h-4 text-ink-dim" />
                <div>
                  <div className="font-medium">Rename Project</div>
                </div>
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <UploadCloud className="w-4 h-4 text-ink-dim" />
                <div>
                  <div className="font-medium">Import Audio Files...</div>
                </div>
              </button>

              <div className="h-px bg-line my-1" />

              <button
                onClick={() => {
                  setIsProjectMenuOpen(false);
                  setIsSettingsOpen(true);
                }}
                className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <Settings className="w-4 h-4 text-ink-dim" />
                <div className="font-medium">Studio Settings...</div>
              </button>

              <div className="h-px bg-line my-1" />

              <button
                onClick={() => {
                  setIsProjectMenuOpen(false);
                  onClearSession();
                }}
                className="w-full text-left px-3 py-2 hover:bg-rose-500/20 hover:text-rose-300 flex items-center gap-2.5 text-rose-400 transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4 text-rose-400" />
                <div>
                  <div className="font-medium">Clear Session / Reset</div>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Edit Menu Dropdown */}
        <div className="relative">
          <button
            onClick={() => setIsEditMenuOpen(!isEditMenuOpen)}
            className={`${PILL_LAYOUT} ${PILL_IDLE}`}
          >
            <span>Edit</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {isEditMenuOpen && (
            <div
              onClick={() => setIsEditMenuOpen(false)}
              className="left-0 absolute top-full mt-1.5 w-64 max-h-[calc(100dvh-4.5rem)] overflow-y-auto overscroll-contain [scrollbar-width:thin] bg-surface-2 border border-line-strong rounded-card shadow-float z-50 text-xs text-ink-dim uuda-pop-in py-1.5"
            >
              <button
                disabled={!canUndo}
                onClick={onUndo}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 hover:text-ink disabled:opacity-40 flex items-center justify-between"
              >
                <span>Undo</span>
                <span className="font-num text-[10px] text-ink-faint">Ctrl+Z</span>
              </button>
              <button
                disabled={!canRedo}
                onClick={onRedo}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 hover:text-ink disabled:opacity-40 flex items-center justify-between"
              >
                <span>Redo</span>
                <span className="font-num text-[10px] text-ink-faint">Ctrl+Y</span>
              </button>

              <div className="h-px bg-line my-1" />

              <button
                disabled={!hasSelectedClip}
                onClick={onSplit}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 hover:text-ink disabled:opacity-40 flex items-center justify-between"
              >
                <span>Split at Playhead</span>
                <span className="font-num text-[10px] text-ink-faint">S</span>
              </button>
              <button
                disabled={!(hasClipSelection ?? hasSelectedClip)}
                onClick={onCut}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 hover:text-ink disabled:opacity-40 flex items-center justify-between"
              >
                <span>Cut</span>
                <span className="font-num text-[10px] text-ink-faint">Ctrl+X</span>
              </button>
              <button
                disabled={!(hasClipSelection ?? hasSelectedClip)}
                onClick={onCopy}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 hover:text-ink disabled:opacity-40 flex items-center justify-between"
              >
                <span>Copy</span>
                <span className="font-num text-[10px] text-ink-faint">Ctrl+C</span>
              </button>
              <button
                disabled={!canPaste}
                onClick={onPaste}
                title="Paste clip at playhead onto active/selected track (Ctrl+V)"
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 hover:text-ink disabled:opacity-40 flex items-center justify-between"
              >
                <span>Paste at Playhead</span>
                <span className="font-num text-[10px] text-ink-faint">Ctrl+V</span>
              </button>
              <button
                disabled={!hasSelectedClip}
                onClick={onDuplicate}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 hover:text-ink disabled:opacity-40 flex items-center justify-between"
              >
                <span>Duplicate Clip</span>
                <span className="font-num text-[10px] text-ink-faint">Ctrl+D</span>
              </button>
              <button
                disabled={!hasSelectedClip}
                onClick={onDeleteSelected}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 hover:text-ink disabled:opacity-40 text-rose-300 flex items-center justify-between"
              >
                <span>Delete Selected</span>
                <span className="font-num text-[10px] text-ink-faint">Del</span>
              </button>

              <div className="h-px bg-line my-1" />

              <button
                disabled={!hasSelectedClip}
                onClick={onToggleMuteClip}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 hover:text-ink disabled:opacity-40 flex items-center justify-between"
              >
                <span>Mute / Unmute Clip</span>
                <span className="font-num text-[10px] text-ink-faint">M</span>
              </button>
              <button
                disabled={!hasSelectedClip}
                onClick={() => onMoveClip('up')}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 hover:text-ink disabled:opacity-40 flex items-center justify-between"
              >
                <span>Move Clip Up</span>
                <span className="font-num text-[10px] text-ink-faint">&uarr;</span>
              </button>
              <button
                disabled={!hasSelectedClip}
                onClick={() => onMoveClip('down')}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 hover:text-ink disabled:opacity-40 flex items-center justify-between"
              >
                <span>Move Clip Down</span>
                <span className="font-num text-[10px] text-ink-faint">&darr;</span>
              </button>

              <div className="h-px bg-line my-1" />

              {/* DSP Processing tools */}
              <button
                disabled={!hasSelectedClip}
                onClick={() => onOpenDsp('amplify')}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 hover:text-ink disabled:opacity-40 flex items-center justify-between"
              >
                <span>Amplify Gain...</span>
              </button>
              <button
                disabled={!hasSelectedClip}
                onClick={() => onOpenDsp('compress')}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 hover:text-ink disabled:opacity-40 flex items-center justify-between"
              >
                <span>Dynamics Compressor...</span>
              </button>
              <button
                disabled={!hasSelectedClip}
                onClick={() => onOpenDsp('denoise')}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 hover:text-ink disabled:opacity-40 flex items-center justify-between text-amber-300"
              >
                <span>Basic Noise Reduction...</span>
              </button>
              <button
                disabled={!hasSelectedClip}
                onClick={() => onOpenDsp('pitch')}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 hover:text-ink disabled:opacity-40 flex items-center justify-between"
              >
                <span>Change Pitch (WSOLA)...</span>
              </button>
              <button
                disabled={!hasSelectedClip}
                onClick={() => onOpenDsp('speed')}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 hover:text-ink disabled:opacity-40 flex items-center justify-between"
              >
                <span>Change Speed (WSOLA)...</span>
              </button>

              <div className="h-px bg-line my-1" />

              <button
                onClick={onSelectAll}
                className="w-full text-left px-3 py-1.5 hover:bg-white/5 hover:text-ink flex items-center justify-between"
              >
                <span>Select All</span>
                <span className="font-num text-[10px] text-ink-faint">Ctrl+A</span>
              </button>
            </div>
          )}
        </div>

        {/* Effects Menu Dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setIsEffectsMenuOpen(!isEffectsMenuOpen);
              setIsProjectMenuOpen(false);
              setIsEditMenuOpen(false);
            }}
            title="Audio Effects Suite (Delay, EQ, Chorus, Flanger, Phaser, Reverb)"
            className={`${PILL_LAYOUT} ${PILL_IDLE}`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Effects</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {isEffectsMenuOpen && (
            <div
              onClick={() => setIsEffectsMenuOpen(false)}
              className="left-0 absolute top-full mt-1.5 w-64 max-h-[calc(100dvh-4.5rem)] overflow-y-auto overscroll-contain [scrollbar-width:thin] bg-surface-2 border border-line-strong rounded-card shadow-float z-50 text-xs text-ink-dim uuda-pop-in py-1.5"
            >
              <div className="px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint border-b border-line mb-1">
                Effects
              </div>
              <button
                onClick={() => onOpenEffect?.('delay')}
                className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="font-medium text-ink">Delay & Echo...</div>
                </div>
              </button>
              <button
                onClick={() => onOpenEffect?.('equalizer')}
                className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="font-medium text-ink">Equalize (5-Band EQ)...</div>
                </div>
              </button>
              <button
                onClick={() => onOpenEffect?.('chorus')}
                className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="font-medium text-ink">Chorus...</div>
                </div>
              </button>
              <button
                onClick={() => onOpenEffect?.('flanger')}
                className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="font-medium text-ink">Flanger...</div>
                </div>
              </button>
              <button
                onClick={() => onOpenEffect?.('phaser')}
                className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="font-medium text-ink">Phaser...</div>
                </div>
              </button>
              <button
                onClick={() => onOpenEffect?.('reverb')}
                className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="font-medium text-ink">Reverb...</div>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Central Transport & Timecode Controls */}
      <div className="flex items-center gap-3">
        {/* Transport: one capsule (back, play or pause, stop), then Record as its own pill */}
        <div role="group" aria-label="Transport" className="flex items-stretch divide-x divide-line overflow-hidden rounded-full border border-line bg-surface-1">
          {/* Return to Start / Rewind to Head Button */}
          <button
            onClick={onReturnToStart}
            title="Return to Start / Rewind to Head (Home / 0)"
            className="flex h-8 w-9 items-center justify-center transition-colors duration-150 ease-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 cursor-pointer text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            <SkipBack className="w-4 h-4 fill-current" />
          </button>

          <button
            onClick={() => onSkip?.(-skipStep)}
            title={`Back ${SKIP_STEPS.find((s) => s.seconds === skipStep)?.label ?? ''} (change the jump beside the forward button)`}
            className="flex h-8 w-9 items-center justify-center transition-colors duration-150 ease-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 cursor-pointer text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            <Rewind className="w-4 h-4 fill-current" />
          </button>

          {isPlaying ? (
            <button
              onClick={onPause}
              title="Pause (Space)"
              className="flex h-8 w-9 items-center justify-center transition-colors duration-150 ease-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 cursor-pointer bg-accent-soft text-accent hover:brightness-125"
            >
              <Pause className="w-4 h-4 fill-current" />
            </button>
          ) : (
            <button
              onClick={onPlay}
              title="Play (Space)"
              className="flex h-8 w-9 items-center justify-center transition-colors duration-150 ease-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 cursor-pointer text-ink hover:bg-white/5"
            >
              <Play className="w-4 h-4 fill-current ml-0.5" />
            </button>
          )}

          <button
            onClick={() => onSkip?.(skipStep)}
            title={`Forward ${SKIP_STEPS.find((s) => s.seconds === skipStep)?.label ?? ''} (change the jump beside this button)`}
            className="flex h-8 w-9 items-center justify-center transition-colors duration-150 ease-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 cursor-pointer text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            <FastForward className="w-4 h-4 fill-current" />
          </button>
          <button
            onClick={onGoToEnd}
            title="Go to the end of the track (End)"
            className="flex h-8 w-9 items-center justify-center transition-colors duration-150 ease-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 cursor-pointer text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            <SkipForward className="w-4 h-4 fill-current" />
          </button>
          <button
            onClick={onStop}
            title="Stop & Return to Start"
            className="flex h-8 w-9 items-center justify-center transition-colors duration-150 ease-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 cursor-pointer text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>
        </div>

        {/* How far Back and Forward jump */}
        <select
          value={skipStep}
          onChange={(e) => {
            const v = Number(e.target.value);
            setSkipStep(v);
            try { localStorage.setItem('uuda_skip_step', String(v)); } catch { /* not saved */ }
          }}
          title="How far the Back and Forward buttons jump"
          aria-label="Jump length"
          className="h-8 shrink-0 cursor-pointer rounded-full border border-line bg-surface-1 px-2 text-xs font-semibold text-ink-dim hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {SKIP_STEPS.map((s) => (
            <option key={s.seconds} value={s.seconds}>{s.label}</option>
          ))}
        </select>

        {/* RECORD Button */}
        <button
          onClick={onOpenRecord}
          title="Open Recording Studio with 4-Band Input EQ (R)"
          className={`${PILL_LAYOUT} ${PILL_IDLE} hover:border-danger/50`}
        >
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-danger" />
          <span>Record</span>
        </button>
      </div>

      {/* Right Controls: Auto-refresh, Voiceover, Sound Library, Export, Settings */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Manual Refresh button (shown when auto-refresh is off or requested) */}
        {!project.settings.autoRefresh && (
          <button
            onClick={onManualRefresh}
            title="Manual Repaint / Refresh"
            className={`${PILL_LAYOUT} border-warn/40 bg-warn/10 text-warn hover:bg-warn/20`}
          >
            <RefreshCw className="w-3 h-3" />
            <span>Refresh</span>
          </button>
        )}

        {/* Voiceover Studio Button */}
        <button
          onClick={() => {
            window.dispatchEvent(new CustomEvent('xpro:close-popups'));
            if (onOpenVoiceoverModal) {
              onOpenVoiceoverModal();
            } else {
              window.dispatchEvent(new CustomEvent('uuda:open-voiceover-modal'));
            }
          }}
          title="Open Expanded Voiceover Studio Workspace (Gemini TTS)"
          className={`${PILL_LAYOUT} ${PILL_IDLE}`}
        >
          <Mic className="w-3.5 h-3.5" />
          <span>Voiceover</span>
        </button>

        {/* Sound Library Button: opens the Freesound search and preview window directly */}
        <button
          onClick={() => {
            window.dispatchEvent(new CustomEvent('xpro:close-popups'));
            window.dispatchEvent(new CustomEvent('uuda:open-library-modal'));
          }}
          title="Search and preview sounds from Freesound (CC0)"
          className={`${PILL_LAYOUT} ${PILL_IDLE}`}
        >
          <Music className="w-3.5 h-3.5" />
          <span>Sound Library</span>
        </button>

        {/* Modular Audio Plugins Button */}
        <button
          onClick={() => {
            window.dispatchEvent(new CustomEvent('xpro:close-popups'));
            if (onOpenPlugins) {
              onOpenPlugins();
            } else {
              window.dispatchEvent(new CustomEvent('uuda:open-plugins-modal'));
            }
          }}
          title="Open Modular Audio Plugins & Effects Rack (WAM 2.0 & Native Stems)"
          className={`${PILL_LAYOUT} ${PILL_IDLE}`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Plugins</span>
        </button>

        {/* Master & Export Production Button */}
        <button
          onClick={onOpenExport}
          title="Master & Export Production (WAV / MP3 at LUFS target)"
          className="inline-flex h-8 shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-full bg-gold px-4 text-xs font-bold tracking-tight text-gold-ink transition-[filter] duration-150 hover:brightness-110 active:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export</span>
        </button>

        <ModalShell open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} title="Studio Settings" size="sm">
          <div className="text-xs text-ink-dim">
              {/* Auto Refresh Setting */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-ink">Auto-Refresh</div>
                    <div className="text-[11px] text-ink-faint">Repaint the timeline as soon as you edit</div>
                  </div>
                  <button
                    onClick={() => {
                      onToggleAutoRefresh();
                    }}
                    className={`w-9 h-5 rounded-full p-0.5 transition-colors ${
                      project.settings.autoRefresh ? 'bg-accent' : 'bg-surface-3'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-white transition-transform ${
                        project.settings.autoRefresh ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Auto Ducking Setting */}
                <div className="flex items-center justify-between pt-2 border-t border-line">
                  <div>
                    <div className="font-medium text-ink">Duck Playing Tracks</div>
                    <div className="text-[11px] text-ink-faint">Lower other tracks while another plays</div>
                  </div>
                  <button
                    onClick={() => {
                      onToggleDucking();
                    }}
                    className={`w-9 h-5 rounded-full p-0.5 transition-colors ${
                      project.settings.duckPlayingTracks ? 'bg-accent' : 'bg-surface-3'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-white transition-transform ${
                        project.settings.duckPlayingTracks ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {project.settings.duckPlayingTracks && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-ink-dim">
                      <span>Ducking Gain</span>
                      <span className="font-num text-accent font-semibold">{project.settings.duckingAmountDb} dB</span>
                    </div>
                    <input
                      type="range"
                      min="-24"
                      max="-3"
                      step="1"
                      value={project.settings.duckingAmountDb}
                      onChange={(e) => onUpdateDuckingDb(parseInt(e.target.value, 10))}
                      className="w-full h-1 bg-surface-3 rounded appearance-none cursor-pointer"
                    />
                  </div>
                )}

                <div className="pt-2 border-t border-line space-y-1 text-[11px]">
                  <div className="flex justify-between text-ink-dim">
                    <span>Sample Rate:</span>
                    <span className="font-num text-ink">{audioEngine.getSampleRate()} Hz</span>
                  </div>
                  <div className="flex justify-between text-ink-dim">
                    <span>Latency Hint:</span>
                    <span className="font-num text-ink">interactive</span>
                  </div>
                  <div className="flex justify-between text-ink-dim">
                    <span>IndexedDB Autosave:</span>
                    <span className="text-ok flex items-center gap-0.5">
                      <Check className="w-3 h-3" /> Active
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-line">
                  <button
                    onClick={() => {
                      setIsSettingsOpen(false);
                      onClearSession();
                    }}
                    className="w-full text-center py-1.5 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-medium border border-rose-500/30 transition-colors"
                  >
                    Clear Session & Reset
                  </button>
                </div>
              </div>
          </div>
        </ModalShell>
      </div>
    </header>
  );
};
