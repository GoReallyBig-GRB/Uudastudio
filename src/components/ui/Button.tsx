import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'brand' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: cyan, the main action. brand: gold, reserved for the export call to action. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110 active:brightness-95',
  brand: 'bg-gold text-gold-ink hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface-3 text-ink border border-line-strong hover:bg-surface-2 hover:border-white/20',
  ghost: 'bg-transparent text-ink-dim hover:bg-white/5 hover:text-ink',
  danger: 'bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3.5 text-xs gap-1.5',
  md: 'h-10 px-5 text-sm gap-2',
  lg: 'h-12 px-7 text-sm gap-2.5',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary', size = 'md', loading = false, leftIcon, rightIcon, className, children, disabled, type = 'button', ...rest
}) => (
  <button
    type={type}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    className={cn(
      'inline-flex select-none items-center justify-center rounded-full font-semibold tracking-tight',
      'transition-[background-color,filter,border-color,color] duration-150 ease-premium',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0',
      'disabled:cursor-not-allowed disabled:opacity-45',
      VARIANTS[variant],
      SIZES[size],
      className,
    )}
    {...rest}
  >
    {loading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : leftIcon}
    {children}
    {!loading && rightIcon}
  </button>
);
