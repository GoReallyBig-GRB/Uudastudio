/**
 * Uuda Studio - colour box
 * A small rounded square that shows a colour and opens the system colour picker when clicked. The change is committed when the
 * picker closes (one undo step), while the box previews the colour as you drag. With no colour set it shows an outline (and an
 * optional label such as the track number), so uncoloured tracks stay quiet.
 */

import React, { useEffect, useRef, useState } from 'react';

interface ColorBoxProps {
  /** #rrggbb, or null when no colour is set */
  value: string | null;
  /** Shown inside the box while there is no colour (a track number, say) */
  label?: string;
  title?: string;
  ariaLabel: string;
  onChange: (hex: string) => void;
  /** Double-click clears the colour (tracks only) */
  onClear?: () => void;
  /** Picker starting colour when there is no value */
  fallback?: string;
  /** 'sm' is a quarter smaller (group strips) */
  size?: 'sm' | 'md';
}

export const ColorBox: React.FC<ColorBoxProps> = ({ value, label, title, ariaLabel, onChange, onClear, fallback = '#5fb3a6', size = 'md' }) => {
  const ref = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // React's onChange fires for every move inside the picker; the native "change" event fires once, when the choice is made.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const commit = () => {
      setPreview(null);
      if (/^#[0-9a-fA-F]{6}$/.test(el.value)) onChange(el.value.toLowerCase());
    };
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  }, [onChange]);

  const shown = preview ?? value;
  return (
    <label
      title={title}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        if (onClear && value) {
          e.preventDefault();
          e.stopPropagation();
          onClear();
        }
      }}
      className={`relative flex ${size === 'sm' ? 'h-[15px] w-[15px]' : 'h-5 w-5'} shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-[5px] border border-line-strong text-[9px] font-num text-ink-faint transition-shadow hover:shadow-[0_0_0_2px_rgb(255_255_255/0.12)] focus-within:ring-2 focus-within:ring-accent/60`}
      style={shown ? { background: shown, borderColor: 'rgb(0 0 0 / 0.35)' } : undefined}
    >
      {!shown && label}
      <input
        ref={ref}
        type="color"
        aria-label={ariaLabel}
        value={shown ?? fallback}
        onChange={(e) => setPreview(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </label>
  );
};
