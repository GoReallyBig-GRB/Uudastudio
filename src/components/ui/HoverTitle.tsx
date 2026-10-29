import React, { useLayoutEffect, useRef, useState } from 'react';
import { capChars, placeTip } from '../clipTitle';
import { cn } from './cn';

export interface HoverTitleProps {
  /** The full text. */
  text: string;
  /** Most characters shown before it is cut with an ellipsis; the full text then appears in a strip on hover. */
  maxChars: number;
  className?: string;
  /** Small trailing text shown in the strip, for example a clip length. */
  meta?: string;
}

/**
 * A title with a hard character cap, so a long name can never push neighbouring controls out of place. When it is cut,
 * pointing at it shows the full text in the same one-line strip the timeline uses (placed left or right of the pointer).
 */
export const HoverTitle: React.FC<HoverTitleProps> = ({ text, maxChars, className, meta }) => {
  const shown = capChars(text, maxChars);
  const cut = shown !== text;
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip || !pointer) return;
    tip.style.maxWidth = `${window.innerWidth - 16}px`;
    const pos = placeTip(pointer.x, pointer.y, tip.offsetWidth, tip.offsetHeight, window.innerWidth, window.innerHeight);
    tip.style.left = `${pos.left}px`;
    tip.style.top = `${pos.top}px`;
  }, [pointer, text, meta]);

  return (
    <span
      className={cn('whitespace-nowrap', className)}
      onPointerEnter={cut ? (e) => setPointer({ x: e.clientX, y: e.clientY }) : undefined}
      onPointerMove={cut ? (e) => setPointer({ x: e.clientX, y: e.clientY }) : undefined}
      onPointerLeave={cut ? () => setPointer(null) : undefined}
    >
      {shown}
      {cut && pointer && (
        <div
          ref={tipRef}
          role="tooltip"
          style={{ left: 0, top: 0 }}
          className="uuda-pop-in pointer-events-none fixed z-[70] flex items-baseline gap-2 whitespace-nowrap rounded-control border border-line-strong bg-surface-2/95 px-2.5 py-1.5 text-[11px] leading-snug text-ink shadow-float backdrop-blur-sm"
        >
          <span className="min-w-0 truncate font-medium">{text}</span>
          {meta ? <span className="font-num shrink-0 text-[10px] text-ink-faint">{meta}</span> : null}
        </div>
      )}
    </span>
  );
};
