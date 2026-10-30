import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { dropGroupSettings, groupOutputGain, groupPan, groupSettingsFor, patchGroupSettings } from './groupSettings';

const base = { tracks: [] } as unknown as Project;

describe('groupSettings', () => {
  it('returns defaults for a group without settings', () => {
    expect(groupSettingsFor(base, 'g1')).toEqual({ volume: 1, pan: 0, muted: false });
  });

  it('stores changes and prunes them when back at defaults', () => {
    const a = patchGroupSettings(base, 'g1', { volume: 0.5 });
    expect(a.groupSettings?.g1.volume).toBe(0.5);
    const b = patchGroupSettings(a, 'g1', { volume: 1 });
    expect(b.groupSettings).toBeUndefined();
  });

  it('does not mutate the input project', () => {
    const a = patchGroupSettings(base, 'g1', { muted: true });
    expect(base.groupSettings).toBeUndefined();
    expect(a).not.toBe(base);
  });

  it('clamps volume and pan', () => {
    const a = patchGroupSettings(base, 'g1', { volume: 9, pan: -4 });
    expect(a.groupSettings?.g1.volume).toBe(1.5);
    expect(a.groupSettings?.g1.pan).toBe(-1);
  });

  it('muted group outputs silence but keeps its volume', () => {
    const a = patchGroupSettings(base, 'g1', { volume: 0.8, muted: true });
    expect(groupOutputGain(groupSettingsFor(a, 'g1'))).toBe(0);
    expect(groupSettingsFor(a, 'g1').volume).toBe(0.8);
    expect(groupPan({ volume: 1, pan: 0.3, muted: false })).toBe(0.3);
  });

  it('dropGroupSettings removes only the given groups', () => {
    let p = patchGroupSettings(base, 'g1', { volume: 0.5 });
    p = patchGroupSettings(p, 'g2', { pan: 0.5 });
    const d = dropGroupSettings(p, ['g1']);
    expect(d.groupSettings && Object.keys(d.groupSettings)).toEqual(['g2']);
    expect(dropGroupSettings(d, ['g2']).groupSettings).toBeUndefined();
  });
});
