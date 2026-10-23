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
const PROJECT_KEY = 'active_session';

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
  const channels: ArrayBuffer[] = [];
  const buffer = asset.buffer;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const chData = buffer.getChannelData(c);
    // Clone Float32Array buffer so it can be stored in IndexedDB
    const copy = new Float32Array(chData);
    channels.push(copy.buffer);
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
      const f32 = new Float32Array(stored.channels[c]);
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
  const stored = serializeAsset(asset);
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

export async function saveProjectToDB(project: Project): Promise<void> {
  const db = await openDB();
  const projectWithTimestamp = {
    ...project,
    updatedAt: Date.now(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECT, 'readwrite');
    tx.objectStore(STORE_PROJECT).put(projectWithTimestamp, PROJECT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadProjectFromDB(): Promise<Project | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECT, 'readonly');
      const req = tx.objectStore(STORE_PROJECT).get(PROJECT_KEY);
      req.onsuccess = () => {
        const stored = req.result as Project | undefined;
        // Never discard recoverable project data solely because it is older than
        // an arbitrary session-age threshold. Recovery is user work, not a cache.
        resolve(stored ?? null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
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
