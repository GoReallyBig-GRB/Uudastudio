/** Receives the files Windows/macOS hand to the installed app when someone double-clicks a .uuda file. */

interface LaunchParams { files?: Array<{ getFile(): Promise<File> }> }
interface LaunchQueueLike { setConsumer(cb: (p: LaunchParams) => void): void }

export type LaunchedKind = 'project' | 'template';

export function launchedKind(name: string): LaunchedKind | null {
  const n = name.toLowerCase();
  if (n.endsWith('.uuda-template')) return 'template';
  if (n.endsWith('.uuda')) return 'project';
  return null;
}

/** Returns true when this browser can hand files to the app */
export function onLaunchedFiles(handler: (file: File, kind: LaunchedKind) => void): boolean {
  const q = (typeof window !== 'undefined' ? (window as unknown as { launchQueue?: LaunchQueueLike }).launchQueue : undefined);
  if (!q) return false;
  q.setConsumer(async (params) => {
    for (const h of params.files ?? []) {
      try {
        const file = await h.getFile();
        const kind = launchedKind(file.name);
        if (kind) handler(file, kind);
      } catch { /* unreadable file: ignore */ }
    }
  });
  return true;
}
