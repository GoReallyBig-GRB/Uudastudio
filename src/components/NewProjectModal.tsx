import React from 'react';
import { FilePlus, Save, ExternalLink, Trash2, X, AlertTriangle } from 'lucide-react';

interface NewProjectModalProps {
  isOpen: boolean;
  projectName: string;
  trackCount: number;
  clipCount: number;
  onSaveAndNew: () => void;
  onOpenInNewTab: () => void;
  onDiscardAndNew: () => void;
  onClose: () => void;
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({
  isOpen,
  projectName,
  trackCount,
  clipCount,
  onSaveAndNew,
  onOpenInNewTab,
  onDiscardAndNew,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 select-none animate-in fade-in duration-100">
      <div className="w-full max-w-md bg-[#121218] border border-zinc-700/80 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.85)] overflow-hidden flex flex-col text-xs text-zinc-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 bg-[#161622]">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
              <FilePlus className="w-3.5 h-3.5" />
            </div>
            <h2 className="font-bold text-sm text-zinc-100 tracking-wide">
              Create New Project
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <div className="p-3 rounded-xl bg-[#181824] border border-zinc-700/60 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold text-zinc-100 text-xs">
                Active Session Detected
              </div>
              <div className="text-[11px] text-zinc-400 leading-relaxed">
                Current project <span className="text-cyan-300 font-semibold">"{projectName}"</span> contains{' '}
                <span className="text-zinc-200 font-semibold">{trackCount} {trackCount === 1 ? 'track' : 'tracks'}</span> and{' '}
                <span className="text-zinc-200 font-semibold">{clipCount} {clipCount === 1 ? 'clip' : 'clips'}</span>. Choose how you want to handle your active work:
              </div>
            </div>
          </div>

          <div className="space-y-2.5">
            {/* Action 1: Save & Start New */}
            <button
              onClick={onSaveAndNew}
              className="w-full p-3 rounded-xl bg-gradient-to-r from-cyan-950/60 to-blue-950/40 hover:from-cyan-900/70 hover:to-blue-900/50 border border-cyan-500/40 text-left transition-all group flex items-start gap-3 cursor-pointer shadow-xs"
            >
              <div className="w-7 h-7 rounded-lg bg-cyan-500/20 text-cyan-300 flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                <Save className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-cyan-200 group-hover:text-cyan-100 flex items-center justify-between">
                  <span>Save & Open New Project</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono">Recommended</span>
                </div>
                <div className="text-[11px] text-zinc-400 mt-0.5">
                  Downloads a backup file of your current session, then resets the active tab to a clean blank workspace.
                </div>
              </div>
            </button>

            {/* Action 2: Open in New Browser Tab */}
            <button
              onClick={onOpenInNewTab}
              className="w-full p-3 rounded-xl bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700/80 text-left transition-all group flex items-start gap-3 cursor-pointer"
            >
              <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                <ExternalLink className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-zinc-100 group-hover:text-emerald-300">
                  Open New Project in Separate Tab
                </div>
                <div className="text-[11px] text-zinc-400 mt-0.5">
                  Launches a fresh session in a new browser window/tab, keeping your active project in this tab completely untouched.
                </div>
              </div>
            </button>

            {/* Action 3: Discard & Start New */}
            <button
              onClick={onDiscardAndNew}
              className="w-full p-3 rounded-xl bg-zinc-900/40 hover:bg-rose-950/30 border border-zinc-800 hover:border-rose-800/60 text-left transition-all group flex items-start gap-3 cursor-pointer"
            >
              <div className="w-7 h-7 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                <Trash2 className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-zinc-300 group-hover:text-rose-300">
                  Start New Without Saving
                </div>
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  Discards current workspace changes and opens a clean blank project in this tab immediately.
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 bg-[#161622] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
