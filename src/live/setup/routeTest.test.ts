import { describe, expect, it } from 'vitest';
import { decimate, detectChirp, makeChirp, routeAdvice } from './routeTest';

const SR = 48_000;
/** Deterministic noise */
const noise = (n: number, amp: number, seed = 1) => { let s = seed; return Float32Array.from({ length: n }, () => { s = (s * 1664525 + 1013904223) % 4294967296; return (s / 4294967296 - 0.5) * 2 * amp; }); };

describe('echo-loop test sound', () => {
  const tpl = makeChirp(SR);
  it('makes a half-second sweep that fades in and out', () => {
    expect(tpl.length).toBe(SR / 2);
    expect(Math.abs(tpl[0])).toBeLessThan(0.001);
    expect(Math.max(...tpl.map(Math.abs))).toBeLessThan(0.13);
  });
  it('averages blocks', () => {
    expect(Array.from(decimate([1, 3, 5, 7], 2))).toEqual([2, 6]);
  });
  it('finds the sound when it comes back, even quiet and in noise, and says when', () => {
    const rec = noise(SR * 3, 0.02);
    const at = Math.round(SR * 0.9);
    for (let i = 0; i < tpl.length; i++) rec[at + i] += tpl[i] * 0.4;
    const hit = detectChirp(rec, tpl, SR);
    expect(hit.found).toBe(true);
    expect(hit.strength).toBeGreaterThan(0.5);
    expect(hit.lagMs).toBeGreaterThan(880);
    expect(hit.lagMs).toBeLessThan(920);
  });
  it('does not find it in noise alone, silence, or a different sound', () => {
    expect(detectChirp(noise(SR * 3, 0.05, 7), tpl, SR).found).toBe(false);
    expect(detectChirp(new Float32Array(SR * 3), tpl, SR).found).toBe(false);
    const tone = Float32Array.from({ length: SR * 3 }, (_, i) => 0.1 * Math.sin(2 * Math.PI * 3000 * i / SR));
    expect(detectChirp(tone, tpl, SR).found).toBe(false);
    expect(detectChirp(new Float32Array(10), tpl, SR).found).toBe(false);
  });
  it('explains the result for a mixer and for a laptop', () => {
    expect(routeAdvice(false, 'usb-mixer').tone).toBe('ok');
    expect(routeAdvice(true, 'usb-mixer').text).toMatch(/mixer is sending/);
    expect(routeAdvice(true, 'usb-mic').text).toMatch(/headphones/);
  });
});
