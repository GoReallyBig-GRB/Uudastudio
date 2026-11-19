import { describe, expect, it } from 'vitest';
import { DEFAULT_LIVE_SETTINGS, MAX_PROFILES, type StudioProfile, LIVE_SETTINGS_KEY, clearLiveSettings, liveSettings, loadLiveSettings, sanitizeLiveSettings, saveLiveSettings } from './liveSettings';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, m }; };

describe('live settings', () => {
  it('starts from sensible defaults', () => {
    expect(sanitizeLiveSettings(null)).toEqual(DEFAULT_LIVE_SETTINGS);
    expect(sanitizeLiveSettings('junk')).toEqual(DEFAULT_LIVE_SETTINGS);
  });
  it('keeps good values and repairs bad ones', () => {
    const s = sanitizeLiveSettings({ defaultMode: 'broadcast', headphones: true, programContains: 'guests', quality: 'high', inputDeviceId: 'abc', guestStrip: { lowCut: false, presence: 99 } });
    expect(s).toMatchObject({ defaultMode: 'broadcast', headphones: true, programContains: 'guests', quality: 'high', inputDeviceId: 'abc' });
    expect(s.guestStrip).toEqual({ lowCut: false, compressor: true, presence: 6 });
    expect(sanitizeLiveSettings({ defaultMode: 'x', quality: 5, headphones: 'yes', guestStrip: { presence: NaN } })).toEqual(DEFAULT_LIVE_SETTINGS);
  });
  it('saves, loads and clears through storage, and survives broken storage', () => {
    const s = mem();
    saveLiveSettings({ ...DEFAULT_LIVE_SETTINGS, quality: 'high' }, s);
    expect(loadLiveSettings(s).quality).toBe('high');
    clearLiveSettings(s);
    expect(s.m.has(LIVE_SETTINGS_KEY)).toBe(false);
    s.setItem(LIVE_SETTINGS_KEY, '{nope');
    expect(loadLiveSettings(s)).toEqual(DEFAULT_LIVE_SETTINGS);
    expect(loadLiveSettings(null)).toEqual(DEFAULT_LIVE_SETTINGS);
    expect(() => saveLiveSettings(DEFAULT_LIVE_SETTINGS, null)).not.toThrow();
  });
  it('the shared copy tells listeners when something changes and can be reset', () => {
    let n = 0;
    const off = liveSettings.subscribe(() => { n++; });
    liveSettings.set({ defaultMode: 'broadcast', guestStrip: { presence: 2 } });
    expect(liveSettings.get()).toMatchObject({ defaultMode: 'broadcast', guestStrip: { lowCut: true, compressor: true, presence: 2 } });
    liveSettings.reset();
    expect(liveSettings.get()).toEqual(DEFAULT_LIVE_SETTINGS);
    expect(n).toBe(2);
    off();
    liveSettings.set({ quality: 'high' });
    expect(n).toBe(2);
    liveSettings.reset();
  });
});

describe('studio profiles', () => {
  const prof = (id: string, over: Partial<StudioProfile> = {}): StudioProfile => ({ id, name: `Studio ${id}`, goal: 'radio', gear: 'usb-mixer', defaultMode: 'broadcast', inputDeviceId: 'dev', headphones: true, programContains: 'guests', ...over });
  it('drops broken profiles when reading back', () => {
    const s = sanitizeLiveSettings({ profiles: [prof('a'), { id: 'x' }, { ...prof('b'), gear: 'toaster' }, null, 'junk'], setupDone: true });
    expect(s.profiles.map((p) => p.id)).toEqual(['a']);
    expect(s.setupDone).toBe(true);
    expect(sanitizeLiveSettings({ profiles: 'no' }).profiles).toEqual([]);
  });
  it('saves newest first, keeps at most five, and uses and deletes them', () => {
    liveSettings.reset();
    for (let i = 1; i <= 7; i++) liveSettings.saveProfile(prof(String(i)));
    const ids = liveSettings.get().profiles.map((p) => p.id);
    expect(ids).toHaveLength(MAX_PROFILES);
    expect(ids[0]).toBe('7');
    expect(liveSettings.get().activeProfileId).toBe('7');
    liveSettings.saveProfile(prof('5', { name: 'Renamed' }));
    expect(liveSettings.get().profiles.filter((p) => p.id === '5')).toHaveLength(1);
    expect(liveSettings.useProfile('6')).toBe(true);
    expect(liveSettings.get()).toMatchObject({ defaultMode: 'broadcast', inputDeviceId: 'dev', headphones: true, programContains: 'guests', activeProfileId: '6', setupDone: true });
    expect(liveSettings.useProfile('nope')).toBe(false);
    liveSettings.deleteProfile('6');
    expect(liveSettings.get().activeProfileId).toBe('');
    expect(liveSettings.get().profiles.some((p) => p.id === '6')).toBe(false);
    liveSettings.reset();
  });
});
