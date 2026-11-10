/** Where a received or recorded file can go, and how long the server keeps it. No network calls except fetching the file itself. */

const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const FOLDER = 'Uuda Jobs';

export interface Expiry { text: string; soon: boolean; gone: boolean }

/** "Kept on the server until 9 Dec (30 days left). Save your own copy." */
export const expiryLine = (expiresAt: number | undefined, now = Date.now()): Expiry | null => {
  if (!expiresAt) return null;
  const left = expiresAt - now;
  if (left <= 0) return { text: 'This file has expired and was deleted from the server.', soon: true, gone: true };
  const d = new Date(expiresAt);
  const days = Math.ceil(left / DAY);
  const when = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return { text: `Kept on the server until ${when} (${days === 1 ? '1 day' : `${days} days`} left), then deleted. Save your own copy.`, soon: days <= 7, gone: false };
};

type DirPicker = (o?: { mode?: 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
const picker = (): DirPicker | null => {
  const f = (window as unknown as { showDirectoryPicker?: DirPicker }).showDirectoryPicker;
  return typeof f === 'function' ? f.bind(window) : null;
};
/** Chrome and Edge on a computer can save into a folder the person chooses; nothing else can */
export const canPickFolder = (): boolean => picker() !== null;

let chosen: FileSystemDirectoryHandle | null = null;

const viaDownload = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
};

/**
 * Saves to this computer. Where the browser allows it, the person picks a folder once and the file goes into a "Uuda Jobs"
 * folder inside it. Browsers never allow writing to a computer's top-level folders, so there is no way to skip the choice.
 * Everywhere else the file goes to the browser's Downloads folder.
 */
export const saveToComputer = async (blob: Blob, name: string): Promise<string> => {
  const pick = picker();
  if (pick) {
    try {
      if (!chosen) chosen = await pick({ mode: 'readwrite' });
      const dir = await chosen.getDirectoryHandle(FOLDER, { create: true });
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await w.write(blob); await w.close();
      return `Saved to ${chosen.name} / ${FOLDER}.`;
    } catch (e) {
      chosen = null;
      if (e instanceof DOMException && e.name === 'AbortError') return '';
      // Some folders (Documents root, Downloads, system folders) are refused: fall through to a normal download
    }
  }
  viaDownload(blob, name);
  return 'Saved to your Downloads folder.';
};

export const canShareFile = (blob: Blob, name: string): boolean => {
  try { return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([blob], name, { type: blob.type || 'audio/wav' })] }); } catch { return false; }
};

/** Opens the device's own save menu (iCloud Drive, Google Drive, Dropbox, Files). Returns '' if the person cancelled. */
export const saveToCloud = async (blob: Blob, name: string): Promise<string> => {
  if (!canShareFile(blob, name)) { viaDownload(blob, name); return 'This browser has no cloud save menu, so the file went to your Downloads folder. Upload it from there.'; }
  try { await navigator.share({ files: [new File([blob], name, { type: blob.type || 'audio/wav' })], title: name }); return 'Sent to the save menu.'; }
  catch (e) { if (e instanceof DOMException && e.name === 'AbortError') return ''; throw e; }
};
