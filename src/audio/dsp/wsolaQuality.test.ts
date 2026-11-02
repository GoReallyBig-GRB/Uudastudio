import { describe, expect, it } from 'vitest';
import { pitchStretchParams, speedStretchParams, wsolaTimeStretch, resampleChannel } from './wsola';
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
