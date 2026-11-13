import React, { useEffect, useRef, useState } from 'react';
import { cn } from './cn';

export interface MenuItem {
  id: string;
  label: string;
  /** A second, smaller line under the label */
  hint?: string;
  icon?: React.ReactNode;
  /** Shown in the danger colour */
  danger?: boolean;
  disabled?: boolean;
  /** A thin line above this item */
  divider?: boolean;
  onSelect: () => void;
}

export interface MenuProps {
  /** The button that opens the menu. It receives the props to spread on it. */
  trigger: (p: { ref: React.Ref<HTMLButtonElement>; onClick: () => void; 'aria-haspopup': 'menu'; 'aria-expanded': boolean }) => React.ReactNode;
  items: MenuItem[];
  /** Which edge of the button the menu lines up with */
  align?: 'start' | 'end';
  label: string;
  /** Keep the menu open after choosing (for items that say "Copied") */
  keepOpen?: boolean;
}

/** A small menu opened by a button. Fixed to the screen, so a scrolling area cannot clip it; closes on Escape or a click outside. */
export const Menu: React.FC<MenuProps> = ({ trigger, items, align = 'start', label, keepOpen }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const btn = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLSpanElement>(null);

  const toggle = () => {
    if (!open && btn.current) {
      const b = btn.current.getBoundingClientRect(), w = 280;
      const left = align === 'end' ? Math.max(8, b.right - w) : Math.max(8, Math.min(window.innerWidth - w - 8, b.left));
      const up = window.innerHeight - b.bottom < 260 && b.top > 260;
      setPos({ position: 'fixed', left, width: Math.min(w, window.innerWidth - 16), ...(up ? { bottom: window.innerHeight - b.top + 6 } : { top: b.bottom + 6 }) });
    }
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <span ref={root} className="relative inline-flex">
      {trigger({ ref: btn, onClick: toggle, 'aria-haspopup': 'menu', 'aria-expanded': open })}
      {open && (
        <span role="menu" aria-label={label} style={pos} className="z-50 overflow-hidden rounded-card border border-line-strong bg-surface-1 py-1 shadow-xl">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => { it.onSelect(); if (!keepOpen) setOpen(false); }}
              className={cn('flex w-full items-start gap-3 px-3 py-2 text-left text-sm hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none disabled:opacity-40', it.divider && 'mt-1 border-t border-line pt-3', it.danger ? 'text-danger' : 'text-ink')}
            >
              {it.icon && <span className="mt-0.5 shrink-0 text-ink-dim" aria-hidden>{it.icon}</span>}
              <span className="min-w-0 flex-1"><span className="block font-medium">{it.label}</span>{it.hint && <span className="block text-[11px] font-normal text-ink-dim">{it.hint}</span>}</span>
            </button>
          ))}
        </span>
      )}
    </span>
  );
};
