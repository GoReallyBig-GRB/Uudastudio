/**
 * Keeps a recording on the talent's device while it is being made, in small pieces, so a reload, a phone call or a crash
 * leaves a recoverable take. Uses IndexedDB; every call is safe to fail (private windows can block it), and the page
 * still records, it just cannot offer recovery.
 */

const DB = 'uuda-guest-takes';
const open = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('chunks'); r.result.createObjectStore('sessions', { keyPath: 'id' }); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const done = (tx: IDBTransaction): Promise<void> => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
const req = <T,>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export interface SavedSession {
  id: string;
  /** Which job the recording belongs to */
  jobKey: string;
  sampleRate: number;
  /** 16 when missing (takes saved before 24-bit existed) */
  bits?: 16 | 24;
  startedAt: number;
  chunkCount: number;
  /** True once Stop was pressed; false means the take was interrupted */
  finished: boolean;
}

const pad = (n: number) => String(n).padStart(8, '0');

export const beginSession = async (s: Omit<SavedSession, 'chunkCount' | 'finished'>): Promise<void> => {
  try {
    const db = await open();
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put({ ...s, chunkCount: 0, finished: false });
    await done(tx);
  } catch { /* recovery unavailable */ }
};

export const saveChunk = async (id: string, index: number, pcm: Int16Array | Int32Array): Promise<void> => {
  try {
    const db = await open();
    const tx = db.transaction(['chunks', 'sessions'], 'readwrite');
    tx.objectStore('chunks').put(pcm, `${id}:${pad(index)}`);
    const sessions = tx.objectStore('sessions');
    const cur = (await req(sessions.get(id))) as SavedSession | undefined;
    if (cur) sessions.put({ ...cur, chunkCount: Math.max(cur.chunkCount, index + 1) });
    await done(tx);
  } catch { /* recovery unavailable */ }
};

export const finishSession = async (id: string): Promise<void> => {
  try {
    const db = await open();
    const tx = db.transaction('sessions', 'readwrite');
    const cur = (await req(tx.objectStore('sessions').get(id))) as SavedSession | undefined;
    if (cur) tx.objectStore('sessions').put({ ...cur, finished: true });
    await done(tx);
  } catch { /* recovery unavailable */ }
};

export const loadSession = async (id: string): Promise<(Int16Array | Int32Array)[]> => {
  try {
    const db = await open();
    const tx = db.transaction('chunks', 'readonly');
    const range = IDBKeyRange.bound(`${id}:`, `${id}:￿`);
    return (await req(tx.objectStore('chunks').getAll(range))) as (Int16Array | Int32Array)[];
  } catch { return []; }
};

/** The newest saved recording for this job (finished or interrupted), if any */
export const findSaved = async (jobKey: string): Promise<SavedSession | null> => {
  try {
    const db = await open();
    const all = (await req(db.transaction('sessions', 'readonly').objectStore('sessions').getAll())) as SavedSession[];
    return all.filter((s) => s.jobKey === jobKey && s.chunkCount > 0).sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
  } catch { return null; }
};

export const deleteSession = async (id: string): Promise<void> => {
  try {
    const db = await open();
    const tx = db.transaction(['chunks', 'sessions'], 'readwrite');
    tx.objectStore('chunks').delete(IDBKeyRange.bound(`${id}:`, `${id}:￿`));
    tx.objectStore('sessions').delete(id);
    await done(tx);
  } catch { /* nothing to remove */ }
};
