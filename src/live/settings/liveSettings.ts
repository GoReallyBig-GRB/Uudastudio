import type { LiveMode } from '../events';

/** Settings that belong to live events only. Kept on this device, because sound devices differ from computer to computer. */
export type CallQuality = 'standard' | 'high';
export interface LiveSettings {
  /** What a new event starts as */
  defaultMode: LiveMode;
  /** The microphone or mixer input last used for the call */
  inputDeviceId: string;
  /** Last answer to "I am wearing headphones" */
  headphones: boolean;
  /** Last device the broadcast program was sent to (it is never started on its own) */
  programDeviceId: string;
  /** Program: me and the guests, or guests only (microphone goes through a mixer) */
  programContains: 'all' | 'guests';
  /** Where every new guest's channel strip starts in a broadcast */
  guestStrip: { lowCut: boolean; compressor: boolean; presence: number };
  /** Standard or high bit rate for the call (high uses more data) */
  quality: CallQuality;
}

export const DEFAULT_LIVE_SETTINGS: LiveSettings = {
  defaultMode: 'conversation', inputDeviceId: '', headphones: false, programDeviceId: '', programContains: 'all',
  guestStrip: { lowCut: true, compressor: true, presence: 0 }, quality: 'standard',
};

export const LIVE_SETTINGS_KEY = 'uuda_live_settings';

/** Anything read back from storage is checked: wrong or missing values fall back to the defaults */
export function sanitizeLiveSettings(x: unknown): LiveSettings {
  const d = DEFAULT_LIVE_SETTINGS;
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const g = (o.guestStrip && typeof o.guestStrip === 'object' ? o.guestStrip : {}) as Record<string, unknown>;
  const presence = typeof g.presence === 'number' && Number.isFinite(g.presence) ? Math.max(-6, Math.min(6, g.presence)) : d.guestStrip.presence;
  return {
    defaultMode: o.defaultMode === 'broadcast' ? 'broadcast' : 'conversation',
    inputDeviceId: typeof o.inputDeviceId === 'string' ? o.inputDeviceId.slice(0, 300) : d.inputDeviceId,
    headphones: typeof o.headphones === 'boolean' ? o.headphones : d.headphones,
    programDeviceId: typeof o.programDeviceId === 'string' ? o.programDeviceId.slice(0, 300) : d.programDeviceId,
    programContains: o.programContains === 'guests' ? 'guests' : 'all',
    guestStrip: { lowCut: typeof g.lowCut === 'boolean' ? g.lowCut : d.guestStrip.lowCut, compressor: typeof g.compressor === 'boolean' ? g.compressor : d.guestStrip.compressor, presence },
    quality: o.quality === 'high' ? 'high' : 'standard',
  };
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const browserStore = (): Store | null => { try { return localStorage; } catch { return null; } };

export function loadLiveSettings(store: Store | null = browserStore()): LiveSettings {
  try { return sanitizeLiveSettings(JSON.parse(store?.getItem(LIVE_SETTINGS_KEY) ?? 'null')); } catch { return sanitizeLiveSettings(null); }
}
export function saveLiveSettings(s: LiveSettings, store: Store | null = browserStore()): void {
  try { store?.setItem(LIVE_SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage blocked: the settings last until the page closes */ }
}
export function clearLiveSettings(store: Store | null = browserStore()): void {
  try { store?.removeItem(LIVE_SETTINGS_KEY); } catch { /* nothing to clear */ }
}

/** One shared copy for the whole page, so the settings window and the call controls always agree */
let current: LiveSettings | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const liveSettings = {
  get(): LiveSettings { if (!current) current = loadLiveSettings(); return current; },
  set(patch: Partial<Omit<LiveSettings, 'guestStrip'>> & { guestStrip?: Partial<LiveSettings['guestStrip']> }): void {
    const prev = liveSettings.get();
    current = sanitizeLiveSettings({ ...prev, ...patch, guestStrip: { ...prev.guestStrip, ...patch.guestStrip } });
    saveLiveSettings(current);
    emit();
  },
  reset(): void { current = { ...DEFAULT_LIVE_SETTINGS, guestStrip: { ...DEFAULT_LIVE_SETTINGS.guestStrip } }; clearLiveSettings(); emit(); },
  subscribe(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; },
};
