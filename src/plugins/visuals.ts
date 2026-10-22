/**
 * Uuda Studio - Plugin curve math (pure functions, no DOM).
 *
 * compressorTransfer: input level -> output level in dB with a soft knee, the standard textbook curve.
 * biquadMagnitudeDb:  response of one Web Audio biquad (RBJ cookbook, same maths as BiquadFilterNode).
 * eqBands:            the filters a native EQ plugin builds, so the drawn curve matches the audio.
 */

export interface CompressorCurveParams {
  threshold: number;
  ratio: number;
  knee: number;
  makeupGain: number;
}

/** Output level (dB) for an input level (dB), including makeup gain */
export function compressorTransfer(inputDb: number, p: CompressorCurveParams): number {
  const { threshold: t, ratio: r, knee: k, makeupGain } = p;
  const x = inputDb;
  const ratio = Math.max(1, r);
  let y: number;
  if (k <= 0) {
    y = x <= t ? x : t + (x - t) / ratio;
  } else if (2 * (x - t) < -k) {
    y = x;
  } else if (2 * Math.abs(x - t) <= k) {
    const d = x - t + k / 2;
    y = x + ((1 / ratio - 1) * d * d) / (2 * k);
  } else {
    y = t + (x - t) / ratio;
  }
  return y + makeupGain;
}

export type BiquadKind = 'lowshelf' | 'peaking' | 'highshelf';

export interface EqBand {
  kind: BiquadKind;
  freq: number;
  gainDb: number;
  q: number;
}

const SAMPLE_RATE = 48000;

/** Magnitude in dB of one biquad at frequency f (Hz) */
export function biquadMagnitudeDb(band: EqBand, f: number): number {
  const { kind, freq, gainDb, q } = band;
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * freq) / SAMPLE_RATE;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);

  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (kind === 'peaking') {
    const alpha = sin / (2 * Math.max(0.0001, q));
    b0 = 1 + alpha * A;
    b1 = -2 * cos;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cos;
    a2 = 1 - alpha / A;
  } else {
    // Shelving filters use shelf slope S = 1
    const alpha = (sin / 2) * Math.SQRT2;
    const tsa = 2 * Math.sqrt(A) * alpha;
    if (kind === 'lowshelf') {
      b0 = A * (A + 1 - (A - 1) * cos + tsa);
      b1 = 2 * A * (A - 1 - (A + 1) * cos);
      b2 = A * (A + 1 - (A - 1) * cos - tsa);
      a0 = A + 1 + (A - 1) * cos + tsa;
      a1 = -2 * (A - 1 + (A + 1) * cos);
      a2 = A + 1 + (A - 1) * cos - tsa;
    } else {
      b0 = A * (A + 1 + (A - 1) * cos + tsa);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - tsa);
      a0 = A + 1 - (A - 1) * cos + tsa;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - tsa;
    }
  }

  const w = (2 * Math.PI * f) / SAMPLE_RATE;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const numRe = b0 + b1 * c1 + b2 * c2;
  const numIm = -(b1 * s1 + b2 * s2);
  const denRe = a0 + a1 * c1 + a2 * c2;
  const denIm = -(a1 * s1 + a2 * s2);
  const mag = Math.sqrt((numRe * numRe + numIm * numIm) / Math.max(1e-20, denRe * denRe + denIm * denIm));
  return 20 * Math.log10(Math.max(1e-6, mag));
}

/** The filters inside a native EQ plugin for the current parameter values, or null if the plugin has no EQ curve */
export function eqBands(pluginId: string, p: Record<string, number>): EqBand[] | null {
  if (pluginId === 'uuda-native-eq') {
    return [
      { kind: 'lowshelf', freq: 80, gainDb: p.lowShelfGain ?? 0, q: 0.7 },
      { kind: 'peaking', freq: p.mid1Freq ?? 400, gainDb: p.mid1Gain ?? 0, q: 1.2 },
      { kind: 'peaking', freq: p.mid2Freq ?? 2500, gainDb: p.mid2Gain ?? 0, q: 1.5 },
      { kind: 'highshelf', freq: 8000, gainDb: p.highShelfGain ?? 0, q: 0.7 },
    ];
  }
  if (pluginId === 'uuda-native-param-eq') {
    return [
      { kind: 'lowshelf', freq: 100, gainDb: p.lowGain ?? 0, q: 0.7 },
      { kind: 'peaking', freq: 400, gainDb: p.lowMidGain ?? 0, q: 1 },
      { kind: 'peaking', freq: 1200, gainDb: p.midGain ?? 0, q: p.midQ ?? 1.2 },
      { kind: 'peaking', freq: 3500, gainDb: p.highMidGain ?? 0, q: 1.2 },
      { kind: 'highshelf', freq: 10000, gainDb: p.highGain ?? 0, q: 0.7 },
    ];
  }
  return null;
}

/** Combined response in dB of all bands at frequency f */
export function eqResponseDb(bands: EqBand[], f: number): number {
  let total = 0;
  for (const b of bands) total += biquadMagnitudeDb(b, f);
  return total;
}
