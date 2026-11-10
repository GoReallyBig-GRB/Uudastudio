/**
 * The "Uuda Studio" folder on the person's computer. They choose where it lives once (Chrome and Edge); the browser is asked to
 * remember it, and every saved file then goes into it, organised: Uuda Studio / Jobs / <job name> / file, Uuda Studio / Exports / file,
 * Projects, Templates.
 * A browser never lets a page write outside a folder the person picked, so the pick is what makes the folder possible.
 */

import { STUDIO_FOLDER_NAME, chooseProjectRootDirectory, forgetProjectRootDirectory, loadProjectRootDirectory } from '../storage/projectDirectory';

export const ROOT_NAME = STUDIO_FOLDER_NAME;

type Dir = FileSystemDirectoryHandle;
type Picker = (o?: { id?: string; mode?: 'readwrite'; startIn?: string }) => Promise<Dir>;
type WithPerm = Dir & { queryPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>; requestPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState> };

const picker = (): Picker | null => {
  const f = (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker;
  return typeof f === 'function' ? f.bind(window) : null;
};
export const canUseStudioFolder = (): boolean => picker() !== null;

/** A safe single folder or file name: no slashes or characters Windows refuses, no leading dots, never empty */
export const cleanName = (n: string, fallback = 'Untitled'): string => {
  const s = n.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').replace(/[. ]+$/, '').slice(0, 80);
  return s || fallback;
};

/** "take.wav" taken -> "take (2).wav", "take (3).wav" ... so nothing is ever overwritten */
export const uniqueName = (name: string, taken: ReadonlySet<string>): string => {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) { const c = `${stem} (${i})${ext}`; if (!taken.has(c)) return c; }
};

/** Writes the file under root/path/…, creating folders as needed. Returns the path shown to the person. */
export const writeInto = async (root: Dir, path: string[], name: string, blob: Blob): Promise<string> => {
  let dir = root;
  const shown: string[] = [root.name];
  for (const part of path) { const p = cleanName(part); dir = await dir.getDirectoryHandle(p, { create: true }); shown.push(p); }
  const taken = new Set<string>();
  for await (const k of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) taken.add(k);
  const file = uniqueName(cleanName(name, 'recording.wav'), taken);
  const w = await (await dir.getFileHandle(file, { create: true })).createWritable();
  await w.write(blob); await w.close();
  return `${shown.join(' / ')} / ${file}`;
};

// The folder is the same one the project save and "Open from Uuda Studio" use (see storage/projectDirectory.ts)
const remembered = async (): Promise<WithPerm | null> => (await loadProjectRootDirectory()) as unknown as WithPerm | null;
export const forgetStudioFolder = (): Promise<void> => forgetProjectRootDirectory();

/** The folder's name if one is remembered (so the menu can say where files will go) */
export const studioFolderLabel = async (): Promise<string> => { const h = await remembered(); return h ? `${h.name}` : ''; };

const granted = async (h: WithPerm, ask: boolean): Promise<boolean> => {
  try {
    if ((await h.queryPermission?.({ mode: 'readwrite' })) === 'granted') return true;
    return ask && (await h.requestPermission?.({ mode: 'readwrite' })) === 'granted';
  } catch { return false; }
};

/**
 * Finds the Uuda Studio folder. `ask` lets it show the browser's questions (needs a tap just made by the person); without it,
 * it only returns a folder that can already be written to. `choose` forces the folder picker, to move the folder.
 */
export const getStudioFolder = async (o: { ask: boolean; choose?: boolean; existing?: boolean }): Promise<Dir | null> => {
  const pick = picker();
  if (!pick) return null;
  if (!o.choose) {
    const h = await remembered();
    if (h && (await granted(h, o.ask))) return h;
    if (!o.ask || o.existing) return null;
  } else if (!o.ask) return null;
  return (await chooseProjectRootDirectory()) as unknown as WithPerm;
};

/**
 * Saves into the Uuda Studio folder (`existing`: only if one was already chosen). Returns the shown path, '' if the person cancelled, or null if this browser cannot
 * (or refuses the folder), in which case the caller falls back to a normal download.
 */
export const saveToStudio = async (blob: Blob, name: string, path: string[], o: { ask: boolean; choose?: boolean; existing?: boolean }): Promise<string | null> => {
  try {
    const root = await getStudioFolder(o);
    if (!root) return null;
    return await writeInto(root, path, name, blob);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return '';
    await forgetStudioFolder();
    return null;
  }
};

const plain = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none'; a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  window.setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
};

/**
 * Saves a file into the Uuda Studio folder if the person has chosen one and the browser still allows writing there,
 * otherwise as a normal download. Returns where it went, for a message.
 */
export const saveOrDownload = async (blob: Blob, name: string, path: string[]): Promise<{ where: string; inFolder: boolean }> => {
  try {
    const where = await saveToStudio(blob, name, path, { ask: true, existing: true });
    if (where) return { where, inFolder: true };
  } catch { /* fall through */ }
  plain(blob, name);
  return { where: 'your Downloads folder', inFolder: false };
};
