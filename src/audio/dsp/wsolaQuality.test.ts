import { describe, expect, it } from 'vitest';
import { chooseOffset, pitchStretchParams, speedStretchParams, wsolaTimeStretch, resampleChannel } from './wsola';
import { PitchShiftStage, WsolaStretcher } from './wsolaStream';

const SR = 44100;
const sine = (hz: number, seconds: number, amp = 0.5): Float32Array =>
  Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));

/** Frequency of a clean tone from its rising zero crossings */
const frequency = (x: Float32Array, from: number, to: number): number => {
  let first = -1;
  let last = -1;
  let n = 0;
  for (let i = from + 1; i < to; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      const at = i - 1 + -x[i - 1] / (x[i] - x[i - 1]);
      if (first < 0) first = at;
      last = at;
      n++;
    }
  }
  return ((n - 1) * SR) / (last - first);
};
const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

describe('time stretch keeps the pitch', () => {
  for (const hz of [110, 220]) {
    for (const speed of [0.6, 1.25]) {
      it(`${hz} Hz tone at speed ${speed} stays within 2 cents`, () => {
        const y = wsolaTimeStretch(sine(hz, 3), speed, speedStretchParams(SR));
        expect(Math.abs(cents(frequency(y, SR / 2, y.length - SR / 2), hz))).toBeLessThan(2);
      });
    }
  }
});

describe('pitch shift lands on the target pitch', () => {
  for (const [hz, semis] of [[110, -12], [110, 7], [220, 12], [150, -5]] as const) {
    it(`${hz} Hz tone shifted by ${semis} semitones is within 3 cents`, () => {
      const x = sine(hz, 3);
      const st = new PitchShiftStage(x.length, semis, SR);
      const a = st.push(x);
      const b = st.finish();
      const y = new Float32Array(a.length + b.length);
      y.set(a);
      y.set(b, a.length);
      expect(y.length).toBe(x.length);
      const target = hz * Math.pow(2, semis / 12);
      expect(Math.abs(cents(frequency(y, SR / 2, y.length - SR / 2), target))).toBeLessThan(3);
    });
  }
});

describe('stretched piece joins its neighbours cleanly', () => {
  for (const speed of [0.6, 0.8, 1.25, 1.6]) {
    it(`speed ${speed}: right length, exact first and last samples, no silent or dipped tail`, () => {
      const x = sine(180, 2);
      const y = wsolaTimeStretch(x, speed, speedStretchParams(SR));
      expect(y.length).toBe(Math.round(x.length / speed));
      expect(y[0]).toBeCloseTo(x[0], 6);
      expect(y[y.length - 1]).toBeCloseTo(x[x.length - 1], 6);
      const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
      // A steady tone must keep its level right up to both ends
      expect(rms(y.subarray(y.length - 2048))).toBeGreaterThan(0.9 * rms(y.subarray(SR / 2, SR / 2 + 2048)));
      expect(rms(y.subarray(0, 2048))).toBeGreaterThan(0.9 * rms(y.subarray(SR / 2, SR / 2 + 2048)));
    });
  }
  it('the streaming stage gives the same edges', () => {
    const x = sine(180, 2);
    const st = new WsolaStretcher(x.length, 0.8, speedStretchParams(SR));
    const parts = [st.push(x.subarray(0, 30000)), st.push(x.subarray(30000)), st.finish()];
    const y = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { y.set(p, o); o += p.length; }
    expect(y.length).toBe(Math.round(x.length / 0.8));
    expect(y[y.length - 1]).toBeCloseTo(x[x.length - 1], 6);
  });
});

describe('very short pieces', () => {
  it('are resampled to the right length', () => {
    const x = sine(300, 0.02);
    expect(wsolaTimeStretch(x, 1.5, speedStretchParams(SR)).length).toBe(resampleChannel(x, 1.5).length);
    expect(pitchStretchParams(0.5, SR).frame).toBeGreaterThan(speedStretchParams(SR).frame - 1);
  });
});

describe('the quick offset search finds nearly the best match', () => {
  /** A voice-like signal: pulses at a gliding pitch through two resonances, with a changing loudness */
  const voice = (seconds: number): Float32Array => {
    let seed = 99;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const x = new Float32Array(Math.round(seconds * SR));
    const res = (f: number, bw: number) => { const r = Math.exp((-Math.PI * bw) / SR); return [2 * r * Math.cos((2 * Math.PI * f) / SR), -r * r]; };
    const [ca, da] = res(700, 90);
    const [cb, db] = res(1200, 110);
    let ph = 0; let a1 = 0; let a2 = 0; let b1 = 0; let b2 = 0;
    for (let i = 0; i < x.length; i++) {
      ph += (110 + 60 * Math.sin((i / SR) * 1.3)) / SR;
      let pulse = 0;
      if (ph >= 1) { ph -= 1; pulse = 1; }
      const env = 0.5 + 0.5 * Math.sin((i / SR) * 2.2);
      const g = pulse * env * 3 + rand() * 0.02 * env;
      const a = g + ca * a1 + da * a2; a2 = a1; a1 = a;
      const b = g + cb * b1 + db * b2; b2 = b1; b1 = b;
      x[i] = 0.05 * (a + 0.6 * b);
    }
    return x;
  };

  for (const [label, speed, params] of [['speed 1.25', 1.25, speedStretchParams(SR)], ['pitch +3', 1 / Math.pow(2, 3 / 12), pitchStretchParams(Math.pow(2, 3 / 12), SR)]] as const) {
    it(`${label}: the chosen shift scores within a hair of the exhaustive best`, () => {
      const x = voice(6);
      const { frame, hop, search } = params;
      const span = frame - hop;
      const sub = Math.max(4, Math.round(frame / 600));
      const outLength = Math.round(x.length / speed);
      const out = new Float32Array(outLength + frame);
      const win = Float32Array.from({ length: frame }, (_, i) => 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frame - 1))));
      const anaHop = Math.round(hop * speed);
      const scoreAt = (nominal: number, outPos: number, d: number) => {
        const c = nominal + d;
        if (c < 0 || c + frame > x.length) return -Infinity;
        let cr = 0; let e1 = 0; let e2 = 0;
        for (let i = 0; i < span; i += sub) { const a = x[c + i]; const b = out[outPos + i]; cr += a * b; e1 += a * a; e2 += b * b; }
        return cr / Math.sqrt(e1 * e2 + 1e-9);
      };
      const ratios: number[] = [];
      for (let outPos = 0, inPos = 0; outPos < outLength; outPos += hop, inPos += anaHop) {
        const nominal = Math.max(0, Math.min(inPos, x.length - frame));
        let off = 0;
        if (outPos > 0) {
          off = chooseOffset(params, x, 0, out, 0, nominal, outPos, x.length);
          let best = -Infinity;
          for (let d = -search; d <= search; d++) best = Math.max(best, scoreAt(nominal, outPos, d));
          if (best > 0.05) ratios.push(scoreAt(nominal, outPos, off) / best);
        }
        const a = Math.max(0, Math.min(x.length - frame, nominal + off));
        for (let i = 0; i < frame; i++) out[outPos + i] += x[a + i] * win[i];
      }
      ratios.sort((p, q) => p - q);
      const mean = ratios.reduce((n, v) => n + v, 0) / ratios.length;
      expect(mean).toBeGreaterThan(0.99);
      expect(ratios[Math.floor(ratios.length * 0.01)]).toBeGreaterThan(0.9);
    });
  }
});
