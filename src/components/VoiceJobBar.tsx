/**
 * Uuda Studio - shows the shared voiceover job: progress with elapsed time and Cancel, a finished voiceover waiting to
 * be listened to / added / discarded, or the short "added to timeline" confirmation. Used by the sidebar panel.
 */

import React, { useEffect, useState } from 'react';
import { Loader2, Play, Pause, Plus, X, CheckCircle2 } from 'lucide-react';
import { useVoiceJob, voiceJob } from '../voice/voiceJob';

export const VoiceJobBar: React.FC = () => {
  const job = useVoiceJob();
  const [now, setNow] = useState(() => Date.now());
  const busy = job.status === 'sending' || job.status === 'decoding';

  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [busy]);

  if (busy) {
    const seconds = job.startedAt ? Math.max(0, Math.round((now - job.startedAt) / 1000)) : 0;
    return (
      <div className="p-2.5 rounded-lg bg-cyan-950/30 border border-cyan-800/50 flex items-center justify-between gap-2 text-[11px] text-cyan-200">
        <span className="flex items-center gap-2 min-w-0">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span className="truncate">
            {job.progressMsg || 'Generating voiceover...'} {seconds}s
          </span>
        </span>
        <button
          type="button"
          onClick={() => voiceJob.cancel()}
          className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-semibold cursor-pointer shrink-0"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (job.status === 'ready' && job.asset) {
    return (
      <div className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-800/50 space-y-2 text-[11px] text-emerald-200">
        <div className="flex items-center gap-1.5 font-semibold">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Voiceover ready ({job.asset.durationSeconds.toFixed(1)}s)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => voiceJob.togglePlayGenerated()}
            className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-[10px] font-semibold cursor-pointer"
          >
            {job.isPlayingGenerated ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            <span>{job.isPlayingGenerated ? 'Pause' : 'Listen'}</span>
          </button>
          <button
            type="button"
            onClick={() => voiceJob.commit()}
            className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-semibold cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            <span>Add to timeline</span>
          </button>
          <button
            type="button"
            onClick={() => voiceJob.discard()}
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-zinc-400 hover:text-white text-[10px] cursor-pointer"
          >
            <X className="w-3 h-3" />
            <span>Discard</span>
          </button>
        </div>
      </div>
    );
  }

  if (job.notice) {
    return (
      <div className="p-2 rounded-lg bg-emerald-950/30 border border-emerald-800/50 flex items-center justify-between text-[11px] text-emerald-200">
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {job.notice}
        </span>
        <button type="button" onClick={() => voiceJob.clearNotice()} className="text-zinc-400 hover:text-white cursor-pointer">
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return null;
};
