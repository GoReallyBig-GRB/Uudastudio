import React from 'react';
import { cn } from './cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** panel: sits on the app background. raised: sits on a panel. */
  tone?: 'panel' | 'raised';
  padded?: boolean;
}

export const Card: React.FC<CardProps> = ({ tone = 'raised', padded = true, className, children, ...rest }) => (
  <div
    className={cn(
      'rounded-card border border-line',
      tone === 'panel' ? 'bg-surface-1' : 'bg-surface-2',
      padded && 'p-4',
      className,
    )}
    {...rest}
  >
    {children}
  </div>
);
