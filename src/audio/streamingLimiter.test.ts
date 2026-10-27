import { describe, expect, it } from 'vitest';
import { LookaheadLimiter } from './streamingLimiter';

function referenceLimiter(
  input: Float32Array,
  ceiling: number,
  windowSize: number,
  releaseCoeff: number
): Float32Array {
  const output = new Float32Array(input.length);
  let envelope = 0;
  for (let i = 0; i < input.length; i++) {
    let maxFuture = 0;
    for (let j = i; j < Math.min(input.length, i + windowSize); j++) {
      maxFuture = Math.max(maxFuture, Math.abs(input[j]));
    }
    envelope = maxFuture > envelope
      ? maxFuture
      : maxFuture + releaseCoeff * (envelope - maxFuture);
    const gain = envelope > ceiling ? ceiling / envelope : 1;
    output[i] = Math.max(-ceiling, Math.min(ceiling, input[i] * gain));
  }
  return output;
}

async function applyLookaheadLimiterChannel(input: Float32Array, out: Float32Array, ceiling: number, window: number, release: number) {
  const lim = new LookaheadLimiter(ceiling, window, release);
  const a = lim.process(input);
  out.set(a, 0);
  out.set(lim.finish(), a.length);
}

describe('LookaheadLimiter against the reference algorithm', () => {
  it('matches the reference sliding-window algorithm at boundaries and for peaks', async () => {
    const cases = [
      new Float32Array([0, 0.2, -0.4, 1.2, -1.4, 0.1, 0]),
      new Float32Array([0.9]),
      new Float32Array([0.4, -0.2, 0.1, 0.8, -0.7, 0.3, 0.2, -0.1]),
      new Float32Array(0),
    ];
    const ceiling = 0.89125;
    const windowSize = 3;
    const releaseCoeff = 0.995;

    for (const input of cases) {
      const actual = new Float32Array(input.length);
      await applyLookaheadLimiterChannel(input, actual, ceiling, windowSize, releaseCoeff);
      const expected = referenceLimiter(input, ceiling, windowSize, releaseCoeff);
      expect(Array.from(actual)).toEqual(Array.from(expected));
    }
  });

  it('uses bounded temporary state for lookahead instead of a full-file gain array', async () => {
    const input = Float32Array.from({ length: 4097 }, (_, i) => Math.sin(i * 0.071) * (i % 37 === 0 ? 1.4 : 0.7));
    const actual = new Float32Array(input.length);
    await applyLookaheadLimiterChannel(input, actual, 0.8, 97, 0.99);
    const expected = referenceLimiter(input, 0.8, 97, 0.99);
    for (let i = 0; i < actual.length; i++) expect(actual[i]).toBeCloseTo(expected[i], 6);
  });
});

describe('LookaheadLimiter in blocks', () => {
  it('is identical to the reference however the input is cut up', () => {
    const input = Float32Array.from({ length: 9001 }, (_, i) => Math.sin(i * 0.071) * (i % 211 === 0 ? 1.6 : 0.7));
    const expected = referenceLimiter(input, 0.8, 97, 0.99);
    for (const sizes of [[9001], [1], [97, 96, 98, 5000], [4000, 1, 4999, 1]]) {
      const lim = new LookaheadLimiter(0.8, 97, 0.99);
      const out: number[] = [];
      let at = 0, k = 0;
      while (at < input.length) {
        const n = Math.min(sizes[k++ % sizes.length], input.length - at);
        out.push(...lim.process(input.subarray(at, at + n)));
        at += n;
      }
      out.push(...lim.finish());
      expect(out.length).toBe(input.length);
      expect(out).toEqual(Array.from(expected));
    }
  });
});

