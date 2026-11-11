import { describe, expect, it } from 'vitest';
import { METER_START, blockInfo, meterAdvice, meterPos, nextMeter, zoneOf } from './levelMeter';

const SR = 48000;
const sine = (hz: number, amp: number, n = 4096) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const voice = (f0: number, amp: number) => { const x = new Float32Array(4096); for (let h = 1; h <= 10; h++) for (let i = 0; i < x.length; i++) x[i] += (amp / h) * Math.sin((2 * Math.PI * f0 * h * i) / SR); return x; };

describe('meter scale', () => {
  it('is in decibels: normal speech is visible, and zones start at -18 and -6', () => {
    expect(meterPos(0.1)).toBeGreaterThan(0.5);
    expect(meterPos(1)).toBe(1); expect(meterPos(0)).toBe(0);
    expect(zoneOf(0.05)).toBe('ok'); expect(zoneOf(0.2)).toBe('warn'); expect(zoneOf(0.6)).toBe('danger');
  });
});

describe('plosives', () => {
  it('a low thump is a plosive; a loud deep voice is not; quiet thumps are ignored', () => {
    expect(blockInfo(sine(50, 0.6), SR).plosive).toBe(true);
    expect(blockInfo(voice(110, 0.35), SR).plosive).toBe(false);
    expect(blockInfo(voice(180, 0.4), SR).plosive).toBe(false);
    expect(blockInfo(sine(50, 0.05), SR).plosive).toBe(false);
  });
});

describe('meter state and advice', () => {
  it('holds the peak, then lets it fall', () => {
    let s = nextMeter(METER_START, { peak: 0.5, plosive: false }, 1000);
    s = nextMeter(s, { peak: 0.1, plosive: false }, 1500);
    expect(s.hold).toBe(0.5);
    s = nextMeter(s, { peak: 0.1, plosive: false }, 3000);
    expect(s.hold).toBe(0.1);
  });
  it('gives the most serious advice, and clears it after a moment', () => {
    let s = nextMeter(METER_START, { peak: 0.6, plosive: true }, 1000);
    expect(meterAdvice(s, 1100)!.kind).toBe('pop'); expect(meterAdvice(s, 1100)!.text).toBe('Plosive: step back');
    s = nextMeter(s, { peak: 1, plosive: false }, 1200);
    expect(meterAdvice(s, 1300)!.kind).toBe('clip');
    expect(meterAdvice(s, 5000)).toBeNull();
    expect(meterAdvice(nextMeter(METER_START, { peak: 0.55, plosive: false }, 0), 100)!.kind).toBe('hot');
    expect(meterAdvice(nextMeter(METER_START, { peak: 0.1, plosive: false }, 0), 100)).toBeNull();
  });
});
