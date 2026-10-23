import { describe, it, expect } from 'vitest';
import {
  computeLevelEnvelope, computeDuckGains, normalizeDucking, buildDuckCurve, duckCurveKey, scheduleDuckCurve,
  DEFAULT_DUCKING, DUCK_STEP_SECONDS,
} from './ducking';
import type { Project, Track, Clip } from '../types';

const SR = 8000;
/** A tone at the given amplitude for `seconds`, as a one-channel buffer */
function tone(seconds: number, amp: number): Float32Array {
  const a = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < a.length; i++) a[i] = amp * Math.sin((2 * Math.PI * 220 * i) / SR);
  return a;
}
const db = (x: number) => 20 * Math.log10(x);

describe('level envelope', () => {
  it('reads the RMS of a sine at its true level and silence as zero', () => {
    const env = computeLevelEnvelope(
      [{ startSeconds: 1, offsetSeconds: 0, durationSeconds: 1, gain: 1, channels: [tone(1, 0.5)], sampleRate: SR }],
      3,
    );
    expect(env[50]).toBeCloseTo(0, 3); // before the clip
    expect(Math.abs(env[150] - 0.5 / Math.SQRT2)).toBeLessThan(0.01); // during (reads ~8 kHz, so a hair under exact)
    expect(env[250]).toBeCloseTo(0, 3); // after
  });

  it('applies clip gain, and overlapping sources add as power', () => {
    const one = { startSeconds: 0, offsetSeconds: 0, durationSeconds: 1, gain: 0.5, channels: [tone(1, 0.5)], sampleRate: SR };
    const a = computeLevelEnvelope([one], 1)[50];
    const b = computeLevelEnvelope([one, one], 1)[50];
    expect(a).toBeCloseTo((0.25) / Math.SQRT2, 2);
    expect(b / a).toBeCloseTo(Math.SQRT2, 1);
  });

  it('honours the clip offset into the audio', () => {
    const ch = new Float32Array(2 * SR);
    ch.set(tone(1, 0.8), SR); // loud second half only
    const env = computeLevelEnvelope(
      [{ startSeconds: 0, offsetSeconds: 1, durationSeconds: 1, gain: 1, channels: [ch], sampleRate: SR }],
      1,
    );
    expect(Math.abs(env[50] - 0.8 / Math.SQRT2)).toBeLessThan(0.015);
  });
});

describe('duck gains', () => {
  const step = DUCK_STEP_SECONDS;
  const env = new Float32Array(600); // 6 s
  env.fill(0.3, 200, 300); // voice from 2.0 s to 3.0 s
  const s = normalizeDucking({ enabled: true, sourceTrackIds: ['v'], thresholdDb: -30, amountDb: -12, attackMs: 100, holdMs: 200, releaseMs: 500 });
  const g = computeDuckGains(env, s, step);

  it('stays at unity when there is no voice', () => {
    expect(g[0]).toBe(1);
    expect(g[100]).toBeCloseTo(1, 3);
  });

  it('is already down by the time the voice starts (look-ahead)', () => {
    expect(db(g[200])).toBeLessThan(-10);
  });

  it('settles at the duck amount while the voice speaks', () => {
    expect(db(g[260])).toBeCloseTo(-12, 0);
  });

  it('holds, then releases slowly, and is back to unity afterwards', () => {
    expect(db(g[310])).toBeLessThan(-11); // inside the hold
    expect(g[350]).toBeGreaterThan(g[320]); // coming back
    expect(g[350]).toBeLessThan(1);
    expect(g[590]).toBeCloseTo(1, 2);
  });

  it('never goes above unity or below the duck amount', () => {
    for (const v of g) {
      expect(v <= 1.0001).toBe(true);
      expect(v >= Math.pow(10, -12 / 20) - 0.001).toBe(true);
    }
  });

  it('a threshold above the voice level never ducks', () => {
    const quiet = computeDuckGains(env, normalizeDucking({ ...s, thresholdDb: -6 }), step);
    expect(quiet.every((v: number) => v === 1)).toBe(true);
  });
});

describe('settings and curve building', () => {
  it('normalizes missing and out-of-range values', () => {
    expect(normalizeDucking(undefined)).toEqual(DEFAULT_DUCKING);
    const n = normalizeDucking({ amountDb: 12, thresholdDb: -200, attackMs: NaN, sourceTrackIds: ['a', 5 as any] });
    expect(n.amountDb).toBe(0);
    expect(n.thresholdDb).toBe(-70);
    expect(n.attackMs).toBe(1);
    expect(n.sourceTrackIds).toEqual(['a']);
  });

  const clip = (id: string, trackId: string, start: number, dur: number, over: Partial<Clip> = {}): Clip => ({
    id, trackId, assetId: 'voice', name: id, startSeconds: start, offsetSeconds: 0, durationSeconds: dur,
    gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'linear', ...over,
  });
  const mk = (over: Partial<Track> = {}): Project => {
    const voice: Track = { id: 'v', name: 'V', clips: [clip('c', 'v', 2, 1)], volume: 1, pan: 0, muted: false, solo: false };
    const music: Track = {
      id: 'm', name: 'M', clips: [], volume: 1, pan: 0, muted: false, solo: false,
      ducking: { ...DEFAULT_DUCKING, enabled: true, sourceTrackIds: ['v'], thresholdDb: -30 }, ...over,
    };
    return { id: 'p', name: 'p', tracks: [voice, music], sampleRate: SR, settings: {} as any };
  };
  const audio = (id: string) => (id === 'voice' ? { channels: [tone(1, 0.5)], sampleRate: SR } : null);

  it('builds a curve that dips where the voice is', () => {
    const p = mk();
    const curve = buildDuckCurve(p, p.tracks[1], audio)!;
    expect(curve[100]).toBeCloseTo(1, 2);
    expect(db(curve[250])).toBeLessThan(-10);
  });

  it('returns null when off, with no source, or when the source is muted', () => {
    const p = mk();
    expect(buildDuckCurve(p, { ...p.tracks[1], ducking: { ...DEFAULT_DUCKING, sourceTrackIds: ['v'] } }, audio)).toBe(null);
    expect(buildDuckCurve(p, { ...p.tracks[1], ducking: { ...DEFAULT_DUCKING, enabled: true } }, audio)).toBe(null);
    p.tracks[0].muted = true;
    expect(buildDuckCurve(p, p.tracks[1], audio)).toBe(null);
  });

  it('the cache key changes when a source clip moves or a setting changes, not otherwise', () => {
    const p = mk();
    const k1 = duckCurveKey(p, p.tracks[1]);
    expect(duckCurveKey(JSON.parse(JSON.stringify(p)), p.tracks[1])).toBe(k1);
    const moved = JSON.parse(JSON.stringify(p));
    moved.tracks[0].clips[0].startSeconds = 5;
    expect(duckCurveKey(moved, moved.tracks[1])).not.toBe(k1);
    const tweaked = JSON.parse(JSON.stringify(p));
    tweaked.tracks[1].ducking.amountDb = -20;
    expect(duckCurveKey(tweaked, tweaked.tracks[1])).not.toBe(k1);
  });

  it('schedules from the playhead: events start at `when` and cover the rest of the curve', () => {
    const calls: Array<[string, ...number[]]> = [];
    const param: any = {
      cancelScheduledValues: (t: number) => calls.push(['cancel', t]),
      setValueAtTime: (v: number, t: number) => calls.push(['set', v, t]),
      setValueCurveAtTime: (c: Float32Array, t: number, d: number) => calls.push(['curve', c.length, t, d]),
    };
    const gains = new Float32Array(1000).fill(0.5);
    scheduleDuckCurve(param, gains, 2, 10);
    const curve = calls.find((c) => c[0] === 'curve')!;
    expect(curve[1]).toBe(1000 - 200 - 1); // from step 200, minus the point set directly
    expect(curve[2]).toBeCloseTo(10.01, 5);
    expect(curve[3]).toBeCloseTo((1000 - 200 - 2) * 0.01, 5);
  });
});
