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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-2 sm:p-4 select-none animate-in fade-in duration-100">
      <div className="w-full max-w-md max-h-[calc(100dvh-1rem)] overflow-y-auto bg-surface-1 border border-line-strong/80 rounded-modal shadow-2xl overflow-hidden flex flex-col text-xs text-ink">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line bg-surface-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-accent-soft text-accent flex items-center justify-center">
              <FilePlus className="w-3.5 h-3.5" />
            </div>
            <h2 className="font-bold text-sm text-ink tracking-wide">
              Create New Project
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-ink-dim hover:text-ink hover:bg-surface-2 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <div className="p-3 rounded-card bg-surface-2 border border-line-strong/60 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold text-ink text-xs">
                Active Session Detected
              </div>
              <div className="text-[11px] text-ink-dim leading-relaxed">
                Current project <span className="text-accent font-semibold">"{projectName}"</span> contains{' '}
                <span className="text-ink font-semibold">{trackCount} {trackCount === 1 ? 'track' : 'tracks'}</span> and{' '}
                <span className="text-ink font-semibold">{clipCount} {clipCount === 1 ? 'clip' : 'clips'}</span>. Choose how you want to handle your active work:
              </div>
            </div>
          </div>

          <div className="space-y-2.5">
            {/* Action 1: Save & Start New */}
            <button
              onClick={onSaveAndNew}
              className="w-full p-3 rounded-card bg-accent-soft hover:brightness-125 border border-accent/40 text-left transition-all group flex items-start gap-3 cursor-pointer shadow-xs"
            >
              <div className="w-7 h-7 rounded-control bg-accent-soft text-accent flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                <Save className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-accent group-hover:text-accent flex items-center justify-between">
                  <span>Save & Open New Project</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-soft text-accent font-mono">Recommended</span>
                </div>
                <div className="text-[11px] text-ink-dim mt-0.5">
                  Downloads a backup file of your current session, then resets the active tab to a clean blank workspace.
                </div>
              </div>
            </button>

            {/* Action 2: Open in New Browser Tab */}
            <button
              onClick={onOpenInNewTab}
              className="w-full p-3 rounded-card bg-surface-1/80 hover:bg-surface-2 border border-line-strong/80 text-left transition-all group flex items-start gap-3 cursor-pointer"
            >
              <div className="w-7 h-7 rounded-control bg-ok/20 text-ok flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                <ExternalLink className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-ink group-hover:text-ok">
                  Open New Project in Separate Tab
                </div>
                <div className="text-[11px] text-ink-dim mt-0.5">
                  Launches a fresh session in a new browser window/tab, keeping your active project in this tab completely untouched.
                </div>
              </div>
            </button>

            {/* Action 3: Discard & Start New */}
            <button
              onClick={onDiscardAndNew}
              className="w-full p-3 rounded-card bg-surface-1/40 hover:bg-danger/30 border border-line hover:border-danger/60 text-left transition-all group flex items-start gap-3 cursor-pointer"
            >
              <div className="w-7 h-7 rounded-control bg-danger/10 text-danger flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                <Trash2 className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-ink-dim group-hover:text-danger">
                  Start New Without Saving
                </div>
                <div className="text-[11px] text-ink-faint mt-0.5">
                  Discards current workspace changes and opens a clean blank project in this tab immediately.
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-line bg-surface-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-control text-xs font-medium text-ink-dim hover:text-ink hover:bg-surface-2 transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
