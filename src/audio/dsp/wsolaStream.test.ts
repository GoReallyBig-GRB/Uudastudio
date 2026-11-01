import { describe, expect, it } from 'vitest';
import { resampleChannel, wsolaTimeStretch } from './wsola';
import { HermiteResampler, PitchShiftStage, Stage, WsolaStretcher } from './wsolaStream';

/** Deterministic pseudo-speech: a few sines with a slow amplitude wobble plus a little noise */
const signal = (n: number): Float32Array => {
  const out = new Float32Array(n);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff - 0.5; };
  for (let i = 0; i < n; i++) {
    const t = i / 44100;
    out[i] = 0.4 * Math.sin(2 * Math.PI * 180 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t)) + 0.2 * Math.sin(2 * Math.PI * 470 * t) + 0.02 * rnd();
  }
  return out;
};

/** Push in uneven chunks, collect everything */
const run = (stage: Stage, input: Float32Array, chunk: number): Float32Array => {
  const parts: Float32Array[] = [];
  for (let i = 0; i < input.length; i += chunk) {
    const size = chunk + (i % 3) * 37; // uneven sizes
    parts.push(stage.push(input.subarray(i, Math.min(input.length, i + size))));
    if (size !== chunk) i += (i % 3) * 37;
  }
  parts.push(stage.finish());
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

const same = (a: Float32Array, b: Float32Array) => {
  expect(a.length).toBe(b.length);
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  expect(worst).toBeLessThan(1e-6);
};

describe('streaming resampler', () => {
  for (const ratio of [0.5, 0.8909, 1.2599, 2]) {
    it(`matches the whole-buffer resampler at ratio ${ratio}`, () => {
      const input = signal(30000);
      same(run(new HermiteResampler(input.length, ratio), input, 4000), resampleChannel(input, ratio));
    });
  }
});

describe('streaming WSOLA', () => {
  for (const speed of [0.5, 0.9, 1.3, 2]) {
    it(`matches the whole-buffer stretch at speed ${speed}`, () => {
      const input = signal(40000);
      same(run(new WsolaStretcher(input.length, speed), input, 3000), wsolaTimeStretch(input, speed));
    });
  }
  it('gives the same result whatever the chunk size', () => {
    const input = signal(25000);
    same(run(new WsolaStretcher(input.length, 1.5), input, 700), run(new WsolaStretcher(input.length, 1.5), input, 9000));
  });
  it('very short input is handled whole', () => {
    const input = signal(800);
    same(run(new WsolaStretcher(input.length, 1.5), input, 300), wsolaTimeStretch(input, 1.5));
  });
});

describe('streaming pitch shift', () => {
  for (const semis of [-5, 3, 7]) {
    it(`matches the whole-buffer pitch shift at ${semis} semitones`, () => {
      const input = signal(40000);
      const ratio = Math.pow(2, semis / 12);
      const expected = new Float32Array(input.length);
      const stretched = wsolaTimeStretch(resampleChannel(input, ratio), 1 / ratio);
      expected.set(stretched.subarray(0, Math.min(stretched.length, input.length)));
      same(run(new PitchShiftStage(input.length, semis), input, 5000), expected);
    });
  }
});
