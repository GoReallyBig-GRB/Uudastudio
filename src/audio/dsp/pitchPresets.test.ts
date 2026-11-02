import { describe, expect, it } from 'vitest';
import { PITCH_PRESETS, presetFor } from './pitchPresets';

describe('pitch presets', () => {
  it('run from extreme high to extreme deep, inside the ±12 range', () => {
    const steps = PITCH_PRESETS.map((p) => p.semitones);
    expect(steps).toEqual([12, 7, 4, -5, -12]);
    for (const s of steps) expect(Math.abs(s)).toBeLessThan(12.001);
  });
  it('finds the preset for a setting', () => {
    expect(presetFor(-12)?.id).toBe('monster');
    expect(presetFor(3)).toBe(undefined);
  });
});
