import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Link2, Play, Square } from 'lucide-react';
import { Button } from './ui';
import { stepClip } from './joinInOrder';

/** m:ss, or h:mm:ss for long results */
const formatTimecode = (t: number): string => {
  const n = Math.max(0, Math.floor(t));
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), sec = n % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

interface JoinBarProps {
  /** Clips picked so far (an edited clip counts once) */
  picked: number;
  /** When the picked clips can be joined: the length of the result, the number of clips in it and where each clip starts (seconds from its start); null otherwise */
  result: { seconds: number; clips: number; clipStarts: number[] } | null;
  /** Why joining is not possible yet, in plain words */
  problem: string | null;
  previewing: boolean;
  /** Where the preview is, in seconds from the start of the result */
  position: number;
  /** Jump (or start playing from) a place in the result */
  onSeek: (seconds: number) => void;
  onPreview: () => void;
  onStopPreview: () => void;
  onApply: () => void;
  onCancel: () => void;
}

/** Floating bar while picking clips to join: shows how many are picked, previews the whole result with a tappable progress bar, then joins or cancels. */
export const JoinBar: React.FC<JoinBarProps> = ({ picked, result, problem, previewing, position, onSeek, onPreview, onStopPreview, onApply, onCancel }) => {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
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

  const total = result?.seconds ?? 0;
  const shown = Math.max(0, Math.min(total, scrub ?? position));
  const clipNumber = result ? (() => { let n = 0; result.clipStarts.forEach((s, i) => { if (s <= shown + 0.05) n = i; }); return n + 1; })() : 0;
  const at = (clientX: number) => {
    const r = barRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * total;
  };

  return (
    <div role="region" aria-label="Join clips" className="fixed bottom-24 left-1/2 z-50 flex w-[min(640px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-2.5 rounded-card border border-line-strong bg-surface-2 px-4 py-3 shadow-float uuda-pop-in">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-accent" />
          <div className="leading-tight">
            <div className="text-[12px] font-semibold text-ink">Join clips</div>
            <div className="text-[10px] text-ink-dim">
              {picked === 0 ? 'Click the clips in the order you want them.' : result ? `${result.clips} clips · ${formatTimecode(result.seconds)} long` : problem ?? `${picked} picked. Pick at least 2.`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {result && (
            <div className="flex items-center gap-0.5 text-[10px] text-ink-dim">
              <button type="button" aria-label="Previous clip" disabled={!result} onClick={() => onSeek(stepClip(result.clipStarts, shown, -1))} className="rounded-full p-1 hover:bg-surface-3 cursor-pointer"><ChevronLeft className="h-3.5 w-3.5" /></button>
              <span className="font-num text-ink">Clip {clipNumber} of {result.clips}</span>
              <button type="button" aria-label="Next clip" onClick={() => onSeek(stepClip(result.clipStarts, shown, 1))} className="rounded-full p-1 hover:bg-surface-3 cursor-pointer"><ChevronRight className="h-3.5 w-3.5" /></button>
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
      {result && (
        <div className="flex items-center gap-2">
          <span className="w-11 shrink-0 text-right font-num text-[10px] text-ink-dim">{formatTimecode(shown)}</span>
          <div
            ref={barRef}
            role="slider"
            tabIndex={0}
            aria-label="Preview position"
            aria-valuemin={0}
            aria-valuemax={Math.round(total)}
            aria-valuenow={Math.round(shown)}
            aria-valuetext={`Clip ${clipNumber} of ${result.clips}, ${formatTimecode(shown)}`}
            className="relative h-8 flex-1 cursor-pointer touch-none select-none"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setScrub(at(e.clientX)); }}
            onPointerMove={(e) => { if (scrub !== null) setScrub(at(e.clientX)); }}
            onPointerUp={(e) => { const v = at(e.clientX); setScrub(null); onSeek(v); }}
            onPointerCancel={() => setScrub(null)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') { e.preventDefault(); onSeek(Math.min(total, shown + 5)); }
              else if (e.key === 'ArrowLeft') { e.preventDefault(); onSeek(Math.max(0, shown - 5)); }
              else if (e.key === 'Home') { e.preventDefault(); onSeek(0); }
            }}
          >
            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-3" />
            <div className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent" style={{ width: `${total > 0 ? (shown / total) * 100 : 0}%` }} />
            {result.clipStarts.slice(1).map((s, i) => (
              <div key={i} aria-hidden className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-ink-faint" style={{ left: `${total > 0 ? (s / total) * 100 : 0}%` }} />
            ))}
            <div className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-2 bg-accent" style={{ left: `${total > 0 ? (shown / total) * 100 : 0}%` }} />
          </div>
          <span className="w-11 shrink-0 font-num text-[10px] text-ink-dim">{formatTimecode(total)}</span>
        </div>
      )}
    </div>
  );
};
