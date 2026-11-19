import { describe, expect, it } from 'vitest';
import { EnvelopeBuilder, compareActivity, gapsFound, toLevel } from './activity';

/** Speech-like bursts: loud for a while, then quiet, with a little noise. Deterministic. */
function speech(bins: number, seed = 3): Uint8Array {
  let s = seed; const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const out = new Uint8Array(bins);
  let i = 0;
  while (i < bins) {
    const loud = rnd() < 0.55; const len = 5 + Math.floor(rnd() * 25);
    for (let k = 0; k < len && i < bins; k++, i++) out[i] = loud ? 150 + Math.floor(rnd() * 70) : 20 + Math.floor(rnd() * 15);
  }
  return out;
}
const shift = (a: Uint8Array, by: number, total: number): Uint8Array => { const o = new Uint8Array(total).fill(25); for (let i = 0; i < a.length; i++) if (i + by < total) o[i + by] = a[i]; return o; };

describe('loudness record', () => {
  it('maps volume to a level', () => {
    expect(toLevel(0)).toBe(0);
    expect(toLevel(1)).toBe(255);
    expect(toLevel(0.001)).toBe(0);
    expect(toLevel(0.1)).toBeGreaterThan(toLevel(0.01));
  });
  it('makes ten bins a second from samples', () => {
    const b = new EnvelopeBuilder(8000);
    b.push(new Float32Array(8000 * 3).fill(0.1));
    expect(b.bins).toHaveLength(30);
    expect(b.seconds).toBe(3);
    b.push(new Float32Array(799));
    expect(b.bins).toHaveLength(30);
  });
});

describe('comparing the host record with the guest file', () => {
  const heard = speech(3000);
  it('finds the offset and a complete file', () => {
    const m = compareActivity(heard, shift(heard, 7, 3100))!;
    expect(m.offsetMs).toBe(700);
    expect(m.confidence).toBeGreaterThan(0.8);
    expect(m.coverage).toBeGreaterThan(0.97);
    expect(gapsFound(m)).toBe(false);
    expect(Math.abs(m.driftPpm ?? 0)).toBeLessThan(500);
  });
  it('copes with a different recording gain', () => {
    const quiet = Uint8Array.from(heard, (v) => Math.max(0, v - 40));
    const m = compareActivity(heard, shift(quiet, -4, 3000))!;
    expect(m.offsetMs).toBe(-400);
    expect(gapsFound(m)).toBe(false);
  });
  it('notices a stretch missing from the middle', () => {
    const f = shift(heard, 3, 3100);
    for (let i = 1200; i < 1900; i++) f[i] = 5;
    const m = compareActivity(heard, f)!;
    expect(m.coverage).toBeLessThan(0.85);
    expect(gapsFound(m)).toBe(true);
  });
  it('notices a file that stops early', () => {
    const m = compareActivity(heard, shift(heard, 0, 3000).slice(0, 1800))!;
    expect(gapsFound(m)).toBe(true);
  });
  it('reports slow drift', () => {
    const stretched = Uint8Array.from({ length: 3000 }, (_, j) => heard[Math.min(2999, Math.round(j * 0.996))]);
    const m = compareActivity(heard, stretched)!;
    expect(Math.abs(m.driftPpm ?? 0)).toBeGreaterThan(1500);
  });
  it('does not claim a verdict for unrelated or too-short records', () => {
    const m = compareActivity(heard, speech(3000, 99))!;
    expect(m.confidence).toBeLessThan(0.25);
    expect(gapsFound(m)).toBe(false);
    expect(compareActivity(speech(50), speech(50))).toBeNull();
    expect(gapsFound(null)).toBe(false);
  });
});
