import React from 'react';
import { cn } from './cn';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label; also the accessible name. */
  label: string;
  hideLabel?: boolean;
  disabled?: boolean;
  className?: string;
}

export const Switch: React.FC<SwitchProps> = ({ checked, onChange, label, hideLabel = false, disabled = false, className }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={hideLabel ? label : undefined}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cn(
      'group inline-flex items-center gap-3 rounded-full text-sm text-ink-dim',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0',
      'disabled:cursor-not-allowed disabled:opacity-45',
      className,
    )}
  >
    <span
      aria-hidden="true"
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-150 ease-premium',
        checked ? 'border-accent/50 bg-accent-soft' : 'border-line-strong bg-surface-3',
      )}
    >
      <span
        className={cn(
          'absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-all duration-150 ease-premium motion-reduce:transition-none',
          checked ? 'left-[1.1rem] bg-accent' : 'left-0.5 bg-ink-faint',
        )}
      />
    </span>
    {!hideLabel && <span className={cn('transition-colors', checked && 'text-ink')}>{label}</span>}
  </button>
);
