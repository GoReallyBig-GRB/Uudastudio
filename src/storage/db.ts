/**
 * X-PRO AUDIO - IndexedDB & Project Persistence
 * Stores audio assets and project JSON locally for instant restore across page refreshes.
 */

import { Project, Asset, StoredAsset } from '../types';
import { AudioEngine } from '../audio/engine';
import { deleteStreamedAsset, listStreamedAssetIds, readStreamedMeta } from '../assets/streamedStore';

const DB_NAME = 'xpro_audio_db';
// Version 2 adds a `storedAt` index so cleanup can read ages and ids without loading any audio.
const DB_VERSION = 2;
const INDEX_STORED_AT = 'storedAt';
const STORE_ASSETS = 'assets';
const STORE_PROJECT = 'project';
const LEGACY_PROJECT_KEY = 'active_session';
const PROJECT_KEY_PREFIX = 'session:';
const SESSION_ID_STORAGE_KEY = 'uuda_project_session_id';
const LEGACY_MIGRATION_FLAG = 'uuda_project_legacy_migrated';
const ORPHAN_ASSET_GRACE_MS = 24 * 60 * 60 * 1000;
let fallbackSessionId: string | null = null;

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Starts an isolated autosave slot, used by the explicit "new project in new tab" flow. */
export function startNewProjectSession(): void {
  const id = createSessionId();
  fallbackSessionId = id;
  try {
    window.sessionStorage.setItem(SESSION_ID_STORAGE_KEY, id);
    window.sessionStorage.setItem(LEGACY_MIGRATION_FLAG, 'true');
  } catch {
    // The in-memory fallback still isolates writes for this live page if storage is blocked.
  }
}

/** Pure key helper so session isolation has a deterministic contract. */
export function projectStorageKeyForSession(sessionId: string): string {
  return `${PROJECT_KEY_PREFIX}${sessionId}`;
}

function getCurrentProjectKey(): string {
  try {
    let id = window.sessionStorage.getItem(SESSION_ID_STORAGE_KEY);
    if (!id) {
      id = createSessionId();
      window.sessionStorage.setItem(SESSION_ID_STORAGE_KEY, id);
    }
    fallbackSessionId = id;
    return projectStorageKeyForSession(id);
  } catch {
    fallbackSessionId ??= createSessionId();
    return projectStorageKeyForSession(fallbackSessionId);
  }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      let assetStore: IDBObjectStore | null = null;
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        assetStore = db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
      } else {
        assetStore = request.transaction ? request.transaction.objectStore(STORE_ASSETS) : null;
      }
      // Built by the browser from existing records; no audio is read into the page.
      if (assetStore && !assetStore.indexNames.contains(INDEX_STORED_AT)) {
        assetStore.createIndex(INDEX_STORED_AT, INDEX_STORED_AT);
      }
      if (!db.objectStoreNames.contains(STORE_PROJECT)) {
        db.createObjectStore(STORE_PROJECT);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Serialize an AudioBuffer into raw ArrayBuffers for IndexedDB storage
 */
export function serializeAsset(asset: Asset): StoredAsset {
  if (asset.source) {
    // Long audio lives in file storage; the database keeps only a small pointer record.
    return {
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      sampleRate: asset.sampleRate,
      durationSeconds: asset.durationSeconds,
      numberOfChannels: asset.numberOfChannels,
      channels: [],
      streamed: asset.source,
    };
  }
  const buffer = asset.buffer;
  if (!buffer) throw new Error(`Asset "${asset.id}" has no audio data to save.`);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    // IndexedDB structured-clones typed arrays on put; avoid an additional full-channel copy here.
    channels.push(buffer.getChannelData(c));
  }

  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    sampleRate: asset.sampleRate,
    durationSeconds: asset.durationSeconds,
    numberOfChannels: asset.numberOfChannels,
    channels,
  };
}

/**
 * Recreate an AudioBuffer from stored ArrayBuffers
 */
export function deserializeAsset(stored: StoredAsset, engine: AudioEngine): Asset | null {
  if (stored.streamed) {
    return {
      id: stored.id,
      name: stored.name,
      kind: stored.kind,
      source: stored.streamed,
      sampleRate: stored.sampleRate,
      durationSeconds: stored.durationSeconds,
      numberOfChannels: stored.numberOfChannels,
    };
  }
  const ctx = engine.getContext();
  const sampleRate = stored.sampleRate || 48000;
  const length = Math.round(stored.durationSeconds * sampleRate);

  let buffer: AudioBuffer;
  if (ctx) {
    buffer = ctx.createBuffer(stored.numberOfChannels, Math.max(1, length), sampleRate);
  } else {
    const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const tempCtx = new AudioCtxClass();
    buffer = tempCtx.createBuffer(stored.numberOfChannels, Math.max(1, length), sampleRate);
  }

  for (let c = 0; c < stored.numberOfChannels; c++) {
    if (stored.channels[c]) {
      const channel = stored.channels[c];
      const f32 = channel instanceof Float32Array ? channel : new Float32Array(channel);
      buffer.getChannelData(c).set(f32);
    }
  }

  return {
    id: stored.id,
    name: stored.name,
    kind: stored.kind,
    buffer,
    sampleRate: stored.sampleRate,
    durationSeconds: stored.durationSeconds,
    numberOfChannels: stored.numberOfChannels,
  };
}

export async function saveAssetToDB(asset: Asset): Promise<void> {
  const db = await openDB();
  const stored = { ...serializeAsset(asset), storedAt: Date.now() };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readwrite');
    tx.objectStore(STORE_ASSETS).put(stored);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteAssetFromDB(assetId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readwrite');
    tx.objectStore(STORE_ASSETS).delete(assetId);
    tx.oncomplete = () => { void deleteStreamedAsset(assetId); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

/** Every asset id a project refers to: clips and their version history. Pure, so it can be tested. */
export function collectProjectAssetIds(project: Pick<Project, 'tracks'> | null | undefined): Set<string> {
  const ids = new Set<string>();
  for (const track of project?.tracks || []) {
    for (const clip of track.clips || []) {
      if (clip.assetId) ids.add(clip.assetId);
      for (const version of clip.versionHistory || []) {
        if (version.assetId) ids.add(version.assetId);
      }
    }
  }
  return ids;
}

/**
 * Reads ONE stored asset by id and rebuilds its AudioBuffer. Only the requested record is read, so memory
 * stays proportional to what the open project actually uses, never to everything ever saved.
 */
export async function loadAssetFromDB(assetId: string, engine: AudioEngine): Promise<Asset | null> {
  const db = await openDB();
  const stored = await new Promise<StoredAsset | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readonly');
    const req = tx.objectStore(STORE_ASSETS).get(assetId);
    req.onsuccess = () => resolve(req.result as StoredAsset | undefined);
    req.onerror = () => reject(req.error);
  });
  if (!stored) return null;
  try {
    const asset = deserializeAsset(stored, engine);
    // A pointer without its files (browser data cleared, import never finished) counts as a missing asset.
    if (asset?.source && !(await readStreamedMeta(asset.source.storeId))) return null;
    return asset;
  } catch {
    return null;
  }
}

/** How many assets are stored. Counts records without reading any audio. */
export async function countStoredAssets(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_ASSETS, 'readonly').objectStore(STORE_ASSETS).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// Restore safety brake: if the page was closed or killed while restoring audio, do not repeat the same
// work on the next launch (which would freeze the computer again).
// ---------------------------------------------------------------------------
const RESTORE_PENDING_KEY = 'uuda:restore-pending';
export const RESTORE_PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type SimpleStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): SimpleStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Identifies this page load, so a second restore attempt in the same page (for example React's development
// double-mount) is never mistaken for an earlier launch that failed.
const PAGE_LOAD_ID = createSessionId();

export function markRestorePending(
  now = Date.now(),
  storage: SimpleStorage | null = defaultStorage(),
  pageId = PAGE_LOAD_ID
): void {
  try { storage?.setItem(RESTORE_PENDING_KEY, `${pageId}|${now}`); } catch { /* storage may be blocked */ }
}

export function clearRestorePending(storage: SimpleStorage | null = defaultStorage()): void {
  try { storage?.removeItem(RESTORE_PENDING_KEY); } catch { /* storage may be blocked */ }
}

/** True when an EARLIER page load started restoring audio and never finished. */
export function didPreviousRestoreFail(
  now = Date.now(),
  storage: SimpleStorage | null = defaultStorage(),
  pageId = PAGE_LOAD_ID
): boolean {
  try {
    const raw = storage?.getItem(RESTORE_PENDING_KEY);
    if (!raw) return false;
    const [markedBy, stamp] = raw.split('|');
    if (markedBy === pageId) return false;
    const startedAt = Number(stamp);
    if (!Number.isFinite(startedAt)) return false;
    return now - startedAt >= 0 && now - startedAt < RESTORE_PENDING_MAX_AGE_MS;
  } catch {
    return false;
  }
}

export const MAX_SESSION_AGE_MS = 5 * 60 * 1000; // 5 minutes

/** Pure expiry rule shared by restore and orphan-cleanup paths. */
export function isSessionProjectExpired(updatedAt: number | undefined, now = Date.now()): boolean {
  const savedAt = typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : 0;
  return now - savedAt > MAX_SESSION_AGE_MS;
}

export async function saveProjectToDB(project: Project): Promise<void> {
  const db = await openDB();
  const projectWithTimestamp = {
    ...project,
    updatedAt: Date.now(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECT, 'readwrite');
    tx.objectStore(STORE_PROJECT).put(projectWithTimestamp, getCurrentProjectKey());
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadProjectFromDB(): Promise<Project | null> {
  const db = await openDB();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECT, 'readonly');
    const store = tx.objectStore(STORE_PROJECT);
    const currentKey = getCurrentProjectKey();
    const req = store.get(currentKey);
    req.onsuccess = () => {
      const current = req.result as (Project & { updatedAt?: number }) | undefined;
      if (current) {
        void validateSessionProject(db, currentKey, current).then(resolve, reject);
        return;
      }
      // Migrate the old shared key once per tab. Explicit new-tab sessions set this
      // marker already, so they can never fall back into another tab's legacy project.
      let alreadyMigrated = false;
      try { alreadyMigrated = window.sessionStorage.getItem(LEGACY_MIGRATION_FLAG) === 'true'; } catch {}
      if (alreadyMigrated) {
        resolve(null);
        return;
      }
      const legacyReq = store.get(LEGACY_PROJECT_KEY);
      legacyReq.onsuccess = () => {
        const legacy = legacyReq.result as (Project & { updatedAt?: number }) | undefined;
        if (!legacy) {
          resolve(null);
          return;
        }
        void validateSessionProject(db, LEGACY_PROJECT_KEY, legacy).then(async (valid) => {
          if (!valid) {
            resolve(null);
            return;
          }
          try {
            await saveProjectToDB(valid);
            window.sessionStorage.setItem(LEGACY_MIGRATION_FLAG, 'true');
          } catch {
            // The compatibility read still works for this page if migration storage fails.
          }
          resolve(valid);
        }, reject);
      };
      legacyReq.onerror = () => reject(legacyReq.error);
    };
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

async function validateSessionProject(
  db: IDBDatabase,
  key: IDBValidKey,
  stored: Project & { updatedAt?: number }
): Promise<Project | null> {
  if (isSessionProjectExpired(stored.updatedAt)) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECT, 'readwrite');
      tx.objectStore(STORE_PROJECT).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return null;
  }
  return stored;
}

/** Clears only this tab's autosave slot; other open tabs keep their recoverable projects. */
export async function clearCurrentProjectData(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECT, 'readwrite');
    tx.objectStore(STORE_PROJECT).delete(getCurrentProjectKey());
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  await cleanupOrphanedAssets();
}

export interface StoredAssetMeta {
  id: string;
  /** Missing on records written before the age marker existed; those are never auto-deleted. */
  storedAt?: number;
}

/**
 * Pure cleanup plan: which snapshots have expired, and which stored audio is referenced by no live snapshot and is
 * older than the grace period. Separate from IndexedDB so the rules can be tested.
 */
export function planCleanup(
  projectKeys: IDBValidKey[],
  projects: Array<(Pick<Project, 'tracks'> & { updatedAt?: number }) | undefined>,
  assets: StoredAssetMeta[],
  now: number,
  graceMs = ORPHAN_ASSET_GRACE_MS
): { expiredProjectKeys: IDBValidKey[]; orphanAssetIds: string[] } {
  const expiredProjectKeys: IDBValidKey[] = [];
  const referenced = new Set<string>();
  for (let index = 0; index < projects.length; index++) {
    const project = projects[index];
    const key = projectKeys[index];
    if (!project || key === undefined) continue;
    // Expire stale per-tab snapshots before counting references, otherwise an abandoned tab's old
    // snapshot could pin orphaned audio forever.
    if (isSessionProjectExpired(project.updatedAt, now)) {
      expiredProjectKeys.push(key);
      continue;
    }
    for (const id of collectProjectAssetIds(project)) referenced.add(id);
  }
  const orphanAssetIds = assets
    .filter((a) => !referenced.has(a.id) && typeof a.storedAt === 'number' && now - a.storedAt > graceMs)
    .map((a) => a.id);
  return { expiredProjectKeys, orphanAssetIds };
}

/** Reads asset ids and ages from the key index only. No audio data is read. */
function readAssetMeta(assetStore: IDBObjectStore, done: (meta: StoredAssetMeta[]) => void, fail: (e: unknown) => void): void {
  const keysReq = assetStore.getAllKeys();
  keysReq.onerror = () => fail(keysReq.error);
  keysReq.onsuccess = () => {
    const ages = new Map<string, number>();
    const cursorReq = assetStore.index(INDEX_STORED_AT).openKeyCursor();
    cursorReq.onerror = () => fail(cursorReq.error);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        if (typeof cursor.key === 'number') ages.set(String(cursor.primaryKey), cursor.key);
        cursor.continue();
        return;
      }
      done((keysReq.result as IDBValidKey[]).map((k) => ({ id: String(k), storedAt: ages.get(String(k)) })));
    };
  };
}

/**
 * Removes expired project snapshots and old audio that no remaining snapshot references. Newly written audio gets a
 * 24-hour grace period to avoid racing another tab between asset persistence and its next autosave.
 *
 * Memory: this used to read every stored audio record into the page just to look at its id and age, which could mean
 * gigabytes at startup. It now reads only keys and the age index.
 */
export async function cleanupOrphanedAssets(now = Date.now()): Promise<{ removedAssets: number }> {
  const db = await openDB();
  let removedAssets = 0;
  let removedIds: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_PROJECT, STORE_ASSETS], 'readwrite');
    const projectStore = tx.objectStore(STORE_PROJECT);
    const assetStore = tx.objectStore(STORE_ASSETS);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);

    const keysReq = projectStore.getAllKeys();
    const projectsReq = projectStore.getAll();
    let projectKeys: IDBValidKey[] | null = null;
    let projects: Array<(Pick<Project, 'tracks'> & { updatedAt?: number }) | undefined> | null = null;
    const proceed = () => {
      if (!projectKeys || !projects) return;
      readAssetMeta(assetStore, (meta) => {
        const plan = planCleanup(projectKeys!, projects!, meta, now);
        for (const key of plan.expiredProjectKeys) projectStore.delete(key);
        for (const id of plan.orphanAssetIds) assetStore.delete(id);
        removedAssets = plan.orphanAssetIds.length;
        removedIds = plan.orphanAssetIds;
      }, reject);
    };
    keysReq.onsuccess = () => { projectKeys = keysReq.result; proceed(); };
    projectsReq.onsuccess = () => { projects = projectsReq.result; proceed(); };
    keysReq.onerror = () => reject(keysReq.error);
    projectsReq.onerror = () => reject(projectsReq.error);
  });

  // Free file-backed audio belonging to removed asset records (no-op for ordinary assets).
  await Promise.all(removedIds.map((id) => deleteStreamedAsset(id)));
  return { removedAssets };
}

export async function clearAllProjectData(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_PROJECT, STORE_ASSETS], 'readwrite');
    tx.objectStore(STORE_PROJECT).clear();
    tx.objectStore(STORE_ASSETS).clear();
    tx.oncomplete = () => {
      void listStreamedAssetIds().then((ids) => Promise.all(ids.map((id) => deleteStreamedAsset(id)))).catch(() => undefined);
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}
