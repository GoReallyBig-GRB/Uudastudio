/** The user's own saved presets for one processor, kept in this browser. Every storage call is guarded: it may be blocked or full. */
export interface CustomPreset<T> { name: string; value: T }

const KEY = (kind: string) => `uuda.customPresets.${kind}`;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

const defaultStore = (): Store | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

export function loadCustomPresets<T>(kind: string, store: Store | null = defaultStore()): CustomPreset<T>[] {
  try {
    const raw = store?.getItem(KEY(kind));
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((p) => p && typeof p.name === 'string' && 'value' in p) : [];
  } catch { return []; }
}

/** Adds or replaces the preset with this name; returns the new list. A blank name changes nothing. */
export function saveCustomPreset<T>(kind: string, name: string, value: T, store: Store | null = defaultStore()): CustomPreset<T>[] {
  const clean = name.trim().slice(0, 40);
  const current = loadCustomPresets<T>(kind, store);
  if (!clean) return current;
  const next = [...current.filter((p) => p.name.toLowerCase() !== clean.toLowerCase()), { name: clean, value }];
  try { store?.setItem(KEY(kind), JSON.stringify(next)); } catch { /* kept for this session only */ }
  return next;
}

export function removeCustomPreset<T>(kind: string, name: string, store: Store | null = defaultStore()): CustomPreset<T>[] {
  const next = loadCustomPresets<T>(kind, store).filter((p) => p.name !== name);
  try { store?.setItem(KEY(kind), JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}
