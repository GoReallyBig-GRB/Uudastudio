/**
 * Uuda Studio - Plugin preview button
 * Loops the targeted track (or the whole mix for the master bus) through its plugin chain, on its own,
 * without moving the timeline playhead. Shared by the rack and the plugin pop-out.
 */

import React, { useEffect, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { Project } from '../../types';
import { audioEngine } from '../../audio/engine';
import { Button } from '../ui';

interface PreviewButtonProps {
  project: Project;
  /** Track id, or MASTER_TRACK_ID for the whole mix */
  targetId: string | null;
  /** Hide the text label (icon only) on cramped layouts */
  compact?: boolean;
  /** Show the notice above the button (when the button sits at the bottom of a dialog) */
  above?: boolean;
}

export const PreviewButton: React.FC<PreviewButtonProps> = ({ project, targetId, compact, above }) => {
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
      <Button
        variant={playing ? 'danger' : 'secondary'}
        size="sm"
        onClick={toggle}
        disabled={!targetId}
        aria-pressed={playing}
        title={playing ? 'Stop preview' : 'Preview this track on its own (loops)'}
        leftIcon={playing ? <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" /> : <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />}
      >
        <span className={compact ? 'sr-only' : 'hidden sm:inline'}>{playing ? 'Stop' : 'Preview'}</span>
      </Button>
      {message && (
        <div role="status" className={`absolute left-0 z-10 w-56 ${above ? 'bottom-full mb-1' : 'top-full mt-1'} rounded-control border border-line-strong bg-surface-2 px-3 py-2 text-xs text-ink shadow-float`}>
          {message}
        </div>
      )}
    </div>
  );
};
