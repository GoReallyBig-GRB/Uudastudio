/**
 * Brickwall look-ahead limiter for one channel that accepts audio in blocks.
 *
 * Output sample i is limited using the loudest sample in in[i .. i + window - 1] (a monotonic deque keeps this linear
 * time), then the gain eases back with a one-pole release. Because a sample needs `window - 1` samples of the future,
 * `process` returns audio up to that point and `finish` flushes the rest. The output is identical however the input is
 * cut into blocks, and identical to limiting the whole signal at once; the whole-buffer helper is built on this class.
 */
export class LookaheadLimiter {
  private readonly window: number;
  private readonly deque: Int32Array;
  private head = 0;
  private count = 0;
  private buf = new Float32Array(0);
  private bufBase = 0; // global index of buf[0]
  private fed = 0;
  private nextOut = 0;
  private nextPush = 0;
  private envelope = 0;

  constructor(
    private readonly ceiling: number,
    lookaheadSamples: number,
    private readonly releaseCoeff: number,
  ) {
    this.window = Math.max(1, lookaheadSamples);
    this.deque = new Int32Array(this.window + 1);
  }

  private abs(g: number): number { return Math.abs(this.buf[g - this.bufBase]); }

  private pushIndex(g: number): void {
    const cap = this.deque.length;
    const v = this.abs(g);
    while (this.count > 0) {
      const tail = (this.head + this.count - 1) % cap;
      if (this.abs(this.deque[tail]) > v) break;
      this.count--;
    }
    this.deque[(this.head + this.count) % cap] = g;
    this.count++;
  }

  /** Limits as much as the future allows and returns those samples (possibly none). */
  process(input: Float32Array): Float32Array { return this.run(input, false); }

  /** Limits everything still waiting, treating the end of the input as the end of the signal. */
  finish(): Float32Array { return this.run(new Float32Array(0), true); }

  private run(input: Float32Array, final: boolean): Float32Array {
    if (input.length > 0) {
      const merged = new Float32Array(this.buf.length + input.length);
      merged.set(this.buf, 0);
      merged.set(input, this.buf.length);
      this.buf = merged;
      this.fed += input.length;
    }
    const W = this.window;
    const cap = this.deque.length;
    const ready = final ? this.fed - this.nextOut : Math.max(0, this.fed - W + 1 - this.nextOut);
    const out = new Float32Array(ready);
    for (let k = 0; k < ready; k++) {
      const i = this.nextOut;
      const pushTo = Math.min(i + W, this.fed); // exclusive: window is [i, i + W - 1]
      while (this.nextPush < pushTo) this.pushIndex(this.nextPush++);
      while (this.count > 0 && this.deque[this.head] < i) { this.head = (this.head + 1) % cap; this.count--; }

      const maxFuture = this.count > 0 ? this.abs(this.deque[this.head]) : 0;
      if (maxFuture > this.envelope) this.envelope = maxFuture;
      else this.envelope = maxFuture + this.releaseCoeff * (this.envelope - maxFuture);
      const gain = this.envelope > this.ceiling ? this.ceiling / this.envelope : 1;
      let sample = this.buf[i - this.bufBase] * gain;
      if (sample > this.ceiling) sample = this.ceiling;
      if (sample < -this.ceiling) sample = -this.ceiling;
      out[k] = sample;
      this.nextOut++;
    }
    // Samples before nextOut are never needed again
    const drop = this.nextOut - this.bufBase;
    if (drop > 0) { this.buf = this.buf.slice(drop); this.bufBase = this.nextOut; }
    return out;
  }
}
