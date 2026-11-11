import { describe, expect, it } from 'vitest';
import { assess, checkRoom, measure } from './roomCheck';

const SR = 44100;
/** Fake "speech": a few bursts of a harmonic tone at a given level, over steady noise */
const take = (o: { leadSeconds?: number; speechDb?: number; noiseDb?: number; clip?: boolean; bump?: boolean; fundamental?: number }) => {
  const lead = o.leadSeconds ?? 4, total = lead + 8;
  const x = new Float32Array(Math.round(total * SR));
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const noiseA = Math.pow(10, (o.noiseDb ?? -62) / 20) * Math.sqrt(3), speechA = Math.pow(10, (o.speechDb ?? -22) / 20) * 1.6;
  const f0 = o.fundamental ?? 180;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    let v = rnd() * noiseA;
    const talking = t >= lead && (t - lead) % 1.6 < 1.1;
    if (talking) for (let h = 1; h <= 8; h++) v += (speechA / Math.pow(h, o.fundamental && o.fundamental < 150 ? 2 : 0.5)) * Math.sin(2 * Math.PI * f0 * h * t);
    if (o.bump && t > 1.5 && t < 1.7) v += 0.01 * Math.sin(2 * Math.PI * 300 * t);
    x[i] = Math.max(-1, Math.min(1, o.clip && talking ? v * 20 : v));
  }
  return x;
};
const ids = (r: ReturnType<typeof assess>) => r.findings.map((f) => f.id).sort();

describe('room check', () => {
  it('a quiet room with a good level passes', () => {
    const r = checkRoom(take({}), SR);
    expect(ids(r)).toEqual(['good']);
    expect(r.metrics!.leadInSeconds).toBeGreaterThan(3.5);
    expect(r.metrics!.leadInSeconds).toBeLessThan(4.3);
  });
  it('measures level and noise close to what was put in', () => {
    const m = measure(take({ noiseDb: -60, speechDb: -20 }), SR)!;
    expect(m.noiseDb).toBeGreaterThan(-64); expect(m.noiseDb).toBeLessThan(-56);
    expect(m.snrDb).toBeGreaterThan(30);
  });
  it('flags a noisy room', () => expect(ids(checkRoom(take({ noiseDb: -40, speechDb: -22 }), SR))).toContain('noise'));
  it('a quiet but clean voice is not a fault until it is very quiet; a quiet noisy one is a problem', () => {
    expect(ids(checkRoom(take({ speechDb: -38, noiseDb: -75 }), SR))).not.toContain('quiet');
    expect(ids(checkRoom(take({ speechDb: -32, noiseDb: -75 }), SR))).not.toContain('quiet');
    expect(checkRoom(take({ speechDb: -54, noiseDb: -90 }), SR).findings.find((f) => f.id === 'quiet')?.level).toBe('warn');
    expect(checkRoom(take({ speechDb: -44, noiseDb: -60 }), SR).findings.find((f) => f.id === 'quiet')?.level).toBe('problem');
  });
  it('flags clipping as a problem', () => {
    const r = checkRoom(take({ clip: true }), SR);
    expect(r.findings.find((f) => f.id === 'loud')?.level).toBe('problem');
    expect(r.overall).toBe('problem');
  });
  it('flags a noise during the quiet start', () => expect(ids(checkRoom(take({ bump: true }), SR))).toContain('event'));
  it('asks for a quiet start when there is none', () => expect(ids(checkRoom(take({ leadSeconds: 0.3 }), SR))).toContain('lead'));
  it('flags a boomy low end', () => expect(ids(checkRoom(take({ fundamental: 110 }), SR))).toContain('boomy'));
  it('flags phone-call quality sample rates and silence', () => {
    expect(ids(assess({ ...measure(take({}), SR)!, sampleRate: 16000 }))).toContain('narrow');
    expect(ids(checkRoom(new Float32Array(SR * 6), SR))).toEqual(['nothing']);
  });
});

describe('very quiet microphones (no false alarms)', () => {
  /** A quiet USB mic: noise near -85 dB with frame-to-frame wobble, a start-up settle in the first 0.6 s, then speech after 4 s */
  const quietMic = (o: { settle?: boolean; wobbleDb?: number; bumpAt?: number } = {}) => {
    const lead = 4, x = new Float32Array(Math.round((lead + 8) * SR));
    let seed = 11; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
    const frame = Math.round(0.05 * SR);
    let gain = 1;
    for (let i = 0; i < x.length; i++) {
      const t = i / SR;
      if (i % frame === 0) gain = Math.pow(10, ((o.wobbleDb ?? 8) * rnd()) / 20);
      let v = rnd() * Math.pow(10, -85 / 20) * Math.sqrt(3) * gain;
      if (o.settle && t < 0.6) v += rnd() * 0.004 * (1 - t / 0.6);
      const talking = t >= lead && (t - lead) % 1.6 < 1.1;
      if (talking) for (let h = 1; h <= 8; h++) v += (0.05 / Math.pow(h, 0.5)) * Math.sin(2 * Math.PI * 180 * h * t);
      if (o.bumpAt && t > o.bumpAt && t < o.bumpAt + 0.2) v += 0.02 * Math.sin(2 * Math.PI * 300 * t);
      x[i] = v;
    }
    return x;
  };
  it('a silent room on a quiet mic passes even with a start-up settle and noisy-looking frames', () => {
    const r = checkRoom(quietMic({ settle: true }), SR);
    expect(ids(r)).not.toContain('lead'); expect(ids(r)).not.toContain('event');
    expect(r.metrics!.leadInSeconds).toBeGreaterThan(3.5);
  });
  it('still catches a real bump in the quiet start', () => expect(ids(checkRoom(quietMic({ settle: true, bumpAt: 2 }), SR))).toContain('event'));
  it('still asks for a quiet start when speech begins at once', () => expect(ids(checkRoom(take({ leadSeconds: 0.7 }), SR))).toContain('lead'));
});
