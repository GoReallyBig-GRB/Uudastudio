/** How much room the browser gives Uuda, in plain words */

export const formatBytes = (n: number): string => {
  if (!Number.isFinite(n) || n < 0) return '0 MB';
  if (n < 1024 * 1024) return `${Math.max(0, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
};

export interface StorageUse { used: number; quota: number; persistent: boolean | null }

export const readStorage = async (): Promise<StorageUse | null> => {
  try {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    const persistent = navigator.storage.persisted ? await navigator.storage.persisted() : null;
    return { used: e.usage ?? 0, quota: e.quota ?? 0, persistent };
  } catch { return null; }
};

/** Asks the browser not to clear Uuda's saved work when space runs low. Returns whether it agreed. */
export const keepStorage = async (): Promise<boolean> => {
  try { return Boolean(navigator.storage?.persist && (await navigator.storage.persist())); } catch { return false; }
};
