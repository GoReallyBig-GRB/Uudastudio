import { describe, expect, it } from 'vitest';
import type { Clip, Project } from '../types';
import { applyTempLevels, dbToFactor, hasTempLevels, levelFactors, pruneTempLevels, setTempLevel } from './tempClipLevels';

const clip = (id: string, gain = 1): Clip => ({
  id, trackId: 't', assetId: 'a', name: id, startSeconds: 0, offsetSeconds: 0, durationSeconds: 1,
  gain, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'linear',
});
const proj = (clips: Clip[]) => ({ tracks: [{ id: 't', clips }] }) as unknown as Project;

describe('tempClipLevels', () => {
  it('converts dB to a linear factor', () => {
    expect(dbToFactor(0)).toBe(1);
    expect(dbToFactor(-6)).toBeCloseTo(0.501, 3);
    expect(dbToFactor(6)).toBeCloseTo(1.995, 3);
  });

  it('sets a level, clamps it, rounds to half dB and removes it at 0 dB', () => {
    let l = setTempLevel({}, 'a', -3.3);
    expect(l.a).toBe(-3.5);
    l = setTempLevel(l, 'a', -99);
    expect(l.a).toBe(-24);
    l = setTempLevel(l, 'a', 99);
    expect(l.a).toBe(12);
    l = setTempLevel(l, 'a', 0);
    expect(hasTempLevels(l)).toBe(false);
  });

  it('applies levels to a copy and leaves the project untouched', () => {
    const p = proj([clip('a', 1), clip('b', 0.5)]);
    const out = applyTempLevels(p, { a: -6 });
    expect(out.tracks[0].clips[0].gain).toBeCloseTo(0.501, 3);
    expect(out.tracks[0].clips[1].gain).toBe(0.5); // untouched clip is the same
    expect(p.tracks[0].clips[0].gain).toBe(1);
    expect(applyTempLevels(p, {})).toBe(p); // nothing to apply: same object, no work
  });

  it('multiplies on top of a clip that already has its own gain', () => {
    const out = applyTempLevels(proj([clip('a', 0.5)]), { a: 6 });
    expect(out.tracks[0].clips[0].gain).toBeCloseTo(0.5 * 1.995, 3);
  });

  it('factors leave out clips at 0 dB, and pruning drops clips that are gone', () => {
    expect(Object.keys(levelFactors({ a: 0, b: -3 }))).toEqual(['b']);
    expect(pruneTempLevels({ a: -3, b: 2 }, new Set(['b']))).toEqual({ b: 2 });
  });
});
