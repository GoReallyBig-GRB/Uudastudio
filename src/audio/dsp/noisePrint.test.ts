import { describe, expect, it } from 'vitest';
import { NoisePrint, NoisePrintStage, learnNoisePrint, quietestStretch } from './noisePrint';
import { denoiseChannels } from './denoiseStream';

const SR = 44100;
const rngFactory = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff - 0.5; };
const rms = (a: Float32Array, from: number, to: number) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / (to - from)); };
const db = (x: number) => 20 * Math.log10(x);

/** Hum at 120 Hz plus hiss */
const noise = (n: number, seed: number) => {
  const r = rngFactory(seed);
  return Float32Array.from({ length: n }, (_, i) => 0.02 * Math.sin((2 * Math.PI * 120 * i) / SR) + 0.02 * r());
};
const tone = (n: number, hz: number, amp: number) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const add = (a: Float32Array, b: Float32Array) => a.map((v, i) => v + b[i]);

const run = (input: Float32Array, print: NoisePrint, reductionDb = 18, sensitivity = 1.5, chunk = 0): Float32Array => {
  const st = new NoisePrintStage(input.length, SR, print, { reductionDb, sensitivity });
  const parts: Float32Array[] = [];
  if (chunk === 0) parts.push(st.push(input));
  else for (let i = 0; i < input.length; i += chunk) { const size = chunk + (i % 3) * 71; parts.push(st.push(input.subarray(i, Math.min(input.length, i + size)))); i += (i % 3) * 71; }
  parts.push(st.finish());
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

describe('learning a print', () => {
  it('refuses a stretch that is too short', () => {
    let failed = false;
    try { learnNoisePrint([noise(2000, 1)], SR); } catch { failed = true; }
    expect(failed).toBe(true);
  });
  it('learns a steady noise with a small loudness spread, and flags a stretch with loud events', () => {
    const steady = learnNoisePrint([noise(SR, 1)], SR);
    expect(steady.loudnessSpreadDb < 3).toBe(true);
    const burst = noise(SR * 2, 2);
    burst.set(add(burst.subarray(SR, SR + 8000), tone(8000, 800, 0.5)), SR);
    const dirty = learnNoisePrint([burst.map((v, i) => (i % 22050 < 11000 ? v : v * 0.01))], SR);
    expect(dirty.loudnessSpreadDb > 6).toBe(true);
  });
});

describe('cleaning with a print', () => {
  const print = learnNoisePrint([noise(SR * 2, 11)], SR, 'test');

  it('keeps the length and, with nothing to remove, the audio', () => {
    const flat: NoisePrint = { ...print, power: print.power.map(() => 0) };
    for (const n of [1, 700, 1024, 5000, 33333]) {
      const input = tone(n, 500, 0.4);
      const out = run(input, flat, 18);
      expect(out.length).toBe(n);
      let worst = 0;
      for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(out[i] - input[i]));
      expect(worst).toBeLessThan(1e-5);
    }
  });

  it('takes the noise down by about the set amount and leaves speech-like sound alone', () => {
    const n = SR * 3;
    const input = noise(n, 99);
    const speech = tone(SR, 1000, 0.3);
    input.set(add(input.subarray(SR, SR * 2), speech), SR); // a 1 kHz tone in the middle second
    const out = run(input, print, 18);
    const noiseBefore = db(rms(input, 4000, SR - 4000));
    const noiseAfter = db(rms(out, 4000, SR - 4000));
    expect(noiseBefore - noiseAfter > 12).toBe(true);
    const toneBefore = db(rms(input, SR + 4000, SR * 2 - 4000));
    const toneAfter = db(rms(out, SR + 4000, SR * 2 - 4000));
    expect(Math.abs(toneBefore - toneAfter) < 1.5).toBe(true);
  });

  it('removes only what is in the print: a tone away from the hum and hiss band structure survives, the hum does not', () => {
    const n = SR * 2;
    const hum = tone(n, 120, 0.02);
    const wanted = tone(n, 2500, 0.1);
    const out = run(add(hum, wanted), print, 24, 1.5);
    // look at the 120 Hz and the 2500 Hz content separately by correlating with each
    const proj = (a: Float32Array, hz: number) => { let c = 0, s = 0; for (let i = 8000; i < a.length - 8000; i++) { c += a[i] * Math.cos((2 * Math.PI * hz * i) / SR); s += a[i] * Math.sin((2 * Math.PI * hz * i) / SR); } return Math.hypot(c, s) / (a.length - 16000) * 2; };
    expect(db(proj(out, 120) / proj(add(hum, wanted), 120)) < -10).toBe(true);
    expect(Math.abs(db(proj(out, 2500) / proj(add(hum, wanted), 2500))) < 1).toBe(true);
  });

  it('streamed in uneven pieces gives the same samples as the whole clip', () => {
    const input = add(noise(60000, 5), tone(60000, 700, 0.2).map((v, i) => (i > 20000 && i < 40000 ? v : 0)));
    const whole = run(input, print, 18, 2);
    for (const chunk of [300, 4096, 20000]) {
      const streamed = run(input, print, 18, 2, chunk);
      expect(streamed.length).toBe(whole.length);
      let worst = 0;
      for (let i = 0; i < whole.length; i++) worst = Math.max(worst, Math.abs(streamed[i] - whole[i]));
      expect(worst).toBeLessThan(1e-6);
    }
  });

  it('can use a print learned at another sample rate', () => {
    const other: NoisePrint = { ...print, sampleRate: 48000 };
    const out = run(noise(SR, 3), other, 18);
    expect(out.length).toBe(SR);
  });
});

describe('finding the quiet part', () => {
  it('picks the stretch with only background noise', () => {
    const n = SR * 6;
    const x = noise(n, 8);
    x.set(add(x.subarray(0, SR * 2), tone(SR * 2, 600, 0.4)), 0); // speech-like at the start
    x.set(add(x.subarray(SR * 4), tone(n - SR * 4, 900, 0.4)), SR * 4); // and at the end
    const spot = quietestStretch([x], SR, 1)!;
    expect(spot.start >= SR * 2 - 2200 && spot.end <= SR * 4 + 2200).toBe(true);
    expect(spot.end - spot.start).toBe(SR);
  });
  it('returns null when the audio is shorter than asked', () => {
    expect(quietestStretch([noise(1000, 1)], SR, 1)).toBe(null);
  });
});

describe('denoise with a print', () => {
  it('uses the print when the settings carry one, the basic gate otherwise', () => {
    const print = learnNoisePrint([noise(SR, 4)], SR);
    const x = noise(SR, 6);
    const withPrint = denoiseChannels([x], SR, { highPassFreq: 80, noiseFloorThresholdDb: -40, reductionDb: 18, print, sensitivity: 1.5 })[0];
    const direct = run(x, print, 18, 1.5);
    let worst = 0;
    for (let i = 0; i < x.length; i++) worst = Math.max(worst, Math.abs(withPrint[i] - direct[i]));
    expect(worst).toBeLessThan(1e-6);
    const gate = denoiseChannels([x], SR, { highPassFreq: 80, noiseFloorThresholdDb: -40, reductionDb: 18 })[0];
    let differs = 0;
    for (let i = 0; i < x.length; i++) differs = Math.max(differs, Math.abs(gate[i] - direct[i]));
    expect(differs > 1e-4).toBe(true);
  });
});

describe('dialling it in', () => {
  const print = learnNoisePrint([noise(SR * 2, 21)], SR, 'dial');
  // Voice-like: gliding harmonic tone in syllables, with the noise under everything
  const N2 = SR * 4;
  const voice = Float32Array.from({ length: N2 }, (_, i) => {
    const t = i / SR;
    const syl = Math.max(0, Math.sin(2 * Math.PI * 2.5 * t)) ** 0.7;
    let v = 0;
    for (let h = 1; h <= 10; h++) v += Math.sin(2 * Math.PI * (130 + 30 * Math.sin(2 * Math.PI * 0.7 * t)) * h * t) / h;
    return 0.18 * syl * v;
  });
  const bed = noise(N2, 77);
  const mix = add(voice, bed);
  const gaps: number[] = [];
  const talk: number[] = [];
  for (let i = SR / 2; i < N2 - SR / 2; i++) {
    const syl = Math.sin(2 * Math.PI * 2.5 * (i / SR));
    if (syl < -0.05) gaps.push(i);
    else if (syl > 0.5) talk.push(i);
  }
  const level = (a: Float32Array, idx: number[]) => { let s = 0; for (const i of idx) s += a[i] * a[i]; return db(Math.sqrt(s / idx.length)); };

  it('the Reduction dial sets how far the noise between words goes down (tracking it up to about 24 dB, then easing off)', () => {
    let previous = 0;
    for (const red of [8, 18, 28]) {
      const out = run(mix, print, red, 1.5);
      const got = level(mix, gaps) - level(out, gaps);
      expect(got > previous).toBe(true);
      if (red <= 18) expect(Math.abs(got - red) < 3).toBe(true);
      else expect(got > 21).toBe(true);
      previous = got;
    }
  });

  it('leaves the voice cleaner than it found it, not damaged', () => {
    const out = run(mix, print, 18, 1.5);
    let before = 0, after = 0, sig = 0;
    for (const i of talk) { before += (mix[i] - voice[i]) ** 2; after += (out[i] - voice[i]) ** 2; sig += voice[i] ** 2; }
    expect(after < before * 0.5).toBe(true);
    expect(10 * Math.log10(after / sig) < -15).toBe(true);
  });

  it('"hear removed" gives exactly what the cleaning took out', () => {
    const cleaned = run(mix, print, 18, 1.5);
    const st = new NoisePrintStage(mix.length, SR, print, { reductionDb: 18, sensitivity: 1.5, listenRemoved: true });
    const a = st.push(mix);
    const b = st.finish();
    const removed = new Float32Array(a.length + b.length);
    removed.set(a, 0);
    removed.set(b, a.length);
    let worst = 0;
    for (let i = 0; i < mix.length; i++) worst = Math.max(worst, Math.abs(cleaned[i] + removed[i] - mix[i]));
    expect(worst).toBeLessThan(1e-5);
  });
});
