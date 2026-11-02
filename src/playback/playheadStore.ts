/**
 * The playhead position, kept outside React state.
 *
 * While playing, the position changes many times a second. Held in App state it re-rendered the whole app (every panel,
 * the toolbar, the timeline) for a number only a few places show. Here only the components that show or follow the
 * playhead subscribe to it; everything else is left alone.
 */
import { useSyncExternalStore } from 'react';

let value = 0;
const listeners = new Set<() => void>();

export const getPlayhead = (): number => value;

export const setPlayhead = (seconds: number): void => {
  if (seconds === value) return;
  value = seconds;
  for (const l of [...listeners]) l();
};

export const subscribePlayhead = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** The current playhead; re-renders only the component that calls it */
export const usePlayhead = (): number => useSyncExternalStore(subscribePlayhead, getPlayhead, getPlayhead);
