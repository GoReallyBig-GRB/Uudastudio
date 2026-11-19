import type { LiveMode } from '../events';
import { GEAR_IDS, GOAL_IDS, type Gear, type Goal } from '../setup/setupPlan';

/** A saved studio: what the setup assistant worked out, so it can be used again in one click */
export interface StudioProfile {
  id: string;
  name: string;
  goal: Goal;
  gear: Gear;
  defaultMode: LiveMode;
  inputDeviceId: string;
  headphones: boolean;
  programContains: 'all' | 'guests';
}
export const MAX_PROFILES = 5;

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
  /** Keep one mixed file of the whole session on this computer while in the call */
  sessionBackup: boolean;
  /** The setup assistant has been run (or skipped), so it does not open by itself again */
  setupDone: boolean;
  profiles: StudioProfile[];
  activeProfileId: string;
}

export const DEFAULT_LIVE_SETTINGS: LiveSettings = {
  defaultMode: 'conversation', inputDeviceId: '', headphones: false, programDeviceId: '', programContains: 'all',
  guestStrip: { lowCut: true, compressor: true, presence: 0 }, quality: 'standard', sessionBackup: true,
  setupDone: false, profiles: [], activeProfileId: '',
};

export const LIVE_SETTINGS_KEY = 'uuda_live_settings';

function sanitizeProfile(x: unknown): StudioProfile | null {
  const o = (x && typeof x === 'object' ? x : null) as Record<string, unknown> | null;
  if (!o || typeof o.id !== 'string' || !o.id || typeof o.name !== 'string') return null;
  if (!GOAL_IDS.includes(o.goal as Goal) || !GEAR_IDS.includes(o.gear as Gear)) return null;
  return {
    id: o.id.slice(0, 60), name: o.name.trim().slice(0, 40) || 'My studio', goal: o.goal as Goal, gear: o.gear as Gear,
    defaultMode: o.defaultMode === 'broadcast' ? 'broadcast' : 'conversation',
    inputDeviceId: typeof o.inputDeviceId === 'string' ? o.inputDeviceId.slice(0, 300) : '',
    headphones: o.headphones === true, programContains: o.programContains === 'guests' ? 'guests' : 'all',
  };
}

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
    sessionBackup: typeof o.sessionBackup === 'boolean' ? o.sessionBackup : d.sessionBackup,
    setupDone: o.setupDone === true,
    profiles: Array.isArray(o.profiles) ? o.profiles.map(sanitizeProfile).filter((p): p is StudioProfile => p !== null).slice(0, MAX_PROFILES) : [],
    activeProfileId: typeof o.activeProfileId === 'string' ? o.activeProfileId.slice(0, 60) : '',
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
  /** Saves a studio (newest first, at most five) and makes it the active one */
  saveProfile(p: StudioProfile): void {
    const rest = liveSettings.get().profiles.filter((x) => x.id !== p.id);
    liveSettings.set({ profiles: [p, ...rest].slice(0, MAX_PROFILES), activeProfileId: p.id });
  },
  /** Uses a saved studio: its input, headphones, type and program contents become the current settings */
  useProfile(id: string): boolean {
    const p = liveSettings.get().profiles.find((x) => x.id === id);
    if (!p) return false;
    liveSettings.set({ defaultMode: p.defaultMode, inputDeviceId: p.inputDeviceId, headphones: p.headphones, programContains: p.programContains, activeProfileId: p.id, setupDone: true });
    return true;
  },
  deleteProfile(id: string): void {
    const s = liveSettings.get();
    liveSettings.set({ profiles: s.profiles.filter((x) => x.id !== id), activeProfileId: s.activeProfileId === id ? '' : s.activeProfileId });
  },
  reset(): void { current = { ...DEFAULT_LIVE_SETTINGS, guestStrip: { ...DEFAULT_LIVE_SETTINGS.guestStrip } }; clearLiveSettings(); emit(); },
  subscribe(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; },
};
