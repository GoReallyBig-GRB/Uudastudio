import { describe, expect, it } from 'vitest';
import { checkTake, findDropouts, parseWavHeader, shortfallSeconds, storageCheck, wavMatches } from './takeCheck';
import { describeSettings, processingOn } from './captureSettings';
import { floatToInt24, pcmToFloat, totalSamples, wavBlob, wavBytes, wavHeader } from './wavWriter';

const SR = 8000;
const noise = (n: number) => Float32Array.from({ length: n }, (_, i) => 0.1 * Math.sin(i * 0.3) + 0.001);

describe('missing audio', () => {
  it('a take as long as the clock is fine, a long shortfall is flagged', () => {
    expect(shortfallSeconds(10, 10.4)).toBe(0);
    expect(shortfallSeconds(8, 10.4)).toBeCloseTo(1.9);
    expect(checkTake(noise(SR * 10), SR, 10.3)).toEqual([]);
    expect(checkTake(noise(SR * 7), SR, 10.3)[0].id).toBe('missing');
  });
});

describe('dropouts', () => {
  it('finds exact silence in the middle and ignores the edges', () => {
    const x = noise(SR * 6);
    x.fill(0, SR * 2, SR * 3);
    x.fill(0, 0, SR * 0.2);
    const d = findDropouts(x, SR);
    expect(d.length).toBe(1);
    expect(d[0].at).toBeCloseTo(2, 1);
    expect(d[0].seconds).toBeCloseTo(1, 1);
    expect(checkTake(x, SR, 6.1).map((i) => i.id)).toEqual(['dropout']);
  });
  it('short silences are not dropouts', () => {
    const x = noise(SR * 6); x.fill(0, SR * 2, SR * 2.2);
    expect(findDropouts(x, SR)).toEqual([]);
  });
});

describe('the WAV we write', () => {
  it('16-bit and 24-bit headers read back and match the file', () => {
    for (const bits of [16, 24] as const) {
      const chunks = bits === 24 ? [floatToInt24(noise(100)), floatToInt24(noise(28))] : [Int16Array.from({ length: 128 }, (_, i) => i)];
      const blob = wavBlob(chunks, SR, bits);
      const h = parseWavHeader(wavHeader(totalSamples(chunks), SR, bits));
      expect(wavMatches(h, blob.size, 128, SR, bits)).toBe(true);
      expect(blob.size).toBe(wavBytes(128 / SR, SR, bits));
      expect(wavMatches(h, blob.size - 1, 128, SR, bits)).toBe(false);
    }
  });
  it('24-bit keeps the detail 16-bit loses', () => {
    const x = Float32Array.from([0.0000123, -0.0000456, 0.5]);
    const back = pcmToFloat([floatToInt24(x)], 24);
    expect(back[0]).toBeCloseTo(x[0], 6);
    expect(back[1]).toBeCloseTo(x[1], 6);
    expect(back[2]).toBeCloseTo(0.5, 6);
  });
  it('rejects a damaged header', () => { expect(parseWavHeader(new Uint8Array(44))).toBeNull(); });
});

describe('storage', () => {
  it('warns when there is not room for about three copies', () => {
    expect(storageCheck({ quota: 100e6, usage: 99e6 }, 600, 48000, 16)?.low).toBe(true);
    expect(storageCheck({ quota: 10e9, usage: 1e9 }, 600, 48000, 16)?.low).toBe(false);
    expect(storageCheck(undefined, 600, 48000, 16)).toBeNull();
  });
});

describe('what the browser really did', () => {
  it('lists the processing still on', () => {
    expect(processingOn({ echoCancellation: false, noiseSuppression: true, autoGainControl: true })).toEqual(['noise suppression', 'automatic gain']);
    expect(processingOn({})).toEqual([]);
  });
  it('describes the line for the producer', () => {
    expect(describeSettings({ sampleRate: 44100 }, 48000)).toBe('microphone 44.1 kHz, recorded at 48 kHz; browser processing: off');
    expect(describeSettings({ sampleRate: 48000, noiseSuppression: true }, 48000)).toBe('48 kHz; browser processing: ON (noise suppression)');
  });
});
