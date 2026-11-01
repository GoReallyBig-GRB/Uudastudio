import React, { useEffect, useState } from 'react';
import { perfEnabled, perfReport, perfReset, setPerfEnabled, subscribePerf } from './perfProbe';

/** Floating readout for the performance probe. Ctrl+Shift+P toggles it. */
export const PerfHud: React.FC = () => {
  const [, tick] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => subscribePerf(() => tick((n) => n + 1)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        setPerfEnabled(!perfEnabled());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!perfEnabled()) return null;
  const r = perfReport();
  const rows = Object.entries(r.timers).sort((a, b) => b[1].totalMs - a[1].totalMs);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(r, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };
  return (
    <div className="fixed bottom-8 right-3 z-[9999] w-[300px] rounded-md border border-line bg-surface-1/95 p-2 font-mono text-[10px] text-ink-dim shadow-lg">
      <div className="mb-1 flex items-center justify-between text-ink">
        <span>Performance</span>
        <span className="flex gap-2">
          <button className="underline" onClick={perfReset}>Reset</button>
          <button className="underline" onClick={copy}>{copied ? 'Copied' : 'Copy report'}</button>
          <button className="underline" onClick={() => setPerfEnabled(false)}>Close</button>
        </span>
      </div>
      <div>{r.fps} fps · worst frame {r.worstFrameMs} ms · {r.framesOver33ms} frames over 33 ms</div>
      <div className="mb-1">{r.longTasks} long stalls ({r.longTaskMs} ms)</div>
      {rows.map(([name, s]) => (
        <div key={name} className="flex justify-between">
          <span>{name}</span>
          <span>{s.count}× · avg {s.avgMs} · max {s.maxMs} ms</span>
        </div>
      ))}
    </div>
  );
};
