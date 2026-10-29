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
  activeSidebarTab?: 'tracks' | 'voice' | 'library';
  onSelectSidebarTab?: (tab: 'tracks' | 'voice' | 'library') => void;
  onOpenExport: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onReturnToStart?: () => void;
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
  onToggleMuteClip: () => void;
  onMoveClip: (dir: 'up' | 'down') => void;
  onOpenDsp: (type: import('./DspModals').DspModalType) => void;
  onOpenEffect?: (type: import('../types').EffectType) => void;
  onDeleteSelected: () => void;
  onSelectAll: () => void;
  onImportFiles: (files: FileList) => void;
  onUpdateProjectName: (name: string) => void;
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
  activeSidebarTab,
  onSelectSidebarTab,
  onOpenExport,
  onPlay,
  onPause,
  onStop,
  onReturnToStart,
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
  onToggleMuteClip,
  onMoveClip,
  onOpenDsp,
  onOpenEffect,
  onDeleteSelected,
  onSelectAll,
  onImportFiles,
  onUpdateProjectName,
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

  const [isEditingName, setIsEditingName] = useState(false);
  const [projectName, setProjectName] = useState(project.name);
  const [isEditMenuOpen, setIsEditMenuOpen] = useState(false);
  const [isEffectsMenuOpen, setIsEffectsMenuOpen] = useState(false);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>(() => readRecentProjects());

  useEffect(() => {
    setProjectName(project.name);
  }, [project.name]);

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

  const handleNameSubmit = () => {
    setIsEditingName(false);
    const trimmed = projectName.trim();
    if (trimmed && trimmed !== project.name) {
      onUpdateProjectName(trimmed);
    } else {
      setProjectName(project.name);
    }
  };

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
              className="absolute left-0 top-full mt-1.5 w-64 max-h-[calc(100dvh-4.5rem)] overflow-y-auto overscroll-contain [scrollbar-width:thin] [scrollbar-color:rgba(113,113,122,0.65)_transparent] bg-surface-2 border border-line-strong rounded-card shadow-float py-1.5 z-50 text-xs text-zinc-200 animate-in fade-in duration-100"
            >
              <button
                onClick={onNewProject}
                className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <FilePlus className="w-4 h-4 text-cyan-400" />
                <div>
                  <div className="font-semibold">New Project...</div>
                  <div className="text-[10px] text-zinc-500">Create clean session (prompts to preserve work)</div>
                </div>
              </button>

              {onNewFromTemplate && (
                <button
                  onClick={onNewFromTemplate}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <LayoutTemplate className="w-4 h-4 text-purple-400" />
                  <div>
                    <div className="font-semibold">New from Template...</div>
                    <div className="text-[10px] text-zinc-500">Podcast, spot, sweep or your own</div>
                  </div>
                </button>
              )}

              {onSaveAndNewProject && (
                <button
                  onClick={onSaveAndNewProject}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Save className="w-4 h-4 text-cyan-400" />
                  <div>
                    <div className="font-semibold">Save & Start New</div>
                    <div className="text-[10px] text-zinc-500">Backup current session and open blank workspace</div>
                  </div>
                </button>
              )}

              {onOpenNewProjectInTab && (
                <button
                  onClick={onOpenNewProjectInTab}
                  className="w-full text-left px-3 py-2 hover:bg-emerald-500/20 hover:text-emerald-300 flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4 text-emerald-400" />
                  <div>
                    <div className="font-semibold">New Project in New Tab</div>
                    <div className="text-[10px] text-zinc-500">Keep current session and open new tab</div>
                  </div>
                </button>
              )}

              <button
                onClick={() => projectFileInputRef.current?.click()}
                className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <FolderOpen className="w-4 h-4 text-emerald-400" />
                <div>
                  <div className="font-semibold">Open Project from Computer...</div>
                  <div className="text-[10px] text-zinc-500">Load a self-contained .uuda project or legacy .json file</div>
                </div>
              </button>

              {onChooseProjectRoot && (
                <button
                  onClick={onChooseProjectRoot}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <FolderArchive className="w-4 h-4 text-amber-400" />
                  <div>
                    <div className="font-semibold">Choose Root Folder...</div>
                    <div className="text-[10px] text-zinc-500">{projectRootDirectoryName ? `Current: ${projectRootDirectoryName}` : 'Choose a folder for project files'}</div>
                  </div>
                </button>
              )}

              {onOpenProjectFromRoot && (
                <button
                  onClick={onOpenProjectFromRoot}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4 text-amber-400" />
                  <div>
                    <div className="font-semibold">Open from Root Folder...</div>
                    <div className="text-[10px] text-zinc-500">Browse .uuda files in the selected folder</div>
                  </div>
                </button>
              )}

              <div className="h-px bg-zinc-800 my-1" />
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                Recent Projects
              </div>
              {recentProjects.length > 0 ? recentProjects.map((recent) => (
                <button
                  key={recent.id}
                  onClick={() => projectFileInputRef.current?.click()}
                  title={`Choose the saved .uuda file for “${recent.name}”`}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4 text-zinc-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{recent.name}</div>
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
                  <LayoutTemplate className="w-4 h-4 text-purple-400" />
                  <div>
                    <div className="font-semibold">Save as Template...</div>
                    <div className="text-[10px] text-zinc-500">Keep tracks, effects and ducking, no audio</div>
                  </div>
                </button>
              )}

              <button
                onClick={onSaveProjectToFile}
                className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <Save className="w-4 h-4 text-indigo-400" />
                <div>
                  <div className="font-semibold">Save Project to Computer</div>
                  <div className="text-[10px] text-zinc-500">Save project and referenced audio as .uuda</div>
                </div>
              </button>

              {onSaveProjectAs && (
                <button
                  onClick={onSaveProjectAs}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Save className="w-4 h-4 text-indigo-400" />
                  <div>
                    <div className="font-semibold">Save As...</div>
                    <div className="text-[10px] text-zinc-500">Choose a .uuda destination</div>
                  </div>
                </button>
              )}

              <div className="h-px bg-zinc-800 my-1" />

              <button
                onClick={() => setIsEditingName(true)}
                className="w-full text-left px-3 py-2 hover:bg-zinc-800 flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <Edit3 className="w-4 h-4 text-zinc-400" />
                <div>
                  <div className="font-semibold">Rename Project</div>
                  <div className="text-[10px] text-zinc-500">Change title of current session</div>
                </div>
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full text-left px-3 py-2 hover:bg-zinc-800 flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <UploadCloud className="w-4 h-4 text-amber-400" />
                <div>
                  <div className="font-semibold">Import Audio Files...</div>
                  <div className="text-[10px] text-zinc-500">Add .wav, .mp3, .m4a to timeline</div>
                </div>
              </button>

              <div className="h-px bg-zinc-800 my-1" />

              <button
                onClick={() => {
                  setIsProjectMenuOpen(false);
                  onClearSession();
                }}
                className="w-full text-left px-3 py-2 hover:bg-rose-500/20 hover:text-rose-300 flex items-center gap-2.5 text-rose-400 transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4 text-rose-400" />
                <div>
                  <div className="font-semibold">Clear Session / Reset</div>
                  <div className="text-[10px] text-rose-500/80">Wipe current project and reset timeline</div>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Editable Project Name */}
        {isEditingName ? (
          <input
            type="text"
            value={projectName}
            autoFocus
            onChange={(e) => setProjectName(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNameSubmit();
              if (e.key === 'Escape') {
                setProjectName(project.name);
                setIsEditingName(false);
              }
            }}
            className="h-8 w-52 rounded-control border border-accent/60 bg-surface-3 px-3 text-sm font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          />
        ) : (
          <span
            onDoubleClick={() => setIsEditingName(true)}
            title="Double-click to rename project"
            className="text-sm text-ink font-medium truncate max-w-[200px] cursor-text hover:text-accent transition-colors"
          >
            {project.name}
          </span>
        )}

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
              className="absolute left-0 top-full mt-1 w-60 bg-surface-2 border border-line-strong rounded-card shadow-float py-1 z-50 text-xs text-zinc-300"
            >
              <button
                disabled={!canUndo}
                onClick={onUndo}
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-40 flex items-center justify-between"
              >
                <span>Undo</span>
                <span className="font-mono text-[10px] text-zinc-500">Ctrl+Z</span>
              </button>
              <button
                disabled={!canRedo}
                onClick={onRedo}
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-40 flex items-center justify-between"
              >
                <span>Redo</span>
                <span className="font-mono text-[10px] text-zinc-500">Ctrl+Y</span>
              </button>

              <div className="h-px bg-zinc-800 my-1" />

              <button
                disabled={!hasSelectedClip}
                onClick={onSplit}
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-40 flex items-center justify-between"
              >
                <span>Split at Playhead</span>
                <span className="font-mono text-[10px] text-zinc-500">S</span>
              </button>
              <button
                disabled={!hasSelectedClip}
                onClick={onCut}
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-40 flex items-center justify-between"
              >
                <span>Cut</span>
                <span className="font-mono text-[10px] text-zinc-500">Ctrl+X</span>
              </button>
              <button
                disabled={!hasSelectedClip}
                onClick={onCopy}
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-40 flex items-center justify-between"
              >
                <span>Copy</span>
                <span className="font-mono text-[10px] text-zinc-500">Ctrl+C</span>
              </button>
              <button
                disabled={!canPaste}
                onClick={onPaste}
                title="Paste clip at playhead onto active/selected track (Ctrl+V)"
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-40 flex items-center justify-between"
              >
                <span>Paste at Playhead</span>
                <span className="font-mono text-[10px] text-zinc-500">Ctrl+V</span>
              </button>
              <button
                disabled={!hasSelectedClip}
                onClick={onDuplicate}
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-40 flex items-center justify-between"
              >
                <span>Duplicate Clip</span>
                <span className="font-mono text-[10px] text-zinc-500">Ctrl+D</span>
              </button>
              <button
                disabled={!hasSelectedClip}
                onClick={onDeleteSelected}
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-40 text-rose-300 flex items-center justify-between"
              >
                <span>Delete Selected</span>
                <span className="font-mono text-[10px] text-zinc-500">Del</span>
              </button>

              <div className="h-px bg-zinc-800 my-1" />

              <button
                disabled={!hasSelectedClip}
                onClick={onToggleMuteClip}
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-40 flex items-center justify-between"
              >
                <span>Mute / Unmute Clip</span>
                <span className="font-mono text-[10px] text-zinc-500">M</span>
              </button>
              <button
                disabled={!hasSelectedClip}
                onClick={() => onMoveClip('up')}
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-40 flex items-center justify-between"
              >
                <span>Move Clip Up</span>
                <span className="font-mono text-[10px] text-zinc-500">&uarr;</span>
              </button>
              <button
                disabled={!hasSelectedClip}
                onClick={() => onMoveClip('down')}
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-40 flex items-center justify-between"
              >
                <span>Move Clip Down</span>
                <span className="font-mono text-[10px] text-zinc-500">&darr;</span>
              </button>

              <div className="h-px bg-zinc-800 my-1" />

              {/* DSP Processing tools */}
              <button
                disabled={!hasSelectedClip}
                onClick={() => onOpenDsp('amplify')}
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-40 flex items-center justify-between text-cyan-300"
              >
                <span>Amplify Gain...</span>
              </button>
              <button
                disabled={!hasSelectedClip}
                onClick={() => onOpenDsp('compress')}
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-40 flex items-center justify-between text-cyan-300"
              >
                <span>Dynamics Compressor...</span>
              </button>
              <button
                disabled={!hasSelectedClip}
                onClick={() => onOpenDsp('denoise')}
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-40 flex items-center justify-between text-amber-300"
              >
                <span>Basic Noise Reduction...</span>
              </button>
              <button
                disabled={!hasSelectedClip}
                onClick={() => onOpenDsp('pitch')}
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-40 flex items-center justify-between text-cyan-300"
              >
                <span>Change Pitch (WSOLA)...</span>
              </button>
              <button
                disabled={!hasSelectedClip}
                onClick={() => onOpenDsp('speed')}
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-40 flex items-center justify-between text-cyan-300"
              >
                <span>Change Speed (WSOLA)...</span>
              </button>

              <div className="h-px bg-zinc-800 my-1" />

              <button
                onClick={onSelectAll}
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 flex items-center justify-between"
              >
                <span>Select All</span>
                <span className="font-mono text-[10px] text-zinc-500">Ctrl+A</span>
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
              className="absolute left-0 top-full mt-1.5 w-64 bg-surface-2 border border-line-strong rounded-card shadow-float py-1.5 z-50 text-xs text-zinc-200 animate-in fade-in duration-100"
            >
              <div className="px-3 py-1.5 text-[10px] font-mono text-cyan-400 font-bold uppercase tracking-wider border-b border-zinc-800 flex items-center justify-between">
                <span>Real-Time Audio Effects</span>
                <span className="text-[9px] text-zinc-500">AudioWorklet DSP</span>
              </div>
              <button
                onClick={() => onOpenEffect?.('delay')}
                className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-zinc-100">Delay & Echo...</div>
                  <div className="text-[10px] text-zinc-500">Stereo ping-pong & feedback damping</div>
                </div>
              </button>
              <button
                onClick={() => onOpenEffect?.('equalizer')}
                className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-zinc-100">Equalize (5-Band EQ)...</div>
                  <div className="text-[10px] text-zinc-500">Parametric EQ with frequency graph</div>
                </div>
              </button>
              <button
                onClick={() => onOpenEffect?.('chorus')}
                className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-zinc-100">Chorus...</div>
                  <div className="text-[10px] text-zinc-500">Multi-voice modulated fractional-delay</div>
                </div>
              </button>
              <button
                onClick={() => onOpenEffect?.('flanger')}
                className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-zinc-100">Flanger...</div>
                  <div className="text-[10px] text-zinc-500">Short modulated delay with resonance</div>
                </div>
              </button>
              <button
                onClick={() => onOpenEffect?.('phaser')}
                className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-zinc-100">Phaser...</div>
                  <div className="text-[10px] text-zinc-500">Cascaded all-pass sweep stages</div>
                </div>
              </button>
              <button
                onClick={() => onOpenEffect?.('reverb')}
                className="w-full text-left px-3 py-2 hover:bg-white/5 hover:text-ink flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-zinc-100">Reverb...</div>
                  <div className="text-[10px] text-zinc-500">Plate, Room, Hall algorithmic & convolution</div>
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
            onClick={onStop}
            title="Stop & Return to Start"
            className="flex h-8 w-9 items-center justify-center transition-colors duration-150 ease-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 cursor-pointer text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>
        </div>

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

        {/* Sound Library Button */}
        {onSelectSidebarTab && (
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('xpro:close-popups'));
              onSelectSidebarTab('library');
            }}
            title="Open Sound Library (Freesound CC0)"
            className={`${PILL_LAYOUT} ${activeSidebarTab === 'library' ? PILL_ON : PILL_IDLE}`}
          >
            <Music className="w-3.5 h-3.5" />
            <span>Sound Library</span>
          </button>
        )}

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

        {/* Settings button */}
        <div className="relative">
          <button
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            title="Settings & Audio Engine Status"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-line bg-surface-1 text-ink-dim transition-colors hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <Settings className="w-4 h-4" />
          </button>

          {isSettingsOpen && (
            <div
              onClick={() => setIsSettingsOpen(false)}
              className="absolute right-0 top-full mt-1.5 w-68 bg-surface-2 border border-line-strong rounded-card shadow-float p-3 z-50 text-xs text-zinc-300"
            >
              <div className="font-semibold text-zinc-100 pb-2 mb-2 border-b border-zinc-800 flex items-center justify-between">
                <span>Studio Settings</span>
                <span className="text-[10px] text-zinc-500 font-mono">Phase 1</span>
              </div>

              {/* Auto Refresh Setting */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-zinc-200">Auto-Refresh</div>
                    <div className="text-[10px] text-zinc-500">Repaint immediately on edit</div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleAutoRefresh();
                    }}
                    className={`w-9 h-5 rounded-full p-0.5 transition-colors ${
                      project.settings.autoRefresh ? 'bg-cyan-500' : 'bg-zinc-700'
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
                <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
                  <div>
                    <div className="font-medium text-zinc-200">Duck Playing Tracks</div>
                    <div className="text-[10px] text-zinc-500">Lower tracks while recording</div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleDucking();
                    }}
                    className={`w-9 h-5 rounded-full p-0.5 transition-colors ${
                      project.settings.duckPlayingTracks ? 'bg-cyan-500' : 'bg-zinc-700'
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
                    <div className="flex justify-between text-[10px] text-zinc-400">
                      <span>Ducking Gain</span>
                      <span className="mono-nums text-cyan-400 font-semibold">{project.settings.duckingAmountDb} dB</span>
                    </div>
                    <input
                      type="range"
                      min="-24"
                      max="-3"
                      step="1"
                      value={project.settings.duckingAmountDb}
                      onChange={(e) => onUpdateDuckingDb(parseInt(e.target.value, 10))}
                      className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer"
                    />
                  </div>
                )}

                <div className="pt-2 border-t border-zinc-800 space-y-1 text-[11px]">
                  <div className="flex justify-between text-zinc-400">
                    <span>Sample Rate:</span>
                    <span className="font-mono text-zinc-200">{audioEngine.getSampleRate()} Hz</span>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Latency Hint:</span>
                    <span className="font-mono text-zinc-200">interactive</span>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>IndexedDB Autosave:</span>
                    <span className="text-emerald-400 flex items-center gap-0.5">
                      <Check className="w-3 h-3" /> Active
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-zinc-800">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
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
          )}
        </div>
      </div>
    </header>
  );
};
