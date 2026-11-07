/**
 * Streaming versions of the WSOLA time-stretch and the cubic-Hermite resampler in `wsola.ts`.
 *
 * Audio is pushed in pieces (any size) and finished audio comes out as soon as it is final, so a clip of any length is
 * stretched or pitch-shifted with flat memory. The arithmetic is the same as the whole-buffer functions, step for step, so
 * the streamed result equals the whole-buffer result: there are no seams where blocks meet (see wsolaStream.test.ts).
 * The total input length must be known up front (it is: the clip's length).
 */
import { HighRestorer, HighpassStream } from './highRestore';
import { StretchParams, chooseOffset, edgeGuardLength, edgeGuardWeight, pitchStretchParams, resampleChannel, speedStretchParams, wsolaTimeStretch } from './wsola';

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

/** WSOLA time stretch, same output as `wsolaTimeStretch(allInput, speedRatio, params)`. */
export class WsolaStretcher implements Stage {
  private readonly frame: number;
  private readonly hop: number;
  private readonly anaHop: number;
  private readonly searchRange: number;
  private readonly outLength: number;
  private readonly window: Float32Array;
  private inBuf = new Float32Array(0);
  private inBase = 0;
  private received = 0;
  private out = new Float32Array(0);
  private weight = new Float32Array(0);
  /** High band of the input (aligned with inBuf), and the high-band sums that go with out/weight (see highRestore.ts) */
  private hpBuf = new Float32Array(0);
  private hiOut = new Float32Array(0);
  private hiPow = new Float32Array(0);
  private readonly highpass: HighpassStream;
  private readonly restorer: HighRestorer;
  private outBase = 0; // absolute output index of out[0]
  private outPos = 0;
  private inPos = 0;
  private emitted = 0;
  /** First and last input samples, kept for the edge guard */
  private readonly guard: number;
  private head = new Float32Array(0);
  private tail = new Float32Array(0);
  /** Inputs too short for the algorithm are collected and handled whole */
  private readonly whole: Float32Array[] | null;

  constructor(private readonly totalIn: number, private readonly speed: number, private readonly params: StretchParams = speedStretchParams()) {
    this.frame = params.frame;
    this.hop = params.hop;
    this.anaHop = Math.max(1, Math.round(params.hop * speed));
    this.searchRange = params.search;
    this.outLength = Math.max(1, Math.round(totalIn / speed));
    this.window = new Float32Array(this.frame);
    for (let i = 0; i < this.frame; i++) this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (this.frame - 1)));
    this.highpass = new HighpassStream(params.rate ?? 48000);
    this.restorer = new HighRestorer(params.rate ?? 48000);
    this.guard = Math.min(edgeGuardLength(params), this.outLength >> 1);
    this.whole = totalIn <= this.frame || this.outLength <= this.frame ? [] : null;
  }

  private ensureOut(absEnd: number): void {
    const need = absEnd - this.outBase;
    if (need <= this.out.length) return;
    const size = Math.max(need, this.out.length * 2, this.frame * 4);
    const o = new Float32Array(size);
    const w = new Float32Array(size);
    const ho = new Float32Array(size);
    const hp = new Float32Array(size);
    o.set(this.out);
    w.set(this.weight);
    ho.set(this.hiOut);
    hp.set(this.hiPow);
    this.out = o;
    this.weight = w;
    this.hiOut = ho;
    this.hiPow = hp;
  }

  /** Normalised value of absolute output index i (what the whole-buffer function stores in its result) */
  private finalValue(abs: number): number {
    const k = abs - this.outBase;
    if (k < 0 || k >= this.out.length) return 0;
    const w = this.weight[k];
    let val = w > 1e-6 ? this.restorer.next(this.out[k] / w, this.hiOut[k] / w, this.hiPow[k] / w) : this.out[k];
    if (!Number.isFinite(val)) val = 0;
    // Edge guard: blend the first and last few samples back to the original edge samples
    const g = this.guard;
    if (abs < g && this.head.length > abs) {
      const wt = edgeGuardWeight(abs, g);
      val = val * (1 - wt) + this.head[abs] * wt;
    } else if (abs >= this.outLength - g && this.tail.length === g) {
      const j = this.outLength - 1 - abs; // 0 at the very last sample
      const wt = edgeGuardWeight(j, g);
      val = val * (1 - wt) + this.tail[g - 1 - j] * wt;
    }
    return val;
  }

  private emitUpTo(limit: number): Float32Array {
    const upto = Math.min(limit, this.outLength);
    const n = Math.max(0, upto - this.emitted);
    const res = new Float32Array(n);
    for (let i = 0; i < n; i++) res[i] = this.finalValue(this.emitted + i);
    this.emitted += n;
    // Keep what the next similarity search still reads (from outPos - hop)
    const keep = Math.max(this.outBase, Math.min(this.emitted, this.outPos - this.hop));
    if (keep > this.outBase) {
      const cut = keep - this.outBase;
      this.out = this.out.slice(cut);
      this.weight = this.weight.slice(cut);
      this.hiOut = this.hiOut.slice(cut);
      this.hiPow = this.hiPow.slice(cut);
      this.outBase = keep;
    }
    return res;
  }

  private run(): void {
    const total = this.totalIn;
    while (this.outPos < this.outLength) {
      const need = Math.min(total, this.inPos + this.searchRange + this.frame + 1);
      if (this.received < need) break; // wait for more input
      this.ensureOut(this.outPos + this.frame);
      const nominal = Math.max(0, Math.min(this.inPos, total - this.frame));
      const offset = this.outPos > 0
        ? chooseOffset(this.params, this.inBuf, this.inBase, this.out, this.outBase, nominal, this.outPos, total)
        : 0;
      const actualIn = Math.max(0, Math.min(total - this.frame, nominal + offset));
      const base = actualIn - this.inBase;
      for (let i = 0; i < this.frame; i++) {
        const k = this.outPos + i - this.outBase;
        const wv = this.window[i];
        this.out[k] += this.inBuf[base + i] * wv;
        this.weight[k] += wv;
        const h = this.hpBuf[base + i];
        this.hiOut[k] += h * wv;
        this.hiPow[k] += h * h * wv;
      }
      this.outPos += this.hop;
      this.inPos += this.anaHop;
    }
  }

  private dropInput(): void {
    const keepFrom = Math.max(0, this.inPos - this.searchRange - 2);
    const cut = Math.min(keepFrom - this.inBase, this.inBuf.length);
    if (cut > 0) {
      this.inBuf = this.inBuf.slice(cut);
      this.hpBuf = this.hpBuf.slice(cut);
      this.inBase += cut;
    }
  }

  private keepEdges(chunk: Float32Array): void {
    const g = this.guard;
    if (this.head.length < g) {
      const take = Math.min(g - this.head.length, chunk.length);
      const h = new Float32Array(this.head.length + take);
      h.set(this.head);
      h.set(chunk.subarray(0, take), this.head.length);
      this.head = h;
    }
    const t = new Float32Array(Math.min(g, this.tail.length + chunk.length));
    const all = this.tail.length + chunk.length;
    for (let i = 0; i < t.length; i++) {
      const src = all - t.length + i; // index into tail ++ chunk
      t[i] = src < this.tail.length ? this.tail[src] : chunk[src - this.tail.length];
    }
    this.tail = t;
  }

  push(chunk: Float32Array): Float32Array {
    if (this.whole) { this.whole.push(chunk.slice()); return new Float32Array(0); }
    this.keepEdges(chunk);
    const merged = new Float32Array(this.inBuf.length + chunk.length);
    merged.set(this.inBuf);
    merged.set(chunk, this.inBuf.length);
    this.inBuf = merged;
    const hpMerged = new Float32Array(this.hpBuf.length + chunk.length);
    hpMerged.set(this.hpBuf);
    hpMerged.set(this.highpass.process(chunk), this.hpBuf.length);
    this.hpBuf = hpMerged;
    this.received += chunk.length;
    this.run();
    // Hold back the last few samples until the end of the input is known (they are blended to the original edge)
    const res = this.emitUpTo(Math.min(this.outPos - this.hop, this.outLength - this.guard));
    this.dropInput();
    return res;
  }

  finish(): Float32Array {
    if (this.whole) {
      const all = concat(this.whole, this.whole.reduce((n, p) => n + p.length, 0));
      return all.length === 0 ? new Float32Array(0) : wsolaTimeStretch(all, this.speed, this.params);
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

  constructor(private readonly totalIn: number, semitones: number, sampleRate = 48000) {
    const ratio = Math.pow(2, Math.max(-24, Math.min(24, semitones)) / 12);
    this.resampler = new HermiteResampler(totalIn, ratio);
    this.stretcher = new WsolaStretcher(Math.max(1, Math.round(totalIn / ratio)), 1 / ratio, pitchStretchParams(ratio, sampleRate));
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
