/**
 * Fast convolution for long impulse responses (reverb), in plain JavaScript so it can run in a Web Worker.
 * The browser's own ConvolverNode is far slower than this for long clips when rendering offline, so reverb is rendered
 * here instead: one forward and one inverse FFT per block, both channels packed into a single complex transform.
 * Everything is Float32 (error is about -110 dB, far below audibility) to halve memory and keep the transforms in cache.
 */

export const nextPow2 = (n: number): number => {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
};

interface Tables { cos: Float32Array; sin: Float32Array; rev: Uint32Array }
const tableCache = new Map<number, Tables>();

const tablesFor = (n: number): Tables => {
  let t = tableCache.get(n);
  if (t) return t;
  const cos = new Float32Array(n / 2);
  const sin = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    const a = (2 * Math.PI * i) / n;
    cos[i] = Math.cos(a);
    sin[i] = Math.sin(a);
  }
  const rev = new Uint32Array(n);
  const bits = Math.round(Math.log2(n));
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  t = { cos, sin, rev };
  tableCache.set(n, t);
  return t;
};

/** In-place complex FFT (radix 2, power-of-two length). The inverse is scaled by 1/n. */
export const fft = (re: Float32Array, im: Float32Array, inverse: boolean): void => {
  const n = re.length;
  const { cos, sin, rev } = tablesFor(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0, t = 0; k < half; k++, t += step) {
        const wr = cos[t];
        const wi = sign * sin[t];
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
  if (inverse) {
    const s = 1 / n;
    for (let i = 0; i < n; i++) { re[i] *= s; im[i] *= s; }
  }
};

/**
 * Convolves a stereo signal with a stereo impulse response (left with left, right with right).
 * `n` is the transform size: the longest block it accepts is n - irLength + 1 frames.
 */
export class StereoConvolver {
  readonly n: number;
  readonly irLength: number;
  private hLr: Float32Array;
  private hLi: Float32Array;
  private hRr: Float32Array;
  private hRi: Float32Array;
  private re: Float32Array;
  private im: Float32Array;

  /** `gain` is folded into the impulse response (wet level, loudness normalisation) */
  constructor(irL: Float32Array, irR: Float32Array, n: number, gain = 1) {
    this.n = n;
    this.irLength = Math.max(irL.length, irR.length);
    if (this.irLength > n) throw new Error('Impulse response is longer than the transform');
    const zr = new Float32Array(n);
    const zi = new Float32Array(n);
    zr.set(irL);
    zi.set(irR);
    fft(zr, zi, false);
    this.hLr = new Float32Array(n);
    this.hLi = new Float32Array(n);
    this.hRr = new Float32Array(n);
    this.hRi = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const j = (n - k) & (n - 1);
      this.hLr[k] = ((zr[k] + zr[j]) / 2) * gain;
      this.hLi[k] = ((zi[k] - zi[j]) / 2) * gain;
      this.hRr[k] = ((zi[k] + zi[j]) / 2) * gain;
      this.hRi[k] = (-(zr[k] - zr[j]) / 2) * gain;
    }
    this.re = zr;
    this.im = zi;
  }

  get maxBlock(): number {
    return this.n - this.irLength + 1;
  }

  /** Returns [left, right], each xL.length + irLength - 1 frames long (the block plus the decay tail) */
  convolve(xL: Float32Array, xR: Float32Array): [Float32Array, Float32Array] {
    const { n, re, im } = this;
    const len = xL.length;
    if (len > this.maxBlock) throw new Error('Block is longer than the transform allows');
    re.fill(0);
    im.fill(0);
    re.set(xL);
    im.set(xR.length === len ? xR : xR.subarray(0, len));
    fft(re, im, false);
    const { hLr, hLi, hRr, hRi } = this;
    // Pull the two channel spectra apart, multiply each by its response, and pack the products back into one spectrum.
    for (let k = 0; k <= n >> 1; k++) {
      const j = (n - k) & (n - 1);
      const zkr = re[k], zki = im[k], zjr = re[j], zji = im[j];
      // channel spectra at k
      const lkr = (zkr + zjr) / 2, lki = (zki - zji) / 2;
      const rkr = (zki + zji) / 2, rki = -(zkr - zjr) / 2;
      // channel spectra at j (roles swapped)
      const ljr = (zjr + zkr) / 2, lji = (zji - zki) / 2;
      const rjr = (zji + zki) / 2, rji = -(zjr - zkr) / 2;
      // products at k
      const ylkr = lkr * hLr[k] - lki * hLi[k], ylki = lkr * hLi[k] + lki * hLr[k];
      const yrkr = rkr * hRr[k] - rki * hRi[k], yrki = rkr * hRi[k] + rki * hRr[k];
      // products at j
      const yljr = ljr * hLr[j] - lji * hLi[j],ylji = ljr * hLi[j] + lji * hLr[j];
      const yrjr = rjr * hRr[j] - rji * hRi[j], yrji = rjr * hRi[j] + rji * hRr[j];
      re[k] = ylkr - yrki;
      im[k] = ylki + yrkr;
      re[j] = yljr - yrji;
      im[j] = ylji + yrjr;
    }
    fft(re, im, true);
    const outLen = len + this.irLength - 1;
    return [re.slice(0, outLen), im.slice(0, outLen)];
  }
}
