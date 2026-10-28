import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from './cn';

export interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional line under the title. */
  description?: string;
  /** Footer actions, right-aligned. */
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Set false for dialogs that must not close by backdrop click or Escape (for example unsaved-changes prompts). */
  dismissible?: boolean;
  children: React.ReactNode;
}

const WIDTHS = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl' } as const;
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Shared dialog frame: title, close button, scrollable body, footer.
 * Escape closes (when dismissible), Tab stays inside, focus moves in on open and returns to the opener on close.
 */
export const ModalShell: React.FC<ModalShellProps> = ({ open, onClose, title, description, footer, size = 'md', dismissible = true, children }) => {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      opener?.focus?.();
    };
  }, [open, dismissible]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (dismissible && e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'uuda-pop-in flex max-h-[90vh] w-full flex-col overflow-hidden rounded-modal border border-line-strong bg-surface-1 shadow-float outline-none',
          WIDTHS[size],
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-base font-semibold tracking-tight text-ink">{title}</h2>
            {description && <p id={descId} className="mt-0.5 text-xs text-ink-dim">{description}</p>}
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-dim transition-colors hover:bg-white/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">{footer}</footer>}
      </div>
    </div>
  );
};
