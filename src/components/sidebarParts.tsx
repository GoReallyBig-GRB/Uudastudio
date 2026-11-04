/**
 * Uuda Studio - shared pieces for the side panels (Voiceover, Sound Library).
 * Same language as Quick Actions: quiet surfaces, hairline section dividers, small uppercase labels, pill buttons, and
 * cyan only for what is selected or is the one main action. No buttons in the corners of the header.
 */

import React from 'react';
import { Maximize2 } from 'lucide-react';
import { cn } from './ui/cn';

/** Text field and select, same look as the inputs in Quick Actions and the modals */
export const FIELD =
  'w-full rounded-control border border-line-strong bg-surface-3 px-3 text-xs text-ink placeholder:text-ink-faint transition-colors hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-45';

/** Small pill button; `on` is the selected state (the only cyan in a group of choices) */
export const pill = (on = false, extra = '') =>
  cn(
    'inline-flex h-7 shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 rounded-full border px-3 text-[11px] font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-40',
    on
      ? 'border-accent/40 bg-accent-soft text-accent'
      : 'border-line bg-surface-3/60 text-ink-dim hover:bg-surface-3 hover:text-ink',
    extra,
  );

/** Quiet message box: tone picks the border and text colour */
export const notice = (tone: 'info' | 'danger' | 'warn' = 'info') =>
  cn(
    'rounded-control border px-3 py-2 text-[11px] leading-snug',
    tone === 'danger' && 'border-danger/30 bg-danger/10 text-danger',
    tone === 'warn' && 'border-warn/30 bg-warn/10 text-warn',
    tone === 'info' && 'border-line bg-surface-2 text-ink-dim',
  );

interface PanelHeaderProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}

/** Title block only. Nothing sits in the corner; the full-workspace action is its own row under the header. */
export const PanelHeader: React.FC<PanelHeaderProps> = ({ icon, title, subtitle }) => (
  <div className="flex shrink-0 items-center gap-2.5 border-b border-line bg-surface-1 px-4 py-3">
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface-3 text-ink-dim">{icon}</span>
    <div className="min-w-0">
      <h2 className="truncate text-xs font-semibold tracking-tight text-ink">{title}</h2>
      {subtitle && <p className="truncate text-[10px] text-ink-faint">{subtitle}</p>}
    </div>
  </div>
);

interface ExpandRowProps {
  label: string;
  title: string;
  onClick: () => void;
}

/** Full-width pill that opens the larger workspace for the same job */
export const ExpandRow: React.FC<ExpandRowProps> = ({ label, title, onClick }) => (
  <button type="button" onClick={onClick} title={title} className={pill(false, 'h-8 w-full')}>
    <Maximize2 className="h-3 w-3" aria-hidden="true" />
    <span>{label}</span>
  </button>
);

interface PanelSectionProps {
  label: string;
  /** Quiet text at the right of the label, for a count or a hint. Not a button. */
  aside?: React.ReactNode;
  first?: boolean;
  children: React.ReactNode;
}

/** A labelled block separated from the one above by a hairline, like the sections in Quick Actions */
export const PanelSection: React.FC<PanelSectionProps> = ({ label, aside, first = false, children }) => (
  <section className={cn(!first && 'border-t border-line pt-3')}>
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ink-dim">{label}</h3>
      {aside != null && <span className="font-num text-[10px] text-ink-faint">{aside}</span>}
    </div>
    {children}
  </section>
);
