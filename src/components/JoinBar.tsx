import React, { useEffect } from 'react';
import { ChevronLeft, ChevronRight, Link2, Play, Square } from 'lucide-react';
import { Button } from './ui';
import { formatTimecode } from '../utils/formatters';

interface JoinBarProps {
  /** Clips picked so far (an edited clip counts once) */
  picked: number;
  /** When the picked clips can be joined: the length of the result and the number of joins; null otherwise */
  result: { seconds: number; joins: number } | null;
  /** Why joining is not possible yet, in plain words */
  problem: string | null;
  previewing: boolean;
  /** Which join the preview plays around (0-based) */
  seamIndex: number;
  onStep: (dir: 1 | -1) => void;
  onPreview: () => void;
  onStopPreview: () => void;
  onApply: () => void;
  onCancel: () => void;
}

/** Floating bar while picking clips to join: shows how many are picked, previews the result, then joins or cancels. */
export const JoinBar: React.FC<JoinBarProps> = ({ picked, result, problem, previewing, seamIndex, onStep, onPreview, onStopPreview, onApply, onCancel }) => {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      if (e.key === 'Enter' && result) { e.preventDefault(); onApply(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onCancel, onApply, result]);

  return (
    <div role="region" aria-label="Join clips" className="fixed bottom-24 left-1/2 z-50 flex max-w-[calc(100vw-32px)] -translate-x-1/2 flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line-strong bg-surface-2 px-4 py-3 shadow-float uuda-pop-in">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-accent" />
        <div className="leading-tight">
          <div className="text-[12px] font-semibold text-ink">Join clips</div>
          <div className="text-[10px] text-ink-dim">
            {picked === 0 ? 'Click the clips in the order you want them.' : result ? `${picked} picked · ${result.joins} join${result.joins === 1 ? '' : 's'} · ${formatTimecode(result.seconds)} long` : problem ?? `${picked} picked. Pick at least 2.`}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {result && result.joins > 1 && (
          <div className="flex items-center gap-0.5 text-[10px] text-ink-dim">
            <button type="button" aria-label="Previous join" onClick={() => onStep(-1)} className="rounded-full p-1 hover:bg-surface-3 cursor-pointer"><ChevronLeft className="h-3.5 w-3.5" /></button>
            <span className="font-num text-ink">Join {seamIndex + 1}/{result.joins}</span>
            <button type="button" aria-label="Next join" onClick={() => onStep(1)} className="rounded-full p-1 hover:bg-surface-3 cursor-pointer"><ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
        )}
        {previewing ? (
          <Button size="sm" variant="secondary" onClick={onStopPreview} leftIcon={<Square className="h-3 w-3" />}>Stop</Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={!result} onClick={onPreview} leftIcon={<Play className="h-3 w-3" />}>Preview</Button>
        )}
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!result} onClick={onApply}>Join</Button>
      </div>
    </div>
  );
};
