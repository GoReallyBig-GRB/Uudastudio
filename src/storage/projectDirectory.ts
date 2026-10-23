/** Persist the user's chosen project root folder handle when the browser supports it. */
export interface ProjectDirectoryHandle {
  readonly name: string;
  queryPermission?(descriptor?: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor?: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<ProjectDirectoryFileHandle>;
  values(): AsyncIterableIterator<ProjectDirectoryEntryHandle>;
}

export interface ProjectDirectoryFileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<ProjectDirectoryHandle>;
}

const DB_NAME = 'uuda_project_directory_settings';
const STORE_NAME = 'settings';
const ROOT_KEY = 'project_root_directory';

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

export async function chooseProjectRootDirectory(): Promise<ProjectDirectoryHandle> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('Folder access is not supported in this browser. Use Save As to choose a project file instead.');
  const directory = await picker({ id: 'uuda-project-root', mode: 'readwrite' });
  const permission = directory.requestPermission ? await directory.requestPermission({ mode: 'readwrite' }) : 'granted';
  if (permission !== 'granted') throw new Error('Write permission was not granted for the selected folder.');
  const db = await openSettingsDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(directory, ROOT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not remember the selected folder.'));
  });
  db.close();
  return directory;
}

export async function loadProjectRootDirectory(): Promise<ProjectDirectoryHandle | null> {
  try {
    const db = await openSettingsDb();
    const directory = await new Promise<ProjectDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(ROOT_KEY);
      request.onsuccess = () => resolve((request.result as ProjectDirectoryHandle | undefined) || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
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
