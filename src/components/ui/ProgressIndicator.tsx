/**
 * The one progress indicator for long jobs (import, effects, processing, export): label, percentage, time left, a bar and
 * Cancel. `inline` sits inside a dialog or panel; `floating` is a card at the bottom of the workspace (upload).
 */
import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from './cn';
import { Button } from './Button';
import { clampPercent, formatDuration, secondsLeft } from './progressMath';

export interface ProgressIndicatorProps {
  /** 0 to 1. null shows a moving bar with no percentage (work whose length is unknown). */
  fraction: number | null;
  label: string;
  /** A second, quieter line (file name, hint). */
  detail?: React.ReactNode;
  /** Shows a Cancel button. The caller stops the work. */
  onCancel?: () => void;
  cancelLabel?: string;
  /** Floating only: hides the card while the work goes on. */
  onDismiss?: () => void;
  variant?: 'inline' | 'floating';
  className?: string;
}

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({ fraction, label, detail, onCancel, cancelLabel = 'Cancel', onDismiss, variant = 'inline', className }) => {
  const startedAt = useRef(Date.now());
  const [, tick] = useState(0);
  // Re-render each second so the time left keeps counting down between progress reports
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const known = fraction !== null;
  const pct = known ? clampPercent(fraction) : 0;
  const left = known ? secondsLeft((Date.now() - startedAt.current) / 1000, fraction) : null;
  const timeText = !known ? '' : left === null ? 'estimating time left...' : left <= 1 ? 'almost done' : `about ${formatDuration(left)} left`;

  const body = (
    <div role="status" aria-live="polite" className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="min-w-0 truncate font-semibold text-ink" title={label}>{label}</span>
        {known && <span className="font-num shrink-0 tabular-nums text-ink-dim">{pct}%</span>}
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? pct : undefined}
      >
        {known ? (
          <div className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out" style={{ width: `${Math.max(2, pct)}%` }} />
        ) : (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[11px] text-ink-faint">{detail ?? timeText}{detail && timeText ? ` · ${timeText}` : ''}</span>
        {onCancel && (
          <Button variant="secondary" size="sm" className="h-7 shrink-0 px-3" onClick={onCancel}>{cancelLabel}</Button>
        )}
      </div>
    </div>
  );

  if (variant === 'inline') return body;
  return (
    <div className="pointer-events-none absolute bottom-8 left-1/2 z-30 w-80 max-w-[calc(100%-2rem)] -translate-x-1/2">
      <div className="pointer-events-auto relative rounded-card border border-line-strong bg-surface-1/95 p-4 shadow-[0_12px_48px_rgba(0,0,0,0.42)] backdrop-blur-xl">
        {onDismiss && (
          <button
            type="button"
            aria-label="Hide progress"
            title="Hide this; the work continues"
            onClick={onDismiss}
            className="absolute right-2 top-2 cursor-pointer rounded-full p-1 text-ink-faint hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <div className={onDismiss ? 'pr-5' : ''}>{body}</div>
      </div>
    </div>
  );
};
