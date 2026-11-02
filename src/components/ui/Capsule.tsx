import React, { createContext, useContext } from 'react';
import { cn } from './cn';

/**
 * Capsule: a group of related buttons inside one pill, split by hairlines. Only the two outer ends are rounded, so the
 * group reads as a single curved shape and uses less width than separate pills.
 * variant="loose" renders the same buttons as separate pills instead, for side-by-side comparison.
 */
export type CapsuleVariant = 'joined' | 'loose';

const CapsuleContext = createContext<CapsuleVariant>('joined');
const CapsuleSizeContext = createContext<'md' | 'sm'>('md');

export interface CapsuleProps {
  /** Accessible name for the group, for example "Edit tools". */
  label: string;
  variant?: CapsuleVariant;
  /** `sm` is a third smaller: for dense toolbars below the header */
  size?: 'md' | 'sm';
  className?: string;
  children: React.ReactNode;
}

export const Capsule: React.FC<CapsuleProps> = ({ label, variant = 'joined', size = 'md', className, children }) => (
  <CapsuleContext.Provider value={variant}>
    <CapsuleSizeContext.Provider value={size}>
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex shrink-0',
        variant === 'joined'
          ? 'items-stretch divide-x divide-line overflow-hidden rounded-full border border-line bg-surface-1'
          : 'items-center gap-1.5',
        className,
      )}
    >
      {children}
    </div>
    </CapsuleSizeContext.Provider>
  </CapsuleContext.Provider>
);

export interface CapsuleButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  /** Tooltip text; also the accessible name when the button has no label. */
  title: string;
  icon?: React.ReactNode;
  /** Currently selected or switched on: the only place the cyan accent is used inside a group. */
  active?: boolean;
  /** Icon only, a square-ish segment. */
  iconOnly?: boolean;
  /** Colour when active: cyan by default, gold for switches that mean "this takes over" (Solo). */
  tone?: 'accent' | 'gold';
}

export const CapsuleButton: React.FC<CapsuleButtonProps> = ({
  title, icon, active = false, iconOnly = false, tone = 'accent', className, children, type = 'button', ...rest
}) => {
  const variant = useContext(CapsuleContext);
  const size = useContext(CapsuleSizeContext);
  return (
    <button
      type={type}
      title={title}
      aria-label={children ? undefined : title}
      aria-pressed={active || undefined}
      className={cn(
        'inline-flex items-center justify-center font-semibold tracking-tight',
        size === 'sm' ? 'h-[22px] gap-1 text-[10px]' : 'h-8 gap-1.5 text-xs',
        'transition-colors duration-150 ease-premium',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60',
        'disabled:cursor-not-allowed disabled:opacity-40',
        iconOnly ? (size === 'sm' ? 'w-6' : 'w-9') : size === 'sm' ? 'px-2.5' : 'px-3.5',
        variant === 'joined'
          ? active ? (tone === 'gold' ? 'bg-gold/20 text-gold' : 'bg-accent-soft text-accent') : 'text-ink-dim hover:bg-white/5 hover:text-ink'
          : cn(
              'rounded-full border',
              active ? (tone === 'gold' ? 'border-gold/50 bg-gold/20 text-gold' : 'border-accent/40 bg-accent-soft text-accent') : 'border-line bg-surface-1 text-ink-dim hover:bg-surface-3 hover:text-ink',
            ),
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
};
