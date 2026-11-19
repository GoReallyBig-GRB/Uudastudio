/**
 * A loudness record: ten numbers a second. It is what the host keeps of a guest during a take (instead of a second copy of the audio),
 * and what is worked out from the guest's full recording when it arrives. Comparing the two shows whether the recording is complete and lined up.
 */
export const BINS_PER_SECOND = 10;
const MAX_BINS = 3 * 3600 * BINS_PER_SECOND * 2;

/** 0 is silence or quieter than -60 dB; 255 is full scale */
export const toLevel = (rms: number): number => (rms <= 0 ? 0 : Math.max(0, Math.min(255, Math.round((20 * Math.log10(rms) + 60) * (255 / 60)))));

export class EnvelopeBuilder {
  private readonly binSize: number;
  private sum = 0; private n = 0;
  private out: number[] = [];
  constructor(sampleRate: number) { this.binSize = Math.max(1, Math.round(sampleRate / BINS_PER_SECOND)); }
  push(samples: ArrayLike<number>): void {
    for (let i = 0; i < samples.length; i++) {
      this.sum += samples[i] * samples[i];
      if (++this.n === this.binSize) {
        if (this.out.length < MAX_BINS) this.out.push(toLevel(Math.sqrt(this.sum / this.n)));
        this.sum = 0; this.n = 0;
      }
    }
  }
  get bins(): Uint8Array { return Uint8Array.from(this.out); }
  get seconds(): number { return this.out.length / BINS_PER_SECOND; }
}

const percentile = (a: Uint8Array, p: number): number => { const s = Array.from(a).sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
/** Halfway between the quiet floor and the speaking level, so recordings with different gain are judged fairly */
const activeThreshold = (a: Uint8Array): number => (percentile(a, 0.2) + percentile(a, 0.9)) / 2;

/** Correlation of a[i] with b[i + lag] over the part where both exist (-1 to 1) */
function ncc(a: Uint8Array, b: Uint8Array, lag: number, from = 0, to = a.length): number {
  const lo = Math.max(from, -lag), hi = Math.min(to, b.length - lag);
  const n = hi - lo;
  if (n < 50) return -1;
  let ma = 0, mb = 0;
  for (let i = lo; i < hi; i++) { ma += a[i]; mb += b[i + lag]; }
  ma /= n; mb /= n;
  let ab = 0, aa = 0, bb = 0;
  for (let i = lo; i < hi; i++) { const x = a[i] - ma, y = b[i + lag] - mb; ab += x * y; aa += x * x; bb += y * y; }
  return aa === 0 || bb === 0 ? 0 : ab / Math.sqrt(aa * bb);
}

function bestLag(a: Uint8Array, b: Uint8Array, centre: number, range: number, from = 0, to = a.length): { lag: number; score: number } {
  let lag = centre, score = -2;
  for (let l = centre - range; l <= centre + range; l++) { const s = ncc(a, b, l, from, to); if (s > score) { score = s; lag = l; } }
  return { lag, score };
}

export interface ActivityMatch {
  /** How much later the guest's file starts than the host's record, in milliseconds (positive: later) */
  offsetMs: number;
  /** 0 to 1: how well the two patterns match. Low means they cannot be compared. */
  confidence: number;
  /** Share of the times the host heard the guest speaking that are also in the guest's file */
  coverage: number;
  /** Slow drift between the two clocks over the take, in parts per million, or null for takes under a minute */
  driftPpm: number | null;
}

export const MIN_COMPARE_BINS = 100;
export const MIN_CONFIDENCE = 0.25;

/** Lines the host's record of a guest up with the guest's full recording */
export function compareActivity(heard: Uint8Array, file: Uint8Array, maxLagBins = 80): ActivityMatch | null {
  if (heard.length < MIN_COMPARE_BINS || file.length < MIN_COMPARE_BINS / 2) return null;
  const { lag, score } = bestLag(heard, file, 0, maxLagBins);
  const th = activeThreshold(heard), tf = activeThreshold(file);
  let active = 0, covered = 0;
  for (let i = 0; i < heard.length; i++) {
    if (heard[i] <= th) continue;
    active++;
    const j = i + lag;
    if (j >= 0 && j < file.length && file[j] > tf) covered++;
  }
  let driftPpm: number | null = null;
  if (heard.length >= 600 && score > MIN_CONFIDENCE) {
    const third = Math.floor(heard.length / 3);
    const a = bestLag(heard, file, lag, 20, 0, third), b = bestLag(heard, file, lag, 20, heard.length - third, heard.length);
    const elapsedMs = (heard.length - third) * (1000 / BINS_PER_SECOND);
    driftPpm = Math.round(((b.lag - a.lag) * (1000 / BINS_PER_SECOND) / elapsedMs) * 1e6);
  }
  return { offsetMs: lag * (1000 / BINS_PER_SECOND), confidence: Math.max(0, Math.min(1, score)), coverage: active === 0 ? 1 : covered / active, driftPpm };
}

/** What the comparison means, or null when it cannot say */
export function gapsFound(m: ActivityMatch | null): boolean { return m !== null && m.confidence >= MIN_CONFIDENCE && m.coverage < 0.85; }
