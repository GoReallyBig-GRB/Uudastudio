/**
 * Streaming ITU-R BS.1770-4 / EBU R128 loudness and 4x true-peak meter.
 *
 * Audio is fed in blocks of any size (planar float32), so a 3-hour mix can be measured without ever holding it all.
 * Feeding one big block gives exactly what feeding many small ones does. This is the only loudness implementation:
 * measuring a whole AudioBuffer (`measureLoudness`) just feeds it through here.
 *
 * - K-weighting: high shelf then 100 Hz high-pass (coefficients for 48 kHz, as before)
 * - 400 ms windows, 100 ms hop, absolute gate -70 LKFS, relative gate -10 LU
 * - Loudness range: 10th to 95th percentile of the gated-in window loudness
 * - True peak: cubic-Hermite 4x oversampling
 */

export interface MeterStats {
  integratedLUFS: number;
  truePeakDbTP: number;
  rmsDb: number;
  loudnessRangeLU: number;
  durationSeconds: number;
}

const A1_HS = -1.69065929318241;
const A2_HS = 0.73248077421585;
const B0_HS = 1.53512485958697;
const B1_HS = -2.69169618940638;
const B2_HS = 1.19839281085285;
const A1_HP = -1.99004745483398;
const A2_HP = 0.99007225036621;

const lufs = (power: number) => -0.691 + 10 * Math.log10(Math.max(1e-12, power));

class ChannelState {
  x1hs = 0; x2hs = 0; y1hs = 0; y2hs = 0;
  x1hp = 0; x2hp = 0; y1hp = 0; y2hp = 0;
  readonly ring: Float64Array;
  rolling = 0;
  /** Last samples kept for the true-peak neighbourhood: global index of carry[0] is `carryBase`. */
  carry: Float32Array = new Float32Array(0);
  carryBase = 0;
  nextPeak = 0;
  constructor(ringSize: number) { this.ring = new Float64Array(ringSize); }
}

export class LoudnessMeter {
  private readonly size: number;
  private readonly hop: number;
  private readonly ch: ChannelState[];
  private readonly blockPowers: number[] = [];
  private frames = 0;
  private sumSq = 0;
  private peak = 0;
  private finished = false;

  /**
   * @param totalFrames  Length of the audio that will be fed in. A clip shorter than 400 ms is measured as one window
   *                     covering all of it, so the meter needs to know how long the audio is.
   */
  constructor(private readonly channels: number, private readonly sampleRate: number, totalFrames: number) {
    const blockSize = Math.floor(0.4 * sampleRate);
    const hopSize = Math.floor(0.1 * sampleRate);
    this.size = Math.max(1, Math.min(blockSize, Math.max(1, totalFrames)));
    this.hop = Math.max(1, Math.min(hopSize, this.size));
    this.ch = Array.from({ length: channels }, () => new ChannelState(this.size));
  }

  /** Feed the next `frames` samples of every channel. */
  push(data: Float32Array[], frames: number = data[0]?.length ?? 0): void {
    if (this.finished) throw new Error('LoudnessMeter already finished.');
    if (frames <= 0) return;
    const size = this.size;
    const hop = this.hop;
    const startFrame = this.frames;
    for (let c = 0; c < this.channels; c++) {
      const s = this.ch[c];
      const input = data[Math.min(c, data.length - 1)];
      let { x1hs, x2hs, y1hs, y2hs, x1hp, x2hp, y1hp, y2hp, rolling } = s;
      let sumSq = 0;
      for (let k = 0; k < frames; k++) {
        const i = startFrame + k;
        const x = input[k];
        sumSq += x * x;
        const yhs = B0_HS * x + B1_HS * x1hs + B2_HS * x2hs - A1_HS * y1hs - A2_HS * y2hs;
        x2hs = x1hs; x1hs = x; y2hs = y1hs; y1hs = yhs;
        const yhp = yhs - 2 * x1hp + x2hp - A1_HP * y1hp - A2_HP * y2hp; // b0 = 1, b1 = -2, b2 = 1
        x2hp = x1hp; x1hp = yhs; y2hp = y1hp; y1hp = yhp;

        const ri = i % size;
        const sq = yhp * yhp;
        if (i >= size) rolling -= s.ring[ri];
        s.ring[ri] = sq;
        rolling += sq;

        const windowStart = i - size + 1;
        if (windowStart >= 0 && windowStart % hop === 0) {
          const bi = windowStart / hop;
          this.blockPowers[bi] = (this.blockPowers[bi] ?? 0) + rolling / size;
        }
      }
      s.x1hs = x1hs; s.x2hs = x2hs; s.y1hs = y1hs; s.y2hs = y2hs;
      s.x1hp = x1hp; s.x2hp = x2hp; s.y1hp = y1hp; s.y2hp = y2hp; s.rolling = rolling;
      this.sumSq += sumSq;
      this.feedPeak(s, input, frames, startFrame, false);
    }
    this.frames += frames;
  }

  /** True peak over samples whose 4-sample neighbourhood is fully known (or clamped at the very end). */
  private feedPeak(s: ChannelState, input: Float32Array, frames: number, startFrame: number, final: boolean): void {
    const base = s.carryBase;
    const ext = new Float32Array(s.carry.length + frames);
    ext.set(s.carry, 0);
    if (frames > 0) ext.set(input.subarray(0, frames), s.carry.length);
    const end = base + ext.length; // exclusive global end
    const last = end - 1;
    const at = (g: number) => ext[Math.min(Math.max(g, 0), last) - base];
    const limit = final ? end : end - 2; // exclusive: needs g+2 unless the stream is over
    let peak = this.peak;
    let i = s.nextPeak;
    for (; i < limit; i++) {
      const s0 = at(i - 1), s1 = at(i), s2 = at(i + 1), s3 = at(i + 2);
      const a1 = Math.abs(s1);
      if (a1 > peak) peak = a1;
      for (let sub = 1; sub <= 3; sub++) {
        const t = sub * 0.25;
        const t2 = t * t;
        const t3 = t2 * t;
        const inter = 0.5 * (
          (2 * s1) + (-s0 + s2) * t + (2 * s0 - 5 * s1 + 4 * s2 - s3) * t2 + (-s0 + 3 * s1 - 3 * s2 + s3) * t3
        );
        const ai = Math.abs(inter);
        if (ai > peak) peak = ai;
      }
    }
    this.peak = peak;
    s.nextPeak = i;
    // keep from one before the next sample to evaluate
    const keepFrom = Math.max(base, i - 1);
    s.carry = ext.slice(keepFrom - base);
    s.carryBase = keepFrom;
  }

  /** Result so far, treating the audio fed in as the whole programme. Can be called once. */
  finish(): MeterStats {
    if (!this.finished) {
      this.finished = true;
      for (const s of this.ch) this.feedPeak(s, new Float32Array(0), 0, this.frames, true);
    }
    const length = this.frames;
    if (length === 0) return { integratedLUFS: -70, truePeakDbTP: -70, rmsDb: -70, loudnessRangeLU: 0, durationSeconds: 0 };

    const rms = Math.sqrt(this.sumSq / (length * this.channels || 1));
    const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -70;
    const truePeakDbTP = this.peak > 0 ? 20 * Math.log10(this.peak) : -70;

    const active: number[] = [];
    const levels: number[] = [];
    for (const power of this.blockPowers) {
      const l = lufs(power ?? 0);
      if (l > -70) { active.push(power); levels.push(l); }
    }

    let integrated = -70;
    if (active.length > 0) {
      let total = 0;
      for (const p of active) total += p;
      const avg = total / active.length;
      const gate = lufs(avg) - 10;
      let gatedTotal = 0;
      let gatedCount = 0;
      for (const p of active) if (lufs(p) > gate) { gatedTotal += p; gatedCount++; }
      integrated = gatedCount > 0 ? lufs(gatedTotal / gatedCount) : lufs(avg);
    } else {
      integrated = Math.max(-70, rmsDb - 3.0);
    }

    let lra = 0;
    if (levels.length >= 10) {
      const sorted = [...levels].sort((a, b) => a - b);
      const p10 = sorted[Math.floor(sorted.length * 0.1)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      lra = Math.max(0, Math.round((p95 - p10) * 10) / 10);
    }

    return {
      integratedLUFS: Math.round(integrated * 10) / 10,
      truePeakDbTP: Math.round(truePeakDbTP * 10) / 10,
      rmsDb: Math.round(rmsDb * 10) / 10,
      loudnessRangeLU: lra,
      durationSeconds: Math.round((length / this.sampleRate) * 10) / 10,
    };
  }
}
