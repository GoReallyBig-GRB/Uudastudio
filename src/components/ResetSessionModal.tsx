import React from 'react';
import { Trash2, Save, X, AlertTriangle, RefreshCw } from 'lucide-react';

interface ResetSessionModalProps {
  isOpen: boolean;
  projectName: string;
  trackCount: number;
  clipCount: number;
  onSaveAndReset: () => void;
  onResetWithoutSaving: () => void;
  onClose: () => void;
}

export const ResetSessionModal: React.FC<ResetSessionModalProps> = ({
  isOpen,
  projectName,
  trackCount,
  clipCount,
  onSaveAndReset,
  onResetWithoutSaving,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-[#13131a] border border-zinc-700/80 rounded-xl shadow-2xl p-5 text-zinc-100 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-100 uppercase tracking-wider">
                Reset Session & Wipe Workspace
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Save your work before resetting to prevent data loss.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 rounded hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Warning Details */}
        <div className="p-3.5 rounded-lg bg-[#0c0c10] border border-zinc-800 text-xs space-y-2">
          <div className="flex items-center justify-between text-zinc-300">
            <span className="text-zinc-500">Active Project:</span>
            <span className="font-semibold text-white truncate max-w-[200px]">
              {projectName || 'Untitled Project'}
            </span>
          </div>
          <div className="flex items-center justify-between text-zinc-300">
            <span className="text-zinc-500">Current Tracks:</span>
            <span className="font-mono text-cyan-400">{trackCount} tracks ({clipCount} clips)</span>
          </div>
          <div className="pt-2 border-t border-zinc-800/80 text-[11px] text-rose-300/90 leading-relaxed">
            Resetting will immediately clear all tracks, clips, and timeline data, starting a fresh blank session.
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={onSaveAndReset}
            className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 transition-all cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>Save Project File & Reset Session</span>
          </button>

          <button
            type="button"
            onClick={onResetWithoutSaving}
            className="w-full py-2 px-4 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 border border-rose-500/30 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>Reset Without Saving (Delete All Tracks)</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 px-4 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-all cursor-pointer mt-1"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
