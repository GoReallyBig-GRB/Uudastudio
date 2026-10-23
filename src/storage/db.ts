/**
 * X-PRO AUDIO - IndexedDB & Project Persistence
 * Stores audio assets and project JSON locally for instant restore across page refreshes.
 */

import { Project, Asset, StoredAsset } from '../types';
import { AudioEngine } from '../audio/engine';

const DB_NAME = 'xpro_audio_db';
const DB_VERSION = 1;
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
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
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
  const channels: Float32Array[] = [];
  const buffer = asset.buffer;
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
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadAllAssetsFromDB(engine: AudioEngine): Promise<Asset[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readonly');
    const req = tx.objectStore(STORE_ASSETS).getAll();

    req.onsuccess = () => {
      const storedList: StoredAsset[] = req.result || [];
      const assets: Asset[] = [];
      for (const item of storedList) {
        try {
          const asset = deserializeAsset(item, engine);
          if (asset) assets.push(asset);
        } catch {
          // ignore individual asset decode failures
        }
      }
      resolve(assets);
    };
    req.onerror = () => reject(req.error);
  });
}

export const MAX_SESSION_AGE_MS = 5 * 60 * 1000; // 5 minutes

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
  try {
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
    });
  } catch {
    return null;
  }
}

async function validateSessionProject(
  db: IDBDatabase,
  key: IDBValidKey,
  stored: Project & { updatedAt?: number }
): Promise<Project | null> {
  const savedAt = stored.updatedAt || 0;
  if (Date.now() - savedAt > MAX_SESSION_AGE_MS) {
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

/**
 * Removes expired project snapshots and old audio assets that are not referenced by any
 * remaining per-tab project snapshot. Newly written audio gets a 24-hour grace period to
 * avoid racing another tab between asset persistence and its next autosave.
 */
export async function cleanupOrphanedAssets(now = Date.now()): Promise<{ removedAssets: number }> {
  const db = await openDB();
  let removedAssets = 0;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_PROJECT, STORE_ASSETS], 'readwrite');
    const projectStore = tx.objectStore(STORE_PROJECT);
    const assetStore = tx.objectStore(STORE_ASSETS);
    const projectsRequest = projectStore.getAll();
    const assetsRequest = assetStore.getAll();
    let ready = 0;
    let projects: Array<(Project & { updatedAt?: number }) | undefined> = [];
    let assets: Array<StoredAsset & { storedAt?: number }> = [];

    const processIfReady = () => {
      ready++;
      if (ready !== 2) return;

      // Include all saved tabs, including stale snapshots, before deciding whether an
      // asset is orphaned. Never delete another tab's recovery data as a side effect.
      const referencedAssetIds = new Set<string>();
      for (const project of projects) {
        if (!project) continue;
        for (const track of project.tracks || []) {
          for (const clip of track.clips || []) {
            if (clip.assetId) referencedAssetIds.add(clip.assetId);
            for (const version of clip.versionHistory || []) if (version.assetId) referencedAssetIds.add(version.assetId);
          }
        }
      }

      for (const asset of assets) {
        if (!referencedAssetIds.has(asset.id) && typeof asset.storedAt === 'number' &&
            now - asset.storedAt > ORPHAN_ASSET_GRACE_MS) {
          assetStore.delete(asset.id);
          removedAssets++;
        }
      }
    };

    projectsRequest.onsuccess = () => { projects = projectsRequest.result; processIfReady(); };
    assetsRequest.onsuccess = () => { assets = assetsRequest.result; processIfReady(); };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return { removedAssets };
}

export async function clearAllProjectData(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_PROJECT, STORE_ASSETS], 'readwrite');
    tx.objectStore(STORE_PROJECT).clear();
    tx.objectStore(STORE_ASSETS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
