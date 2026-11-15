/**
 * Installing Uuda Studio as an app makes saved files open with a double-click, in this same browser profile
 * (so you are already signed in), and gives them the Uuda icon.
 */
import { useSyncExternalStore } from 'react';

interface InstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallPromptEvent; emit(); });
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; emit(); });
}

export const isRunningAsApp = (): boolean =>
  typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: window-controls-overlay)').matches);

export const canInstallApp = (): boolean => !installed && !isRunningAsApp() && deferred !== null;

export async function installApp(): Promise<boolean> {
  if (!deferred) return false;
  const ev = deferred;
  deferred = null; emit();
  await ev.prompt();
  const choice = await ev.userChoice;
  return choice.outcome === 'accepted';
}

export function useCanInstallApp(): boolean {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    canInstallApp,
    () => false,
  );
}
