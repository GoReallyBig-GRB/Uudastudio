/**
 * A small built-in performance readout for finding what makes the timeline feel slow. Off by default and free when off.
 * Turn it on with Ctrl+Shift+P (or `?perf=1` in the address). It shows frame rate, the worst recent frame, how many long
 * main-thread stalls there were, and how often and how long the timeline's own work ran: lane drawing, ruler drawing,
 * Timeline renders, scroll handling, and how long Quick Actions takes to appear. "Copy report" puts the numbers on the
 * clipboard so they can be pasted into a message.
 */
interface Stat { count: number; total: number; max: number }

const stats = new Map<string, Stat>();
let enabled = false;
const listeners = new Set<() => void>();

export const perfEnabled = (): boolean => enabled;

export const setPerfEnabled = (on: boolean): void => {
  enabled = on;
  if (on) startFrameLoop();
  listeners.forEach((l) => l());
};

export const subscribePerf = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};

const record = (name: string, ms: number) => {
  const s = stats.get(name) ?? { count: 0, total: 0, max: 0 };
  s.count += 1;
  s.total += ms;
  if (ms > s.max) s.max = ms;
  stats.set(name, s);
};

/** Time `fn` under `name` (a plain call when the probe is off). */
export const perfTime = <T>(name: string, fn: () => T): T => {
  if (!enabled) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    record(name, performance.now() - t0);
  }
};

/** Count an event (a render, a redraw) under `name`. */
export const perfCount = (name: string): void => {
  if (enabled) record(name, 0);
};

const marks = new Map<string, number>();
/** Start a stopwatch that `perfEnd` stops, for things that span several steps (key press to Quick Actions on screen). */
export const perfStart = (name: string): void => {
  if (enabled) marks.set(name, performance.now());
};
export const perfEnd = (name: string): void => {
  if (!enabled) return;
  const t0 = marks.get(name);
  if (t0 === undefined) return;
  marks.delete(name);
  record(name, performance.now() - t0);
};

const frames = { last: 0, worst: 0, over33: 0, n: 0, windowStart: 0, fps: 0, longTasks: 0, longTaskMs: 0 };
let loopOn = false;

function startFrameLoop() {
  if (loopOn || typeof requestAnimationFrame === 'undefined') return;
  loopOn = true;
  frames.last = performance.now();
  frames.windowStart = frames.last;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { frames.longTasks += 1; frames.longTaskMs += e.duration; }
    }).observe({ entryTypes: ['longtask'] });
  } catch { /* not supported: the frame numbers still work */ }
  const tick = (now: number) => {
    if (!enabled) { loopOn = false; return; }
    const dt = now - frames.last;
    frames.last = now;
    frames.n += 1;
    if (dt > frames.worst) frames.worst = dt;
    if (dt > 33) frames.over33 += 1;
    if (now - frames.windowStart >= 1000) {
      frames.fps = Math.round((frames.n * 1000) / (now - frames.windowStart));
      frames.n = 0;
      frames.windowStart = now;
      listeners.forEach((l) => l());
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export interface PerfReport {
  fps: number;
  worstFrameMs: number;
  framesOver33ms: number;
  longTasks: number;
  longTaskMs: number;
  timers: Record<string, { count: number; avgMs: number; maxMs: number; totalMs: number }>;
}

export const perfReport = (): PerfReport => {
  const timers: PerfReport['timers'] = {};
  stats.forEach((s, name) => {
    timers[name] = { count: s.count, avgMs: s.count ? +(s.total / s.count).toFixed(2) : 0, maxMs: +s.max.toFixed(2), totalMs: +s.total.toFixed(1) };
  });
  return {
    fps: frames.fps,
    worstFrameMs: +frames.worst.toFixed(1),
    framesOver33ms: frames.over33,
    longTasks: frames.longTasks,
    longTaskMs: Math.round(frames.longTaskMs),
    timers,
  };
};

export const perfReset = (): void => {
  stats.clear();
  frames.worst = 0;
  frames.over33 = 0;
  frames.longTasks = 0;
  frames.longTaskMs = 0;
  listeners.forEach((l) => l());
};

try {
  if (typeof location !== 'undefined' && /[?&]perf=1\b/.test(location.search)) setPerfEnabled(true);
} catch { /* no location */ }
