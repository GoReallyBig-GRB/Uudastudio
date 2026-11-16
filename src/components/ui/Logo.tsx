import React from 'react';
import { cn } from './cn';

export interface LogoProps {
  /** mark: the UD symbol. full: symbol with the Uuda Studio name (for dark backgrounds). */
  variant?: 'mark' | 'full';
  className?: string;
  alt?: string;
}

/** The Uuda logo. Files live in public/brand; size it with a height or width class. */
export const Logo: React.FC<LogoProps> = ({ variant = 'mark', className, alt = 'Uuda Studio' }) => (
  <img
    src={variant === 'full' ? '/brand/logo.png' : '/brand/logomark.png'}
    alt={alt}
    draggable={false}
    className={cn('select-none object-contain', className)}
  />
);
