import { describe, expect, it } from 'vitest';
import type { DenoiseParams } from '../../types';
import { denoiseChannels, noisePrintLevelDb } from './denoiseStream';
import { learnNoisePrint } from './noisePrint';

const SR = 44100;
const db = (x: number) => 20 * Math.log10(x + 1e-12);
const rms = (a: Float32Array, from: number, to: number) => {
  let e = 0;
  for (let i = from; i < to; i++) e += a[i] * a[i];
  return Math.sqrt(e / Math.max(1, to - from));
};

/**
 * 14 s test recording: 0-2 s noise only (the sample), then phrases (voice-like harmonics, -22 dBFS) in 0.6-1.4 s windows
 * separated by gaps that hold a street-like burst (-40 dBFS, broadband, 0.3 s) and a low mic thump (-30 dBFS, 45 Hz, 0.15 s).
 * Steady noise is -62 dBFS throughout.
 */
const makeRecording = () => {
  let seed = 11;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff - 0.5; };
  const n = 14 * SR;
  const x = new Float32Array(n);
  const noiseAmp = Math.pow(10, -62 / 20) * Math.sqrt(12);
  for (let i = 0; i < n; i++) x[i] = noiseAmp * rnd();
  const voice: [number, number][] = [];
  const events: { kind: 'street' | 'thump'; from: number; to: number }[] = [];
  for (let k = 0; k < 5; k++) {
    const t0 = 2.2 + k * 2.3;
    voice.push([Math.round(t0 * SR), Math.round((t0 + 1.0) * SR)]);
    const street = Math.round((t0 + 1.2) * SR);
    events.push({ kind: 'street', from: street, to: street + Math.round(0.3 * SR) });
    const thump = Math.round((t0 + 1.8) * SR);
    events.push({ kind: 'thump', from: thump, to: thump + Math.round(0.15 * SR) });
  }
  const voiceAmp = Math.pow(10, -22 / 20) * Math.SQRT2 / Math.sqrt(3);
  for (const [a, b] of voice) for (let i = a; i < b; i++) {
    const env = Math.min(1, (i - a) / 800, (b - i) / 800);
    let v = 0;
    for (const h of [180, 360, 540]) v += Math.sin((2 * Math.PI * h * i) / SR);
    x[i] += voiceAmp * env * v;
  }
  const streetAmp = Math.pow(10, -40 / 20) * Math.sqrt(12);
  const thumpAmp = Math.pow(10, -30 / 20) * Math.SQRT2;
  for (const e of events) for (let i = e.from; i < e.to; i++) {
    const env = Math.sin((Math.PI * (i - e.from)) / (e.to - e.from));
    x[i] += e.kind === 'street' ? streetAmp * env * rnd() : thumpAmp * env * Math.sin((2 * Math.PI * 45 * i) / SR);
  }
  return { x, voice, events };
};

const params: DenoiseParams = { highPassFreq: 80, noiseFloorThresholdDb: -40, reductionDb: 14, sensitivity: 1.5, voiceProtection: 0.5 };

describe('noise print level', () => {
  it('reads the loudness of the learned noise', () => {
    const { x } = makeRecording();
    const print = learnNoisePrint([x.subarray(0, 2 * SR)], SR, 'test');
    expect(noisePrintLevelDb(print)).toBeGreaterThan(-65);
    expect(noisePrintLevelDb(print)).toBeLessThan(-59);
  });
});

describe('gap cleanup removes what the noise print cannot', () => {
  const { x, voice, events } = makeRecording();
  const print = learnNoisePrint([x.subarray(0, 2 * SR)], SR, 'test');
  const printOnly = denoiseChannels([x], SR, { ...params, print, gapCleanupDb: 0 })[0];
  const cleaned = denoiseChannels([x], SR, { ...params, print, gapCleanupDb: 26 })[0];
  const change = (y: Float32Array, a: number, b: number) => db(rms(y, a, b)) - db(rms(x, a, b));

  it('street sounds and thumps in the gaps are turned down much further than by the print alone', () => {
    const report: string[] = [];
    for (const e of events) {
      const mid = [e.from + Math.round((e.to - e.from) * 0.2), e.to - Math.round((e.to - e.from) * 0.2)];
      const a = change(printOnly, mid[0], mid[1]);
      const b = change(cleaned, mid[0], mid[1]);
      report.push(`${e.kind}: print only ${a.toFixed(1)} dB, with gap cleanup ${b.toFixed(1)} dB`);
    }
    console.log(report.join('\n'));
    for (const e of events) {
      const mid = [e.from + Math.round((e.to - e.from) * 0.2), e.to - Math.round((e.to - e.from) * 0.2)];
      expect(change(cleaned, mid[0], mid[1])).toBeLessThan(change(printOnly, mid[0], mid[1]) - 6);
    }
  });

  it('the voice is not turned down', () => {
    for (const [a, b] of voice) {
      const mid = [a + 2000, b - 2000];
      expect(Math.abs(change(cleaned, mid[0], mid[1]))).toBeLessThan(1.5);
    }
  });

  it('gap cleanup of 0 leaves exactly the print result', () => {
    const again = denoiseChannels([x], SR, { ...params, print, gapCleanupDb: 0 })[0];
    for (let i = 0; i < again.length; i += 997) expect(again[i]).toBeCloseTo(printOnly[i], 6);
  });
});
