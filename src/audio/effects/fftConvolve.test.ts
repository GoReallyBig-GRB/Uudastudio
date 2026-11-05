import { describe, it, expect } from 'vitest';
import { StereoConvolver, fft, nextPow2 } from './fftConvolve';

const direct = (x: Float32Array, h: Float32Array): Float32Array => {
  const y = new Float32Array(x.length + h.length - 1);
  for (let i = 0; i < x.length; i++) for (let k = 0; k < h.length; k++) y[i + k] += x[i] * h[k];
  return y;
};
const rnd = (len: number, seed: number) => {
  let s = seed;
  return Float32Array.from({ length: len }, () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 0xffffffff) * 2 - 1; });
};

describe('fft', () => {
  it('inverse undoes forward', () => {
    const re = rnd(64, 1), im = rnd(64, 2);
    const r0 = re.slice(), i0 = im.slice();
    fft(re, im, false);
    fft(re, im, true);
    for (let i = 0; i < 64; i++) { expect(Math.abs(re[i] - r0[i])).toBeLessThan(1e-5); expect(Math.abs(im[i] - i0[i])).toBeLessThan(1e-5); }
  });
  it('nextPow2', () => { expect(nextPow2(1)).toBe(1); expect(nextPow2(5)).toBe(8); expect(nextPow2(1024)).toBe(1024); });
});

describe('StereoConvolver', () => {
  it('matches direct convolution on both channels, with different responses', () => {
    const hL = rnd(37, 3), hR = rnd(41, 4);
    const xL = rnd(100, 5), xR = rnd(100, 6);
    const conv = new StereoConvolver(hL, hR, 256, 1);
    const [yL, yR] = conv.convolve(xL, xR);
    const eL = direct(xL, hL), eR = direct(xR, hR);
    // the convolver pads both responses to the longer one
    expect(yL.length).toBe(100 + 41 - 1);
    for (let i = 0; i < eL.length; i++) expect(Math.abs(yL[i] - eL[i])).toBeLessThan(1e-4);
    for (let i = 0; i < eR.length; i++) expect(Math.abs(yR[i] - eR[i])).toBeLessThan(1e-4);
  });
  it('applies the gain, and a shorter block than the maximum works', () => {
    const h = rnd(20, 7);
    const x = rnd(30, 8);
    const conv = new StereoConvolver(h, h, 128, 0.5);
    const [yL] = conv.convolve(x, x);
    const e = direct(x, h);
    for (let i = 0; i < e.length; i++) expect(Math.abs(yL[i] - e[i] * 0.5)).toBeLessThan(1e-4);
  });
  it('can be reused for several blocks', () => {
    const h = rnd(16, 9);
    const conv = new StereoConvolver(h, h, 128);
    for (const seed of [10, 11, 12]) {
      const x = rnd(50, seed);
      const [yL, yR] = conv.convolve(x, x);
      const e = direct(x, h);
      for (let i = 0; i < e.length; i++) { expect(Math.abs(yL[i] - e[i])).toBeLessThan(1e-4); expect(Math.abs(yR[i] - e[i])).toBeLessThan(1e-4); }
    }
  });
});
