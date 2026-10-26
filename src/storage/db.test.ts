import { describe, expect, it } from 'vitest';
import {
  clearRestorePending,
  collectProjectAssetIds,
  didPreviousRestoreFail,
  isSessionProjectExpired,
  markRestorePending,
  MAX_SESSION_AGE_MS,
  planCleanup,
  projectStorageKeyForSession,
  RESTORE_PENDING_MAX_AGE_MS,
  deserializeAsset,
  serializeAsset,
} from './db';
import type { AudioEngine } from '../audio/engine';
import type { Asset } from '../types';

describe('per-tab project autosave lifecycle', () => {
  it('uses a distinct IndexedDB key for each tab session', () => {
    expect(projectStorageKeyForSession('tab-a')).toBe('session:tab-a');
    expect(projectStorageKeyForSession('tab-a')).not.toBe(projectStorageKeyForSession('tab-b'));
  });

  it('keeps a session snapshot while it is within the recovery window', () => {
    const now = 1_800_000_000_000;
    expect(isSessionProjectExpired(now - MAX_SESSION_AGE_MS + 1, now)).toBe(false);
    expect(isSessionProjectExpired(now, now)).toBe(false);
  });

  it('expires snapshots older than the recovery window', () => {
    const now = 1_800_000_000_000;
    expect(isSessionProjectExpired(now - MAX_SESSION_AGE_MS - 1, now)).toBe(true);
  });

  it('treats snapshots without a valid timestamp as expired', () => {
    const now = 1_800_000_000_000;
    expect(isSessionProjectExpired(undefined, now)).toBe(true);
    expect(isSessionProjectExpired(Number.NaN, now)).toBe(true);
  });
});

const clip = (assetId: string, versions: string[] = []) => ({
  assetId,
  versionHistory: versions.map((v) => ({ assetId: v })),
});
const proj = (clips: ReturnType<typeof clip>[], updatedAt?: number) =>
  ({ tracks: [{ clips }], updatedAt }) as never;

describe('startup memory: which audio is needed', () => {
  it('needs nothing for an empty project', () => {
    expect(collectProjectAssetIds({ tracks: [] } as never).size).toBe(0);
    expect(collectProjectAssetIds(null).size).toBe(0);
  });

  it('needs clip assets and version-history assets, each once', () => {
    const ids = collectProjectAssetIds(proj([clip('a', ['a-v1', 'a-v2']), clip('a'), clip('b')]));
    expect([...ids].sort()).toEqual(['a', 'a-v1', 'a-v2', 'b']);
  });
});

describe('orphan cleanup plan (reads ids and ages only)', () => {
  const now = 1_800_000_000_000;
  const DAY = 24 * 60 * 60 * 1000;
  const fresh = now - 1000;

  it('removes old unreferenced audio and keeps referenced, fresh and age-less audio', () => {
    const plan = planCleanup(
      ['session:a'],
      [proj([clip('used')], fresh)],
      [
        { id: 'used', storedAt: now - 5 * DAY },
        { id: 'old-orphan', storedAt: now - 2 * DAY },
        { id: 'new-orphan', storedAt: now - 1000 },
        { id: 'legacy-no-age' },
      ],
      now
    );
    expect(plan.orphanAssetIds).toEqual(['old-orphan']);
    expect(plan.expiredProjectKeys).toEqual([]);
  });

  it('does not let an expired snapshot keep its audio alive', () => {
    const plan = planCleanup(
      ['session:stale'],
      [proj([clip('x')], now - MAX_SESSION_AGE_MS - 1)],
      [{ id: 'x', storedAt: now - 2 * DAY }],
      now
    );
    expect(plan.expiredProjectKeys).toEqual(['session:stale']);
    expect(plan.orphanAssetIds).toEqual(['x']);
  });
});

describe('restore safety brake', () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => { data.set(k, v); },
      removeItem: (k: string) => { data.delete(k); },
    };
  };
  const now = 1_800_000_000_000;

  it('is not tripped when nothing was marked', () => {
    expect(didPreviousRestoreFail(now, memory(), 'page-2')).toBe(false);
  });

  it('trips for an unfinished restore from an earlier page load', () => {
    const store = memory();
    markRestorePending(now - 60_000, store, 'page-1');
    expect(didPreviousRestoreFail(now, store, 'page-2')).toBe(true);
  });

  it('ignores a mark made by this same page load (double mount)', () => {
    const store = memory();
    markRestorePending(now - 1000, store, 'page-1');
    expect(didPreviousRestoreFail(now, store, 'page-1')).toBe(false);
  });

  it('resets once a restore finishes, and ignores very old marks', () => {
    const store = memory();
    markRestorePending(now - 1000, store, 'page-1');
    clearRestorePending(store);
    expect(didPreviousRestoreFail(now, store, 'page-2')).toBe(false);
    markRestorePending(now - RESTORE_PENDING_MAX_AGE_MS - 1, store, 'page-1');
    expect(didPreviousRestoreFail(now, store, 'page-2')).toBe(false);
  });
});

describe('streamed (file-backed) assets', () => {
  const streamed: Asset = {
    id: 'asset-long',
    name: 'long.mp3',
    kind: 'import',
    source: { storeId: 'asset-long', frames: 229537152, peakBaseSamplesPerPixel: 256 },
    sampleRate: 44100,
    durationSeconds: 5205,
    numberOfChannels: 2,
  };

  it('saves only a small pointer record, never audio samples', () => {
    const stored = serializeAsset(streamed);
    expect(stored.channels).toEqual([]);
    expect(stored.streamed).toEqual(streamed.source);
    expect(stored.durationSeconds).toBe(5205);
  });

  it('restores a pointer record as an asset with a source and no in-memory buffer', () => {
    const restored = deserializeAsset(serializeAsset(streamed), {} as AudioEngine)!;
    expect(restored.source).toEqual(streamed.source);
    expect(restored.buffer === undefined).toBe(true);
    expect(restored.numberOfChannels).toBe(2);
  });

  it('refuses to save an asset that has neither audio nor a source', () => {
    let message = '';
    try { serializeAsset({ ...streamed, source: undefined }); } catch (e) { message = (e as Error).message; }
    expect(message.includes('no audio data')).toBe(true);
  });
});
