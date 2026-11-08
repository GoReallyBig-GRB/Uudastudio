import { describe, expect, it } from 'vitest';
import { loadCustomPresets, removeCustomPreset, saveCustomPreset } from './customPresets';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('custom presets', () => {
  it('saves, reloads, replaces by name and removes', () => {
    const s = memory();
    expect(loadCustomPresets('comp', s)).toEqual([]);
    saveCustomPreset('comp', 'My voice', { a: 1 }, s);
    saveCustomPreset('comp', 'Other', { a: 2 }, s);
    saveCustomPreset('comp', 'my voice', { a: 3 }, s);
    const list = loadCustomPresets<{ a: number }>('comp', s);
    expect(list.map((p) => p.name)).toEqual(['Other', 'my voice']);
    expect(list[1].value.a).toBe(3);
    expect(removeCustomPreset('comp', 'Other', s).map((p) => p.name)).toEqual(['my voice']);
  });
  it('keeps kinds apart, ignores blank names and survives bad data or no storage', () => {
    const s = memory();
    saveCustomPreset('comp', 'x', 1, s);
    expect(loadCustomPresets('denoise', s)).toEqual([]);
    expect(saveCustomPreset('comp', '   ', 2, s)).toHaveLength(1);
    s.setItem('uuda.customPresets.bad', '{not json');
    expect(loadCustomPresets('bad', s)).toEqual([]);
    expect(loadCustomPresets('comp', null)).toEqual([]);
    expect(() => saveCustomPreset('comp', 'y', 1, null)).not.toThrow();
  });
});
