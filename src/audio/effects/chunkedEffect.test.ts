import { describe, it, expect } from 'vitest';
import { overlapAddRender } from './chunkedEffect';

/** A linear effect with a tail: dry + an echo `delay` samples later at half level */
const echo = (delay: number) => (x: Float32Array): Float32Array => {
  const y = new Float32Array(x.length + delay);
  for (let i = 0; i < x.length; i++) { y[i] += x[i]; y[i + delay] += 0.5 * x[i]; }
  return y;
};

const run = async (input: Float32Array, blockFrames: number, delay: number) => {
  const sr = 1000;
  const chunks: Float32Array[] = [];
  const frames = await overlapAddRender({
    source: { totalFrames: input.length, read: async (s, n) => [input.slice(s, s + n)] },
    sampleRate: sr,
    blockSeconds: blockFrames / sr,
    render: async (b) => [echo(delay)(b[0])],
    write: async (c) => { chunks.push(c[0].slice()); },
  });
  const out = new Float32Array(frames);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
};

describe('overlapAddRender', () => {
  it('gives the same samples as rendering the whole clip at once, tail included', async () => {
    const x = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i * 0.1) + (i % 7) * 0.01);
    const whole = echo(120)(x);
    for (const block of [128, 333, 1000]) {
      const out = await run(x, block, 120);
      expect(out.length).toBe(whole.length);
      for (let i = 0; i < whole.length; i++) expect(Math.abs(out[i] - whole[i])).toBeLessThan(1e-6);
    }
  });
  it('handles a tail longer than a block', async () => {
    const x = Float32Array.from({ length: 300 }, (_, i) => (i === 0 ? 1 : 0.1));
    const whole = echo(250)(x);
    const out = await run(x, 100, 250);
    expect(out.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) expect(Math.abs(out[i] - whole[i])).toBeLessThan(1e-6);
  });
});
