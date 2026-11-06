import { describe, expect, it } from 'vitest';
import { createSegmentedChannel, planSegments } from './segmentedStretch';
import { PitchShiftStage, WsolaStretcher } from './wsolaStream';
import { pitchStretchParams, speedStretchParams } from './wsola';

const SR = 44100;
const sine = (hz: number, seconds: number, amp = 0.5): Float32Array =>
  Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));

const concat = (parts: Float32Array[]) => {
  const y = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { y.set(p, o); o += p.length; }
  return y;
};

const speedSegment = (ratio: number) => async (input: Float32Array) => {
  const st = new WsolaStretcher(input.length, ratio, speedStretchParams(SR));
  return concat([st.push(input), st.finish()]);
};
const pitchSegment = (semis: number) => async (input: Float32Array) => {
  const st = new PitchShiftStage(input.length, semis, SR);
  return concat([st.push(input), st.finish()]);
};

const run = async (x: Float32Array, o: Parameters<typeof createSegmentedChannel>[0]) => {
  const ch = createSegmentedChannel(o);
  const parts: Float32Array[] = [];
  for (let i = 0; i < x.length; i += 30000) parts.push(await ch.push(x.subarray(i, Math.min(x.length, i + 30000))));
  parts.push(await ch.finish());
  return concat(parts);
};

const frequency = (x: Float32Array, from: number, to: number): number => {
  let first = -1, last = -1, n = 0;
  for (let i = from + 1; i < to; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      const at = i - 1 + -x[i - 1] / (x[i] - x[i - 1]);
      if (first < 0) first = at;
      last = at; n++;
    }
  }
  return ((n - 1) * SR) / (last - first);
};

describe('planSegments', () => {
  it('cuts into equal pieces covering everything', () => {
    const b = planSegments(1000, 300);
    expect(b[0]).toBe(0);
    expect(b[b.length - 1]).toBe(1000);
    expect(b.length).toBe(4);
    expect(planSegments(100, 300)).toEqual([0, 100]);
  });
});

describe('segmented speed', () => {
  for (const ratio of [0.8, 1.25]) {
    it(`ratio ${ratio}: right length, pitch kept, no jumps at joins`, async () => {
      const x = sine(180, 12);
      const params = speedStretchParams(SR);
      const y = await run(x, { totalFrames: x.length, ratio, frame: params.frame, search: params.search, segmentFrames: 3 * SR, runSegment: speedSegment(ratio), maxInFlight: 3 });
      expect(y.length).toBe(Math.round(x.length / ratio));
      expect(Math.abs(1200 * Math.log2(frequency(y, SR, y.length - SR) / 180))).toBeLessThan(3);
      // A steady tone: no sample-to-sample step bigger than the tone itself can make, and level held everywhere
      let maxStep = 0;
      for (let i = 1; i < y.length; i++) maxStep = Math.max(maxStep, Math.abs(y[i] - y[i - 1]));
      expect(maxStep).toBeLessThan(2 * Math.PI * 180 / SR * 0.5 * 1.5);
      const win = 4096;
      for (let s = 0; s + win < y.length; s += SR / 2) {
        let e = 0; for (let i = 0; i < win; i++) e += y[s + i] * y[s + i];
        expect(Math.sqrt(e / win)).toBeGreaterThan(0.25);
      }
    });
  }
});

describe('segmented pitch', () => {
  it('+3 semitones: same length, target pitch', async () => {
    const x = sine(150, 12);
    const p = pitchStretchParams(Math.pow(2, 3 / 12), SR);
    const y = await run(x, { totalFrames: x.length, ratio: 1, frame: p.frame, search: p.search, segmentFrames: 3 * SR, runSegment: pitchSegment(3), maxInFlight: 3 });
    expect(y.length).toBe(x.length);
    const target = 150 * Math.pow(2, 3 / 12);
    expect(Math.abs(1200 * Math.log2(frequency(y, SR, y.length - SR) / target))).toBeLessThan(4);
  });
  it('a single segment equals the plain run', async () => {
    const x = sine(150, 3);
    const p = pitchStretchParams(Math.pow(2, 3 / 12), SR);
    const y = await run(x, { totalFrames: x.length, ratio: 1, frame: p.frame, search: p.search, segmentFrames: 100 * SR, runSegment: pitchSegment(3), maxInFlight: 2 });
    const ref = await pitchSegment(3)(x);
    expect(y.length).toBe(ref.length);
    expect(y[1000]).toBeCloseTo(ref[1000], 6);
  });
});
