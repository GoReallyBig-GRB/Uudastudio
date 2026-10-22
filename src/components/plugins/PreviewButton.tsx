/**
 * Uuda Studio - Plugin preview button
 * Loops the targeted track (or the whole mix for the master bus) through its plugin chain, on its own,
 * without moving the timeline playhead. Shared by the rack header and the plugin pop-out.
 */

import React, { useEffect, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { Project } from '../../types';
import { audioEngine } from '../../audio/engine';

interface PreviewButtonProps {
  project: Project;
  /** Track id, or MASTER_TRACK_ID for the whole mix */
  targetId: string | null;
  /** Hide the text label (icon only) on cramped layouts */
  compact?: boolean;
}

export const PreviewButton: React.FC<PreviewButtonProps> = ({ project, targetId, compact }) => {
  const [playing, setPlaying] = useState<boolean>(() => audioEngine.getPreviewTarget() === targetId && !!targetId);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setPlaying(!!targetId && audioEngine.getPreviewTarget() === targetId);
    sync();
    window.addEventListener('uuda:preview-changed', sync);
    return () => window.removeEventListener('uuda:preview-changed', sync);
  }, [targetId]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(t);
  }, [message]);

  const toggle = async () => {
    if (!targetId) return;
    if (playing) {
      audioEngine.stopPreview();
      return;
    }
    const result = await audioEngine.startPreview(project, targetId);
    if (!result.ok) setMessage(result.reason || 'Nothing to preview.');
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        disabled={!targetId}
        aria-pressed={playing}
        title={playing ? 'Stop preview' : 'Preview this track on its own (loops)'}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-xs font-bold border cursor-pointer disabled:opacity-30 disabled:cursor-default ${
          playing
            ? 'bg-rose-500/15 text-rose-300 border-rose-500/60'
            : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/50 hover:bg-emerald-500/25'
        }`}
      >
        {playing ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
        <span className={compact ? 'sr-only' : 'hidden sm:inline'}>{playing ? 'Stop' : 'Preview'}</span>
      </button>
      {message && (
        <div
          role="status"
          className="absolute right-0 top-full mt-1 z-10 w-56 px-2.5 py-1.5 rounded-sm bg-[#1b1b24] border border-zinc-600 text-[11px] text-zinc-200"
        >
          {message}
        </div>
      )}
    </div>
  );
};
