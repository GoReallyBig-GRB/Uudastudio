/**
 * Uuda Studio - canvas that stays sharp.
 *
 * The drawing buffer is sized to the element's on-screen size times devicePixelRatio, then drawn in CSS pixels.
 * (The old plugin canvases had a fixed 320x96 buffer stretched to the full width, which is what looked blurry.)
 */

import React, { useEffect, useRef, useState } from 'react';

interface SharpCanvasProps {
  /** width / height of the drawing area */
  aspect?: number;
  className?: string;
  /** Draws in CSS pixels. Called again whenever the size changes or the parent re-renders. */
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
}

export const SharpCanvas: React.FC<SharpCanvasProps> = ({ aspect = 2.4, className = '', draw }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || size.w < 2 || size.h < 2) return;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const bw = Math.round(size.w * dpr);
    const bh = Math.round(size.h * dpr);
    if (el.width !== bw) el.width = bw;
    if (el.height !== bh) el.height = bh;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    draw(ctx, size.w, size.h);
  });

  return <canvas ref={ref} className={`block w-full ${className}`} style={{ aspectRatio: String(aspect) }} />;
};
