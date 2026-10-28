import React, { useRef } from 'react';
import { cn } from './cn';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  options: ReadonlyArray<SegmentOption<T>>;
  onChange: (value: T) => void;
  /** Accessible name for the group. */
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}

/** Single-choice pill group. Arrow keys move the selection, as a native radio group would. */
export function SegmentedControl<T extends string>({ value, options, onChange, label, size = 'md', className }: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (from: number, dir: 1 | -1) => {
    for (let step = 1; step <= options.length; step++) {
      const i = (from + dir * step + options.length * step) % options.length;
      if (!options[i].disabled) {
        onChange(options[i].value);
        refs.current[i]?.focus();
        return;
      }
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex items-center gap-0.5 rounded-full border border-line bg-surface-1 p-0.5', className)}
    >
      {options.map((opt, i) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
              else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); }
            }}
            className={cn(
              'rounded-full font-semibold tracking-tight transition-colors duration-150 ease-premium',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              'disabled:cursor-not-allowed disabled:opacity-40',
              size === 'sm' ? 'h-7 px-3 text-xs' : 'h-9 px-4 text-sm',
              selected ? 'bg-surface-3 text-ink shadow-[0_0_0_1px_rgb(0_240_255/0.35)]' : 'text-ink-dim hover:text-ink',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
