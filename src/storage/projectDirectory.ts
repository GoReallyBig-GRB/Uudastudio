/**
 * The Uuda Studio folder: the one place on the person's computer where projects (.uuda), mixdowns, exports, templates and job
 * files are saved. They choose where it lives once; the browser remembers it. Sub-folders keep things tidy:
 * Projects, Exports, Templates, Jobs. A folder chosen by an earlier version keeps working as the root.
 */
export interface ProjectDirectoryHandle {
  readonly name: string;
  queryPermission?(descriptor?: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor?: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<ProjectDirectoryFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<ProjectDirectoryHandle>;
  values(): AsyncIterableIterator<ProjectDirectoryEntryHandle>;
}

export interface ProjectDirectoryFileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }) => Promise<ProjectDirectoryHandle>;
}

const DB_NAME = 'uuda_project_directory_settings';
const STORE_NAME = 'settings';
const ROOT_KEY = 'project_root_directory';
export const STUDIO_FOLDER_NAME = 'Uuda Studio';

function openSettingsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open folder settings storage.'));
  });
}

let cachedRoot: ProjectDirectoryHandle | null = null;

export async function chooseProjectRootDirectory(): Promise<ProjectDirectoryHandle> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('Folder access is not supported in this browser. Use Save As to choose a project file instead.');
  const picked = await picker({ id: 'uuda-project-root', mode: 'readwrite', startIn: 'documents' });
  const permission = picked.requestPermission ? await picked.requestPermission({ mode: 'readwrite' }) : 'granted';
  if (permission !== 'granted') throw new Error('Write permission was not granted for the selected folder.');
  // Inside the chosen place, make (or reuse) a folder called Uuda Studio, unless they already picked one with that name
  const directory = picked.name === STUDIO_FOLDER_NAME ? picked : await picked.getDirectoryHandle(STUDIO_FOLDER_NAME, { create: true });
  const db = await openSettingsDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(directory, ROOT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not remember the selected folder.'));
  });
  db.close();
  cachedRoot = directory;
  return directory;
}

export async function loadProjectRootDirectory(): Promise<ProjectDirectoryHandle | null> {
  if (cachedRoot) return cachedRoot;
  try {
    const db = await openSettingsDb();
    const directory = await new Promise<ProjectDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(ROOT_KEY);
      request.onsuccess = () => resolve((request.result as ProjectDirectoryHandle | undefined) || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    cachedRoot = directory;
    return directory;
  } catch {
    return null;
  }
}

export async function ensureProjectDirectoryPermission(directory: ProjectDirectoryHandle): Promise<boolean> {
  const descriptor = { mode: 'readwrite' as const };
  const current = directory.queryPermission ? await directory.queryPermission(descriptor) : 'granted';
  if (current === 'granted') return true;
  if (!directory.requestPermission) return false;
  return (await directory.requestPermission(descriptor)) === 'granted';
}

export interface ProjectDirectoryEntryHandle {
  readonly kind: 'file' | 'directory';
  readonly name: string;
  getFile?(): Promise<File>;
}

export async function forgetProjectRootDirectory(): Promise<void> {
  cachedRoot = null;
  try {
    const db = await openSettingsDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(ROOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch { /* nothing to forget */ }
}

/** A sub-folder of the Uuda Studio folder, created if missing */
export const studioSubfolder = (root: ProjectDirectoryHandle, name: string): Promise<ProjectDirectoryHandle> => root.getDirectoryHandle(name, { create: true });
