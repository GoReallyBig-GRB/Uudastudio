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

  useEffect(() => {
    setProjectName(project.name);
  }, [project.name]);

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
    <header className="h-13 bg-[#0E0E12] border-b border-zinc-800/90 px-4 flex items-center justify-between gap-4 select-none shrink-0 z-40">
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
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shadow-[0_0_12px_rgba(0,240,255,0.4)]">
            <AudioWaveform className="w-4 h-4 text-black stroke-[2.5]" />
          </div>
          <span className="font-bold tracking-tight text-sm text-zinc-100 flex items-center gap-1.5">
            UUDA <span className="text-cyan-400 font-extrabold text-xs tracking-widest">STUDIO</span>
          </span>
        </div>

        <div className="h-4 w-px bg-zinc-800" />

        {/* File Menu Dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setIsProjectMenuOpen(!isProjectMenuOpen);
              setIsEditMenuOpen(false);
            }}
            title="File Menu: Open, Save, Import, and Export"
            className="flex items-center gap-1.5 text-xs text-zinc-200 hover:text-cyan-300 px-2 py-1 rounded bg-[#161622] hover:bg-[#1c1c2a] border border-zinc-700/80 transition-colors font-medium cursor-pointer"
          >
            <FolderArchive className="w-3.5 h-3.5 text-cyan-400" />
            <span>File</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {isProjectMenuOpen && (
            <div
              onClick={() => setIsProjectMenuOpen(false)}
              className="absolute left-0 top-full mt-1.5 w-64 bg-[#14141e] border border-zinc-700/90 rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.85)] py-1.5 z-50 text-xs text-zinc-200 animate-in fade-in duration-100"
            >
              <button
                onClick={onNewProject}
                className="w-full text-left px-3 py-2 hover:bg-cyan-500/20 hover:text-cyan-300 flex items-center gap-2.5 transition-colors cursor-pointer"
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
                  className="w-full text-left px-3 py-2 hover:bg-cyan-500/20 hover:text-cyan-300 flex items-center gap-2.5 transition-colors cursor-pointer"
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
                  className="w-full text-left px-3 py-2 hover:bg-cyan-500/20 hover:text-cyan-300 flex items-center gap-2.5 transition-colors cursor-pointer"
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
                className="w-full text-left px-3 py-2 hover:bg-cyan-500/20 hover:text-cyan-300 flex items-center gap-2.5 transition-colors cursor-pointer"
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
                  className="w-full text-left px-3 py-2 hover:bg-cyan-500/20 hover:text-cyan-300 flex items-center gap-2.5 transition-colors cursor-pointer"
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
                  className="w-full text-left px-3 py-2 hover:bg-cyan-500/20 hover:text-cyan-300 flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4 text-amber-400" />
                  <div>
                    <div className="font-semibold">Open from Root Folder...</div>
                    <div className="text-[10px] text-zinc-500">Browse .uuda files in the selected folder</div>
                  </div>
                </button>
              )}

              {onSaveAsTemplate && (
                <button
                  onClick={onSaveAsTemplate}
                  className="w-full text-left px-3 py-2 hover:bg-cyan-500/20 hover:text-cyan-300 flex items-center gap-2.5 transition-colors cursor-pointer"
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
                className="w-full text-left px-3 py-2 hover:bg-cyan-500/20 hover:text-cyan-300 flex items-center gap-2.5 transition-colors cursor-pointer"
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
                  className="w-full text-left px-3 py-2 hover:bg-cyan-500/20 hover:text-cyan-300 flex items-center gap-2.5 transition-colors cursor-pointer"
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
            className="bg-black/60 border border-cyan-500 rounded px-2 py-0.5 text-xs text-zinc-200 font-medium focus:outline-none w-44"
          />
        ) : (
          <span
            onDoubleClick={() => setIsEditingName(true)}
            title="Double-click to rename project"
            className="text-xs text-zinc-300 font-medium truncate max-w-[160px] cursor-text hover:text-cyan-300 transition-colors"
          >
            {project.name}
          </span>
        )}

        {/* Edit Menu Dropdown */}
        <div className="relative">
          <button
            onClick={() => setIsEditMenuOpen(!isEditMenuOpen)}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded hover:bg-zinc-800/60 transition-colors"
          >
            <span>Edit</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {isEditMenuOpen && (
            <div
              onClick={() => setIsEditMenuOpen(false)}
              className="absolute left-0 top-full mt-1 w-60 bg-[#121218] border border-zinc-700/80 rounded-lg shadow-2xl py-1 z-50 text-xs text-zinc-300"
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
            className="flex items-center gap-1.5 text-xs text-zinc-300 hover:text-cyan-300 px-2 py-1 rounded bg-[#161622] hover:bg-[#1c1c2a] border border-zinc-700/80 transition-colors font-medium cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Effects</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {isEffectsMenuOpen && (
            <div
              onClick={() => setIsEffectsMenuOpen(false)}
              className="absolute left-0 top-full mt-1.5 w-64 bg-[#14141e] border border-zinc-700/90 rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.85)] py-1.5 z-50 text-xs text-zinc-200 animate-in fade-in duration-100"
            >
              <div className="px-3 py-1.5 text-[10px] font-mono text-cyan-400 font-bold uppercase tracking-wider border-b border-zinc-800 flex items-center justify-between">
                <span>Real-Time Audio Effects</span>
                <span className="text-[9px] text-zinc-500">AudioWorklet DSP</span>
              </div>
              <button
                onClick={() => onOpenEffect?.('delay')}
                className="w-full text-left px-3 py-2 hover:bg-cyan-500/20 hover:text-cyan-300 flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-zinc-100">Delay & Echo...</div>
                  <div className="text-[10px] text-zinc-500">Stereo ping-pong & feedback damping</div>
                </div>
              </button>
              <button
                onClick={() => onOpenEffect?.('equalizer')}
                className="w-full text-left px-3 py-2 hover:bg-cyan-500/20 hover:text-cyan-300 flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-zinc-100">Equalize (5-Band EQ)...</div>
                  <div className="text-[10px] text-zinc-500">Parametric EQ with frequency graph</div>
                </div>
              </button>
              <button
                onClick={() => onOpenEffect?.('chorus')}
                className="w-full text-left px-3 py-2 hover:bg-cyan-500/20 hover:text-cyan-300 flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-zinc-100">Chorus...</div>
                  <div className="text-[10px] text-zinc-500">Multi-voice modulated fractional-delay</div>
                </div>
              </button>
              <button
                onClick={() => onOpenEffect?.('flanger')}
                className="w-full text-left px-3 py-2 hover:bg-cyan-500/20 hover:text-cyan-300 flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-zinc-100">Flanger...</div>
                  <div className="text-[10px] text-zinc-500">Short modulated delay with resonance</div>
                </div>
              </button>
              <button
                onClick={() => onOpenEffect?.('phaser')}
                className="w-full text-left px-3 py-2 hover:bg-cyan-500/20 hover:text-cyan-300 flex items-center justify-between transition-colors cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-zinc-100">Phaser...</div>
                  <div className="text-[10px] text-zinc-500">Cascaded all-pass sweep stages</div>
                </div>
              </button>
              <button
                onClick={() => onOpenEffect?.('reverb')}
                className="w-full text-left px-3 py-2 hover:bg-cyan-500/20 hover:text-cyan-300 flex items-center justify-between transition-colors cursor-pointer"
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
        {/* Transport Buttons */}
        <div className="flex items-center gap-1 bg-[#15151c] p-1 rounded-lg border border-zinc-800">
          {/* Return to Start / Rewind to Head Button */}
          <button
            onClick={onReturnToStart}
            title="Return to Start / Rewind to Head (Home / 0)"
            className="w-8 h-8 rounded-md bg-zinc-800/60 text-zinc-400 hover:text-cyan-300 hover:bg-zinc-700/60 flex items-center justify-center transition-colors cursor-pointer"
          >
            <SkipBack className="w-4 h-4 fill-current" />
          </button>

          {isPlaying ? (
            <button
              onClick={onPause}
              title="Pause (Space)"
              className="w-8 h-8 rounded-md bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 flex items-center justify-center transition-colors"
            >
              <Pause className="w-4 h-4 fill-current" />
            </button>
          ) : (
            <button
              onClick={onPlay}
              title="Play (Space)"
              className="w-8 h-8 rounded-md bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 flex items-center justify-center transition-colors"
            >
              <Play className="w-4 h-4 fill-current ml-0.5" />
            </button>
          )}

          <button
            onClick={onStop}
            title="Stop & Return to Start"
            className="w-8 h-8 rounded-md bg-zinc-800/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60 flex items-center justify-center transition-colors"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>

          <div className="h-4 w-px bg-zinc-800 mx-0.5" />

          {/* RECORD Button (toned down subtle styling when not engaged) */}
          <button
            onClick={onOpenRecord}
            title="Open Recording Studio with 4-Band Input EQ (R)"
            className="flex items-center gap-1.5 px-2.5 h-8 rounded-md bg-[#16161d] hover:bg-rose-950/40 text-zinc-300 hover:text-rose-200 border border-zinc-700/80 hover:border-rose-600/50 text-xs font-semibold transition-all cursor-pointer shadow-xs"
          >
            <div className="w-2 h-2 rounded-full bg-rose-500/80" />
            <span>Record</span>
          </button>
        </div>
      </div>

      {/* Right Controls: Auto-refresh, Voiceover, Sound Library, Export, Settings */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Manual Refresh button (shown when auto-refresh is off or requested) */}
        {!project.settings.autoRefresh && (
          <button
            onClick={onManualRefresh}
            title="Manual Repaint / Refresh"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 text-xs font-medium transition-colors"
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-gradient-to-r from-cyan-500/20 to-indigo-600/30 hover:from-cyan-500/30 hover:to-indigo-600/40 text-cyan-200 hover:text-white border border-cyan-500/40 hover:border-cyan-400 shadow-[0_0_12px_rgba(0,240,255,0.25)] transition-all cursor-pointer"
        >
          <Mic className="w-3.5 h-3.5 text-cyan-400" />
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
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeSidebarTab === 'library'
                ? 'bg-emerald-500 text-black font-bold shadow-[0_0_14px_rgba(16,185,129,0.4)]'
                : 'bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 border border-zinc-700/60'
            }`}
          >
            <Music className="w-3.5 h-3.5 text-emerald-400" />
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-gradient-to-r from-purple-900/70 to-indigo-900/70 hover:from-purple-800/90 hover:to-indigo-800/90 text-purple-200 hover:text-white border border-purple-500/50 hover:border-purple-400 shadow-[0_0_12px_rgba(168,85,247,0.3)] transition-all cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          <span>Plugins</span>
        </button>

        {/* Master & Export Production Button */}
        <button
          onClick={onOpenExport}
          title="Master & Export Production (WAV / MP3 at LUFS target)"
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white border border-emerald-400/50 text-xs font-bold shadow-[0_0_14px_rgba(16,185,129,0.3)] transition-all cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export</span>
        </button>

        {/* Settings button */}
        <div className="relative">
          <button
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            title="Settings & Audio Engine Status"
            className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 rounded-md border border-zinc-800 transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>

          {isSettingsOpen && (
            <div
              onClick={() => setIsSettingsOpen(false)}
              className="absolute right-0 top-full mt-1.5 w-68 bg-[#121218] border border-zinc-700/80 rounded-lg shadow-2xl p-3 z-50 text-xs text-zinc-300"
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
