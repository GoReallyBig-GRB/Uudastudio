import { describe, expect, it } from 'vitest';
import { COMPRESS_PRESETS, DENOISE_PRESETS, ENHANCE_PRESETS } from './dspPresets';

const within = (v: number, lo: number, hi: number) => v >= lo && v <= hi;

describe('Compress, Denoise and Enhance presets', () => {
  it('each has at least four, with distinct names', () => {
    for (const list of [COMPRESS_PRESETS, DENOISE_PRESETS, ENHANCE_PRESETS]) {
      expect(list.length).toBeGreaterThanOrEqual(4);
      expect(new Set(list.map((p) => p.name)).size).toBe(list.length);
    }
  });
  it('compressor values stay inside the slider ranges', () => {
    for (const { params: p } of COMPRESS_PRESETS) {
      expect(within(p.thresholdDb, -40, 0)).toBe(true);
      expect(within(p.kneeDb, 0, 40)).toBe(true);
      expect(within(p.ratio, 1, 20)).toBe(true);
      expect(within(p.attackMs, 1, 500)).toBe(true);
      expect(within(p.releaseMs, 10, 1000)).toBe(true);
      expect(within(p.makeupGainDb, 0, 24)).toBe(true);
    }
  });
  it('denoise values stay inside the slider ranges', () => {
    for (const p of DENOISE_PRESETS) {
      expect(within(p.reductionDb, 3, 30)).toBe(true);
      expect(within(p.sensitivity, 1, 4)).toBe(true);
      expect(within(p.voiceProtection, 0, 1)).toBe(true);
      expect(within(p.gapCleanupDb, 0, 40)).toBe(true);
      expect(within(p.highPassFreq, 40, 160)).toBe(true);
      expect(within(p.noiseFloorThresholdDb, -60, -15)).toBe(true);
    }
  });
  it('enhance strengths differ and stay 0 to 100', () => {
    expect(new Set(ENHANCE_PRESETS.map((p) => p.strength)).size).toBe(ENHANCE_PRESETS.length);
    for (const p of ENHANCE_PRESETS) expect(within(p.strength, 0, 100)).toBe(true);
  });
});
