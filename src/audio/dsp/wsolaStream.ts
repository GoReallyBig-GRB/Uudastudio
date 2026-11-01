/**
 * Streaming versions of the WSOLA time-stretch and the cubic-Hermite resampler in `wsola.ts`.
 *
 * Audio is pushed in pieces (any size) and finished audio comes out as soon as it is final, so a clip of any length is
 * stretched or pitch-shifted with flat memory. The arithmetic is the same as the whole-buffer functions, step for step, so
 * the streamed result equals the whole-buffer result: there are no seams where blocks meet (see wsolaStream.test.ts).
 * The total input length must be known up front (it is: the clip's length).
 */
import { resampleChannel, wsolaTimeStretch } from './wsola';

const FRAME_SIZE = 1024;
const SYN_HOP = 256;

export interface Stage {
  /** Feed more input; returns the output that is now final (possibly empty) */
  push(chunk: Float32Array): Float32Array;
  /** Call after all input was pushed; returns the rest of the output */
  finish(): Float32Array;
}

const concat = (parts: Float32Array[], total: number): Float32Array => {
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/** Cubic-Hermite resampler, same output as `resampleChannel(allInput, ratio)`. */
export class HermiteResampler implements Stage {
  private buf = new Float32Array(0);
  private base = 0; // absolute index of buf[0]
  private received = 0;
  private next = 0; // next output index to produce
  private readonly outLength: number;
  private readonly maxIdx: number;

  constructor(private readonly totalIn: number, private readonly ratio: number) {
    this.outLength = Math.max(1, Math.round(totalIn / ratio));
    this.maxIdx = totalIn - 1;
  }

  private at(abs: number): number {
    const i = Math.max(0, Math.min(this.maxIdx, abs));
    return this.buf[i - this.base];
  }

  private run(final: boolean): Float32Array {
    const out: number[] = [];
    while (this.next < this.outLength) {
      const srcPos = this.next * this.ratio;
      const srcIndex = Math.floor(srcPos);
      const need = Math.min(this.maxIdx, srcIndex + 2);
      if (!final && this.received <= need) break;
      const frac = srcPos - srcIndex;
      const p0 = this.at(srcIndex - 1);
      const p1 = this.at(srcIndex);
      const p2 = this.at(srcIndex + 1);
      const p3 = this.at(srcIndex + 2);
      const c0 = p1;
      const c1 = 0.5 * (p2 - p0);
      const c2 = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
      const c3 = 0.5 * (p3 - p0) + 1.5 * (p1 - p2);
      const val = ((c3 * frac + c2) * frac + c1) * frac + c0;
      out.push(Number.isFinite(val) ? val : 0);
      this.next += 1;
    }
    // Drop input that no later output can reach
    const keepFrom = Math.max(0, Math.floor(this.next * this.ratio) - 2);
    if (keepFrom > this.base) {
      this.buf = this.buf.slice(keepFrom - this.base);
      this.base = keepFrom;
    }
    return Float32Array.from(out);
  }

  push(chunk: Float32Array): Float32Array {
    const merged = new Float32Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
    this.received += chunk.length;
    return this.run(false);
  }

  finish(): Float32Array {
    return this.run(true);
  }
}

/** WSOLA time stretch, same output as `wsolaTimeStretch(allInput, speedRatio)`. */
export class WsolaStretcher implements Stage {
  private readonly anaHop: number;
  private readonly searchRange: number;
  private readonly outLength: number;
  private readonly window: Float32Array;
  private inBuf = new Float32Array(0);
  private inBase = 0;
  private received = 0;
  private out = new Float32Array(0);
  private weight = new Float32Array(0);
  private outBase = 0; // absolute output index of out[0]
  private outPos = 0;
  private inPos = 0;
  private emitted = 0;
  /** Inputs too short for the algorithm are collected and handled whole */
  private readonly whole: Float32Array[] | null;

  constructor(private readonly totalIn: number, private readonly speed: number) {
    this.anaHop = Math.max(1, Math.round(SYN_HOP * speed));
    this.searchRange = Math.max(1, Math.round(SYN_HOP / 2));
    this.outLength = Math.max(1, Math.round(totalIn / speed));
    this.window = new Float32Array(FRAME_SIZE);
    for (let i = 0; i < FRAME_SIZE; i++) this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FRAME_SIZE - 1)));
    this.whole = totalIn <= FRAME_SIZE ? [] : null;
  }

  private ensureOut(absEnd: number): void {
    const need = absEnd - this.outBase;
    if (need <= this.out.length) return;
    const size = Math.max(need, this.out.length * 2, FRAME_SIZE * 4);
    const o = new Float32Array(size);
    const w = new Float32Array(size);
    o.set(this.out);
    w.set(this.weight);
    this.out = o;
    this.weight = w;
  }

  /** Normalised value of absolute output index i (what the whole-buffer function stores in its result) */
  private finalValue(abs: number): number {
    const k = abs - this.outBase;
    if (k < 0 || k >= this.out.length) return 0;
    const w = this.weight[k];
    const val = w > 0.001 ? this.out[k] / w : this.out[k];
    return Number.isFinite(val) ? val : 0;
  }

  private emitUpTo(limit: number): Float32Array {
    const upto = Math.min(limit, this.outLength);
    const n = Math.max(0, upto - this.emitted);
    const res = new Float32Array(n);
    for (let i = 0; i < n; i++) res[i] = this.finalValue(this.emitted + i);
    this.emitted += n;
    // Keep what the next similarity search still reads (from outPos - synHop)
    const keep = Math.max(this.outBase, Math.min(this.emitted, this.outPos - SYN_HOP));
    if (keep > this.outBase) {
      const cut = keep - this.outBase;
      this.out = this.out.slice(cut);
      this.weight = this.weight.slice(cut);
      this.outBase = keep;
    }
    return res;
  }

  private run(): void {
    const total = this.totalIn;
    while (this.outPos < this.outLength && this.inPos + FRAME_SIZE < total) {
      const need = Math.min(total, this.inPos + this.searchRange + FRAME_SIZE + 1);
      if (this.received < need) break; // wait for more input
      const inAt = (abs: number) => this.inBuf[abs - this.inBase];
      let bestOffset = 0;
      if (this.outPos > 0) {
        let maxCorr = -Infinity;
        const targetPos = Math.max(0, this.outPos - SYN_HOP);
        for (let delta = -this.searchRange; delta <= this.searchRange; delta += 2) {
          const candidateIn = this.inPos + delta;
          if (candidateIn < 0 || candidateIn + FRAME_SIZE >= total) continue;
          let corr = 0;
          for (let i = 0; i < FRAME_SIZE; i += 4) {
            const s1 = inAt(candidateIn + i);
            const k = targetPos + i - this.outBase;
            const s2 = k >= 0 && k < this.out.length ? this.out[k] : 0;
            if (Number.isFinite(s1) && Number.isFinite(s2)) corr += s1 * s2;
          }
          if (corr > maxCorr) {
            maxCorr = corr;
            bestOffset = delta;
          }
        }
      }
      const actualIn = Math.max(0, Math.min(total - FRAME_SIZE, this.inPos + bestOffset));
      this.ensureOut(this.outPos + FRAME_SIZE);
      for (let i = 0; i < FRAME_SIZE; i++) {
        const idx = this.outPos + i;
        if (idx < this.outLength + FRAME_SIZE) {
          const sampleVal = inAt(actualIn + i) * this.window[i];
          if (Number.isFinite(sampleVal)) {
            const k = idx - this.outBase;
            this.out[k] += sampleVal;
            this.weight[k] += this.window[i];
          }
        }
      }
      this.outPos += SYN_HOP;
      this.inPos += this.anaHop;
    }
  }

  private dropInput(): void {
    const keepFrom = Math.max(0, this.inPos - this.searchRange - 2);
    const cut = Math.min(keepFrom - this.inBase, this.inBuf.length);
    if (cut > 0) {
      this.inBuf = this.inBuf.slice(cut);
      this.inBase += cut;
    }
  }

  push(chunk: Float32Array): Float32Array {
    if (this.whole) { this.whole.push(chunk.slice()); return new Float32Array(0); }
    const merged = new Float32Array(this.inBuf.length + chunk.length);
    merged.set(this.inBuf);
    merged.set(chunk, this.inBuf.length);
    this.inBuf = merged;
    this.received += chunk.length;
    this.run();
    const res = this.emitUpTo(this.outPos - SYN_HOP);
    this.dropInput();
    return res;
  }

  finish(): Float32Array {
    if (this.whole) {
      const all = concat(this.whole, this.whole.reduce((n, p) => n + p.length, 0));
      return all.length === 0 ? new Float32Array(0) : wsolaTimeStretch(all, this.speed);
    }
    this.run();
    return this.emitUpTo(this.outLength);
  }
}

/**
 * Pitch shift that keeps the length: resample by the pitch ratio, then stretch back, as `processPitchShift` does for a whole
 * buffer, with the output cut or padded to exactly the input length.
 */
export class PitchShiftStage implements Stage {
  private readonly resampler: HermiteResampler;
  private readonly stretcher: WsolaStretcher;
  private produced = 0;

  constructor(private readonly totalIn: number, semitones: number) {
    const ratio = Math.pow(2, Math.max(-24, Math.min(24, semitones)) / 12);
    this.resampler = new HermiteResampler(totalIn, ratio);
    this.stretcher = new WsolaStretcher(Math.max(1, Math.round(totalIn / ratio)), 1 / ratio);
  }

  private clip(part: Float32Array): Float32Array {
    const room = Math.max(0, this.totalIn - this.produced);
    const out = part.length > room ? part.subarray(0, room) : part;
    this.produced += out.length;
    return out;
  }

  push(chunk: Float32Array): Float32Array {
    return this.clip(this.stretcher.push(this.resampler.push(chunk)));
  }

  finish(): Float32Array {
    const a = this.stretcher.push(this.resampler.finish());
    const b = this.stretcher.finish();
    const out = this.clip(concat([a, b], a.length + b.length));
    // Like the whole-buffer version: padded with silence if the stretch came out short
    if (this.produced < this.totalIn) {
      const pad = new Float32Array(this.totalIn - this.produced);
      this.produced = this.totalIn;
      return concat([out, pad], out.length + pad.length);
    }
    return out;
  }
}
