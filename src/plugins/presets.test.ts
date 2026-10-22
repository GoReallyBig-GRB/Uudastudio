import { describe, it, expect } from 'vitest';
import { NATIVE_STEM_PLUGINS } from './registry';
import { FACTORY_PRESET_TABLE, getPluginPresets, formatParamValue, paramLabel } from './presets';
import { compressorTransfer, biquadMagnitudeDb, eqBands, eqResponseDb } from './visuals';

describe('plugin presets', () => {
  it('only refers to native plugins that exist', () => {
    const ids = new Set(NATIVE_STEM_PLUGINS.map((d) => d.id));
    for (const pluginId of Object.keys(FACTORY_PRESET_TABLE)) expect(ids.has(pluginId)).toBe(true);
  });

  it('gives every plugin a Default and at least three presets in total', () => {
    for (const d of NATIVE_STEM_PLUGINS) {
      const list = getPluginPresets(d);
      expect(list[0].id).toBe('default');
      expect(list.length >= 4 || list.length >= 3).toBe(true);
      expect(new Set(list.map((p) => p.id)).size).toBe(list.length);
    }
  });

  it('uses only real parameters and keeps every value inside its range', () => {
    for (const d of NATIVE_STEM_PLUGINS) {
      for (const preset of getPluginPresets(d)) {
        for (const [key, value] of Object.entries(preset.params)) {
          const def = d.parameters[key];
          expect(def, `${d.id} / ${preset.name}: unknown parameter ${key}`).toBeTruthy();
          expect(value >= def.min && value <= def.max, `${d.id} / ${preset.name}: ${key}=${value} outside ${def.min}..${def.max}`).toBe(true);
        }
      }
    }
  });
});

describe('parameter display', () => {
  it('shows 0..1 mix values as percent and names stepped values', () => {
    expect(formatParamValue('dryWet', 1, { min: 0, max: 1, unit: '%' })).toBe('100%');
    expect(formatParamValue('dryWet', 0.35, { min: 0, max: 1, unit: '%' })).toBe('35%');
    expect(formatParamValue('filterType', 1, { min: 0, max: 5, unit: 'type' })).toBe('High-pass');
    expect(formatParamValue('pingPong', 0, { min: 0, max: 1, unit: 'bool' })).toBe('Off');
    expect(formatParamValue('threshold', -18, { min: -60, max: 0, unit: 'dB' })).toBe('-18 dB');
    expect(formatParamValue('ratio', 4, { min: 1, max: 20, unit: ':1' })).toBe('4:1');
  });

  it('drops explanatory brackets from labels but keeps frequency brackets', () => {
    expect(paramLabel('mode', 'Mode (0=Pan, 1=Trem)')).toBe('Mode');
    expect(paramLabel('lowShelfGain', 'Low Shelf (80Hz)')).toBe('Low Shelf (80Hz)');
  });
});

describe('curve maths', () => {
  const comp = { threshold: -18, ratio: 4, knee: 6, makeupGain: 0 };

  it('compressor: unity below the knee, ratio above it, makeup added', () => {
    expect(compressorTransfer(-40, comp)).toBeCloseTo(-40, 5);
    expect(compressorTransfer(0, comp)).toBeCloseTo(-18 + 18 / 4, 5);
    expect(compressorTransfer(-40, { ...comp, makeupGain: 3 })).toBeCloseTo(-37, 5);
    // continuous across the threshold
    expect(Math.abs(compressorTransfer(-18.001, comp) - compressorTransfer(-17.999, comp)) < 0.01).toBe(true);
  });

  it('biquad: a +6 dB peak reads +6 dB at its centre and about 0 dB far away', () => {
    const band = { kind: 'peaking' as const, freq: 1000, gainDb: 6, q: 1 };
    expect(biquadMagnitudeDb(band, 1000)).toBeCloseTo(6, 1);
    expect(Math.abs(biquadMagnitudeDb(band, 30)) < 0.5).toBe(true);
  });

  it('biquad: shelves reach their gain on the correct side', () => {
    expect(biquadMagnitudeDb({ kind: 'lowshelf', freq: 200, gainDb: 6, q: 0.7 }, 30)).toBeCloseTo(6, 0);
    expect(biquadMagnitudeDb({ kind: 'highshelf', freq: 4000, gainDb: -6, q: 0.7 }, 18000)).toBeCloseTo(-6, 0);
  });

  it('EQ plugins expose bands and a flat setting stays flat', () => {
    const bands = eqBands('uuda-native-param-eq', { lowGain: 0, lowMidGain: 0, midGain: 0, highMidGain: 0, highGain: 0, midQ: 1.2 });
    expect(bands && bands.length).toBe(5);
    expect(Math.abs(eqResponseDb(bands!, 1000)) < 0.01).toBe(true);
    expect(eqBands('uuda-native-compressor', {})).toBeNull();
  });
});
