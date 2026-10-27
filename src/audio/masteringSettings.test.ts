import { describe, it, expect } from 'vitest';
import type { Project } from '../types';
import {
  analysisIsCurrent, defaultMasteringSettings, masteringKey, mixFingerprint, normalizeMastering, presetValues, toChainSettings,
  type MasteringSettings,
} from './masteringSettings';

const project = (gain = 1): Project => ({
  id: 'p', name: 'p', sampleRate: 48000, settings: {} as Project['settings'],
  tracks: [{
    id: 't', name: 'T', volume: 1, pan: 0, muted: false, solo: false,
    clips: [{ id: 'c', trackId: 't', assetId: 'a', name: 'c', startSeconds: 0, offsetSeconds: 0, durationSeconds: 10, gain, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'linear' }],
  }],
} as unknown as Project);

describe('mastering settings', () => {
  it('starts off, on the podcast preset', () => {
    const d = defaultMasteringSettings();
    expect(d.active).toBe(false);
    expect(d.type).toBe('podcast');
    expect(d.targetLufs).toBe(-16);
  });

  it('repairs missing or out-of-range stored values', () => {
    const n = normalizeMastering({ targetLufs: 99, ceilingDbTP: NaN as unknown as number, type: 'nonsense' as never, active: true });
    expect(n.active).toBe(true);
    expect(n.type).toBe('podcast');
    expect(n.targetLufs).toBe(-5);
    expect(n.ceilingDbTP).toBe(defaultMasteringSettings().ceilingDbTP);
    expect(normalizeMastering(undefined).active).toBe(false);
  });

  it('broadcast standards set the target', () => {
    expect(presetValues('broadcast', 'ebu_r128').targetLufs).toBe(-23);
    expect(presetValues('broadcast', 'atsc_a85').targetLufs).toBe(-24);
  });

  it('the key changes with the sound but not with on/off or the stored analysis', () => {
    const a = defaultMasteringSettings();
    expect(masteringKey(toChainSettings({ ...a, active: true }))).toBe(masteringKey(a));
    expect(masteringKey({ ...a, targetLufs: -18 })).not.toBe(masteringKey(a));
    expect(masteringKey({ ...a, compressionRatio: 4 })).not.toBe(masteringKey(a));
    expect(Object.keys(toChainSettings(a)).includes('active')).toBe(false);
  });

  it('the mix fingerprint follows edits and the master fader', () => {
    const base = mixFingerprint(project());
    expect(mixFingerprint(project())).toBe(base);
    expect(mixFingerprint(project(0.5))).not.toBe(base);
    expect(mixFingerprint(project(), 0.8)).not.toBe(base);
    expect(mixFingerprint(project(), 1, true)).not.toBe(base);
  });

  it('an analysis counts only for the settings and mix it was measured on', () => {
    const key = mixFingerprint(project());
    const s: MasteringSettings = { ...defaultMasteringSettings(), active: true };
    expect(analysisIsCurrent(s, key)).toBe(false);
    const measured: MasteringSettings = {
      ...s,
      analysis: { settingsKey: masteringKey(s), mixKey: key, gainDb: 3, mixLufs: -20, processedLufs: -19, durationSeconds: 10, measuredAt: 0 },
    };
    expect(analysisIsCurrent(measured, key)).toBe(true);
    expect(analysisIsCurrent(measured, mixFingerprint(project(0.5)))).toBe(false);
    expect(analysisIsCurrent({ ...measured, targetLufs: -14 }, key)).toBe(false);
  });
});
