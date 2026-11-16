import React, { useEffect, useRef } from 'react';
import { audioRecorder } from '../audio/recorder';

interface Props {
  /** Where on the timeline the take began, in seconds */
  startSeconds: number;
  pixelsPerSecond: number;
  height: number;
  className?: string;
}

/** The waveform of the take as it forms: bars grow from the point where recording began, following the sound being captured */
export const LiveRecordingTrace: React.FC<Props> = ({ startSeconds, pixelsPerSecond, height, className }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const colour = getComputedStyle(document.documentElement).getPropertyValue('--color-danger').trim() || '#ef4444';
    const draw = () => {
      const c = ref.current, wrap = box.current;
      if (c && wrap) {
        const { peaks, perSecond } = audioRecorder.getLivePeaks();
        const seconds = peaks.length / perSecond;
        const w = Math.max(2, Math.ceil(seconds * pixelsPerSecond) + 2);
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        wrap.style.width = `${w}px`;
        // A canvas cannot be wider than browsers allow; a very long take shows its most recent stretch
        const drawW = Math.min(w, 8000);
        const shift = w - drawW;
        if (c.width !== Math.round(drawW * dpr) || c.height !== Math.round(height * dpr)) { c.width = Math.round(drawW * dpr); c.height = Math.round(height * dpr); c.style.width = `${drawW}px`; c.style.height = `${height}px`; }
        c.style.left = `${shift}px`;
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, drawW, height);
          ctx.fillStyle = colour;
          const mid = height / 2;
          const per = perSecond / pixelsPerSecond; // slices in one pixel column
          for (let x = 0; x < drawW; x++) {
            const from = Math.floor((x + shift) * per), to = Math.min(peaks.length, Math.max(from + 1, Math.floor((x + shift + 1) * per)));
            let pk = 0;
            for (let i = from; i < to; i++) if (peaks[i] > pk) pk = peaks[i];
            const h = Math.max(1, Math.min(1, Math.sqrt(pk)) * (height - 6));
            ctx.fillRect(x, mid - h / 2, 1, h);
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [pixelsPerSecond, height]);

  return (
    <div ref={box} aria-hidden="true" style={{ left: `${startSeconds * pixelsPerSecond}px`, top: 0, height, width: 2 }} className={`pointer-events-none absolute overflow-hidden rounded-sm border border-danger/50 bg-danger/10 ${className ?? ''}`}>
      <canvas ref={ref} style={{ position: 'absolute', top: 0 }} />
    </div>
  );
};
