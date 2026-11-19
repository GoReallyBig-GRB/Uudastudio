/** Remembers the last few error messages (text only) so a problem report can include them. Installed once. */
const recent: string[] = [];
let installed = false;
const add = (m: string) => { recent.push(m.slice(0, 200)); if (recent.length > 5) recent.shift(); };
export const recentErrors = (): string[] => [...recent];
export function installErrorLog(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => add(e.message || 'Error'));
  window.addEventListener('unhandledrejection', (e) => add(String((e.reason as { message?: string } | null)?.message ?? e.reason ?? 'Rejected promise')));
}
