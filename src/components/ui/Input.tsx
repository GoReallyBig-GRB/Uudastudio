import React, { useId } from 'react';
import { cn } from './cn';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  hint?: string;
  /** When set, the field is marked invalid and the message is announced. */
  error?: string;
  /** Right-aligned text inside the field, for example a unit. */
  suffix?: string;
}

export const Input: React.FC<InputProps> = ({ label, hint, error, suffix, className, id, ...rest }) => {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className={cn('block', className)}>
      <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-ink-dim">{label}</label>
      <div className="relative">
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'h-10 w-full rounded-control border bg-surface-3 px-3.5 text-sm text-ink placeholder:text-ink-faint',
            'transition-colors duration-150 ease-premium',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
            'disabled:cursor-not-allowed disabled:opacity-45',
            error ? 'border-danger/60' : 'border-line-strong hover:border-white/20',
            suffix && 'pr-12',
          )}
          {...rest}
        />
        {suffix && (
          <span className="font-num pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-xs text-ink-faint">{suffix}</span>
        )}
      </div>
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="mt-1.5 text-xs text-danger">{error}</p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-xs text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
};
