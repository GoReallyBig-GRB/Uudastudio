/**
 * Uuda Studio - automatic ducking (voice over music).
 *
 * A music track lowers itself whenever its chosen source tracks (the voice) have signal.
 * The gain curve is worked out ahead of time from the audio on the timeline, so live playback and the exported
 * file get exactly the same curve, and the duck can start a little BEFORE the voice does (look-ahead) instead
 * of clipping the first syllable.
 *
 * Everything in here is plain maths over arrays; the engine and the offline render only schedule the result.
 */

import type { Project, Track, DuckingSettings } from '../types';

export const DUCK_STEP_SECONDS = 0.01;

export const DEFAULT_DUCKING: DuckingSettings = {
  enabled: false,
  sourceTrackIds: [],
  thresholdDb: -40,
  amountDb: -12,
  attackMs: 80,
  holdMs: 250,
  releaseMs: 600,
};

/** One clip of a source track, reduced to what the level measurement needs */
export interface LevelSource {
  startSeconds: number;
  offsetSeconds: number;
  durationSeconds: number;
  /** clip gain times the source track's fader */
  gain: number;
  channels: Float32Array[];
  sampleRate: number;
}

const dbToLin = (db: number) => Math.pow(10, db / 20);

/** Fills in anything missing so old projects and half-edited settings are safe to use */
export function normalizeDucking(d?: Partial<DuckingSettings> | null): DuckingSettings {
  const m = { ...DEFAULT_DUCKING, ...(d || {}) };
  return {
    enabled: !!m.enabled,
    sourceTrackIds: Array.isArray(m.sourceTrackIds) ? m.sourceTrackIds.filter((x) => typeof x === 'string') : [],
    thresholdDb: clamp(m.thresholdDb, -70, -6),
    amountDb: clamp(m.amountDb, -40, 0),
    attackMs: clamp(m.attackMs, 1, 1000),
    holdMs: clamp(m.holdMs, 0, 3000),
    releaseMs: clamp(m.releaseMs, 10, 5000),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  const n = Number.isFinite(v) ? v : lo;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * RMS level of the summed source clips, one value per step of project time.
 * Samples are read at roughly 8 kHz, which is plenty for speech level and keeps a 90-minute project quick.
 */
export function computeLevelEnvelope(sources: LevelSource[], totalSeconds: number, step = DUCK_STEP_SECONDS): Float32Array {
  const bins = Math.max(1, Math.ceil(totalSeconds / step));
  const power = new Float64Array(bins);
  for (const s of sources) {
    if (!s.channels.length || s.sampleRate <= 0 || s.durationSeconds <= 0) continue;
    const stride = Math.max(1, Math.floor(s.sampleRate / 8000));
    const first = Math.max(0, Math.floor(s.offsetSeconds * s.sampleRate));
    const last = Math.min(s.channels[0].length, Math.ceil((s.offsetSeconds + s.durationSeconds) * s.sampleRate));
    const g2 = s.gain * s.gain;
    const chCount = s.channels.length;
    for (let j = first; j < last; j += stride) {
      const t = s.startSeconds + (j - s.offsetSeconds * s.sampleRate) / s.sampleRate;
      const k = Math.floor(t / step);
      if (k < 0 || k >= bins) continue;
      let sq = 0;
      for (let c = 0; c < chCount; c++) {
        const x = s.channels[c][j] || 0;
        sq += x * x;
      }
      power[k] += (sq / chCount) * g2;
    }
  }
  const out = new Float32Array(bins);
  // Overlapping sources add as power; scale by the samples read per full bin (the first source's rate is the reference)
  const ref = sources.find((s) => s.channels.length && s.sampleRate > 0);
  const per = ref ? (step * ref.sampleRate) / Math.max(1, Math.floor(ref.sampleRate / 8000)) : 1;
  for (let i = 0; i < bins; i++) out[i] = Math.sqrt(power[i] / per);
  return out;
}

/** Turns the level envelope into a linear gain per step: 1 = untouched, down to amountDb while the voice speaks */
export function computeDuckGains(envelope: Float32Array, settings: DuckingSettings, step = DUCK_STEP_SECONDS): Float32Array {
  const s = normalizeDucking(settings);
  const gains = new Float32Array(envelope.length);
  const threshold = dbToLin(s.thresholdDb);
  const duck = dbToLin(s.amountDb);
  const lookahead = Math.ceil(s.attackMs / 1000 / step);
  const holdSteps = Math.ceil(s.holdMs / 1000 / step);
  const attackCoef = 1 - Math.exp(-step / (Math.max(1, s.attackMs) / 1000 / 3));
  const releaseCoef = 1 - Math.exp(-step / (Math.max(1, s.releaseMs) / 1000 / 3));
  let g = 1;
  let hold = 0;
  for (let i = 0; i < envelope.length; i++) {
    const probe = Math.min(envelope.length - 1, i + lookahead);
    // Look ahead by the attack time: the duck is fully in by the time the voice arrives
    let active = false;
    for (let k = i; k <= probe; k++) {
      if (envelope[k] > threshold) {
        active = true;
        break;
      }
    }
    if (active) hold = holdSteps;
    else if (hold > 0) hold--;
    const target = active || hold > 0 ? duck : 1;
    g += (target - g) * (target < g ? attackCoef : releaseCoef);
    gains[i] = g;
  }
  return gains;
}

/** The clips of the chosen source tracks that can be heard (not muted tracks, not muted clips) */
export function collectLevelSources(
  project: Project,
  track: Track,
  getChannels: (assetId: string) => { channels: Float32Array[]; sampleRate: number } | null,
): LevelSource[] {
  const settings = normalizeDucking(track.ducking);
  const out: LevelSource[] = [];
  for (const src of project.tracks) {
    if (src.id === track.id || !settings.sourceTrackIds.includes(src.id) || src.muted) continue;
    for (const clip of src.clips) {
      if (clip.muted) continue;
      const a = getChannels(clip.assetId);
      if (!a) continue;
      out.push({
        startSeconds: clip.startSeconds,
        offsetSeconds: clip.offsetSeconds || 0,
        durationSeconds: clip.durationSeconds,
        gain: (clip.gain ?? 1) * src.volume,
        channels: a.channels,
        sampleRate: a.sampleRate,
      });
    }
  }
  return out;
}

/** The whole gain curve for one track, or null when the track has nothing to duck for */
export function buildDuckCurve(
  project: Project,
  track: Track,
  getChannels: (assetId: string) => { channels: Float32Array[]; sampleRate: number } | null,
): Float32Array | null {
  const settings = normalizeDucking(track.ducking);
  if (!settings.enabled || settings.sourceTrackIds.length === 0) return null;
  const sources = collectLevelSources(project, track, getChannels);
  if (sources.length === 0) return null;
  let total = 0;
  for (const s of sources) total = Math.max(total, s.startSeconds + s.durationSeconds);
  const env = computeLevelEnvelope(sources, total + 1);
  return computeDuckGains(env, settings);
}

/** Cheap fingerprint of everything the curve depends on, so it is only recomputed when it could have changed */
export function duckCurveKey(project: Project, track: Track): string {
  const s = normalizeDucking(track.ducking);
  const parts: unknown[] = [s];
  for (const src of project.tracks) {
    if (!s.sourceTrackIds.includes(src.id)) continue;
    parts.push(src.id, src.muted, src.volume, src.clips.map((c) => [c.assetId, c.startSeconds, c.offsetSeconds, c.durationSeconds, c.gain, c.muted ? 1 : 0]));
  }
  return JSON.stringify(parts);
}

/**
 * Schedules the curve on a gain parameter. `fromSeconds` is the project time that plays at `when`
 * (the playhead when playing live, the start of the range when rendering).
 */
export function scheduleDuckCurve(
  param: AudioParam,
  gains: Float32Array,
  fromSeconds: number,
  when: number,
  step = DUCK_STEP_SECONDS,
): void {
  param.cancelScheduledValues(0);
  param.setValueAtTime(1, 0);
  const i0 = Math.max(0, Math.floor(fromSeconds / step));
  const slice = gains.subarray(i0);
  if (slice.length < 3) return; // a curve needs at least two points after the first
  param.setValueAtTime(slice[0], when);
  param.setValueCurveAtTime(slice.slice(1), when + step, (slice.length - 2) * step);
}

/** Puts the gain back to unity (stop, seek, ducking switched off) */
export function clearDuck(param: AudioParam, when: number): void {
  param.cancelScheduledValues(0);
  param.setValueAtTime(1, when);
}
