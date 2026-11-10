/** Where a received or recorded file can go, and how long the server keeps it. No network calls except fetching the file itself. */

const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

import { canUseStudioFolder, saveToStudio } from './studioFolder';

/** Chrome and Edge on a computer can keep a Uuda Studio folder; other browsers use Downloads */
export const canPickFolder = canUseStudioFolder;

const viaDownload = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
};

/**
 * Saves to this computer. In Chrome and Edge the file goes into the person's Uuda Studio folder, in a sub-folder named by `path`
 * (they choose where that folder lives once; it is remembered). Elsewhere it goes to the browser's Downloads folder.
 */
export const saveToComputer = async (blob: Blob, name: string, path: string[] = ['Jobs'], o: { choose?: boolean } = {}): Promise<string> => {
  const where = await saveToStudio(blob, name, path, { ask: true, choose: o.choose });
  if (where === '') return '';
  if (where) return `Saved to ${where}`;
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
