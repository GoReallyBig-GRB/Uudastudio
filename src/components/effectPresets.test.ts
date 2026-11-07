import { describe, expect, it } from 'vitest';
import { EFFECT_PRESETS } from './effectPresets';

type Range = Record<string, [number, number]>;
/** The ranges the effects accept (from the parameter types) */
const RANGES: Record<string, Range> = {
  delay: { timeMs: [10, 2000], feedback: [0, 0.95], lowCutHz: [20, 1000], highCutHz: [1000, 20000], dryWet: [0, 1] },
  chorus: { voices: [2, 6], rateHz: [0.1, 8], depthMs: [1, 20], stereoSpread: [0, 1], feedback: [0, 0.7], dryWet: [0, 1] },
  flanger: { delayMs: [0.1, 10], rateHz: [0.05, 5], depthMs: [0.1, 5], feedback: [-0.9, 0.9], stereoPhaseDeg: [0, 180], dryWet: [0, 1] },
  phaser: { stages: [4, 12], rateHz: [0.05, 6], depth: [0, 1], centerFreqHz: [100, 8000], feedback: [0, 0.85], stereoOffsetDeg: [0, 180], dryWet: [0, 1] },
  reverb: { preDelayMs: [0, 200], decayTimeSec: [0.2, 10], damping: [0, 1], diffusion: [0, 1], size: [0.1, 2], lowCutHz: [20, 500], highCutHz: [1000, 20000], dryWet: [0, 1] },
};

describe('effect presets', () => {
  for (const [type, list] of Object.entries(EFFECT_PRESETS)) {
    it(`${type}: at least four presets with distinct names and distinct settings`, () => {
      expect(list.length).toBeGreaterThanOrEqual(4);
      expect(new Set(list.map((p) => p.name)).size).toBe(list.length);
      expect(new Set(list.map((p) => JSON.stringify(p.params))).size).toBe(list.length);
    });
    it(`${type}: every value is inside the range the effect accepts`, () => {
      for (const p of list) {
        if (type === 'equalizer') {
          for (const b of p.params.bands) {
            expect(b.frequency, p.name).toBeGreaterThanOrEqual(20); expect(b.frequency, p.name).toBeLessThanOrEqual(20000);
            expect(Math.abs(b.gainDb), p.name).toBeLessThanOrEqual(24);
            expect(b.q, p.name).toBeGreaterThanOrEqual(0.1); expect(b.q, p.name).toBeLessThanOrEqual(18);
          }
          continue;
        }
        for (const [k, [lo, hi]] of Object.entries(RANGES[type])) {
          expect(p.params[k], `${type}/${p.name}/${k}`).toBeGreaterThanOrEqual(lo);
          expect(p.params[k], `${type}/${p.name}/${k}`).toBeLessThanOrEqual(hi);
        }
      }
    });
  }
});
