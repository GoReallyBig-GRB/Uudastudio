import { describe, expect, it } from 'vitest';
import { DEFAULT_LIVE_SETTINGS, LIVE_SETTINGS_KEY, clearLiveSettings, liveSettings, loadLiveSettings, sanitizeLiveSettings, saveLiveSettings } from './liveSettings';

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
