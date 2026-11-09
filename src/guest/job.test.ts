import { describe, expect, it } from 'vitest';
import { cleanJob, countWords, decodeJob, encodeJob, estimateSeconds, formatClock, isJoinHash, jobFromHash, jobLink, parseScript } from './job';
import { floatToInt16, peakOf, takeFileName, totalSamples, wavBlob, wavBytes, wavHeader } from './wavWriter';
import { parseWavHeader } from '../assets/wavHeader';

describe('script', () => {
  it('splits director notes from speech and does not count notes as words', () => {
    const s = 'Hello there. [warm, smiling] Welcome to the show [pause] today.';
    expect(parseScript(s).map((x) => [x.kind, x.text.trim()])).toEqual([
      ['speech', 'Hello there.'], ['note', 'warm, smiling'], ['speech', 'Welcome to the show'], ['note', 'pause'], ['speech', 'today.'],
    ]);
    expect(countWords(s)).toBe(7);
    expect(estimateSeconds(s)).toBeCloseTo(7 / 2.5);
  });
  it('treats an unclosed bracket as speech', () => {
    expect(parseScript('One [two')).toEqual([{ kind: 'speech', text: 'One [two' }]);
    expect(countWords('One [two')).toBe(2);
  });
  it('an empty script has no segments', () => {
    expect(parseScript('')).toEqual([]);
    expect(countWords('  [only a note]  ')).toBe(0);
  });
});

describe('job link', () => {
  const job = { v: 1 as const, title: 'Intro – Ünï', script: 'Héllo wörld. [calm]\nSecond line 你好', targetSeconds: 45, producer: 'Ada' };
  it('round-trips, including accents and non-latin text', () => {
    expect(decodeJob(encodeJob(job))).toEqual(job);
  });
  it('is safe to put in an address', () => {
    const link = jobLink(job, 'https://app.example/x?y=1#old');
    expect(link.startsWith('https://app.example/x?y=1#/join/')).toBe(true);
    expect(/^[A-Za-z0-9_-]+$/.test(link.split('#/join/')[1])).toBe(true);
    expect(jobFromHash('#' + link.split('#')[1])).toEqual(job);
  });
  it('rejects anything that is not a job', () => {
    expect(decodeJob('not a job')).toBeNull();
    expect(decodeJob('')).toBeNull();
    expect(decodeJob(btoa(JSON.stringify({ v: 2, script: 'x' })))).toBeNull();
    expect(jobFromHash('#/other/abc')).toBeNull();
    expect(isJoinHash('#/join/abc')).toBe(true);
  });
  it('cleans and limits input', () => {
    expect(cleanJob({ title: '  ', script: 'a' }).title).toBe('Voice recording');
    expect(cleanJob({ script: 'a', targetSeconds: -5 }).targetSeconds).toBeUndefined();
    expect(cleanJob({ script: 'x'.repeat(20000) }).script.length).toBe(12000);
  });
  it('formats clock times', () => {
    expect([formatClock(0), formatClock(42.9), formatClock(65), formatClock(3725)]).toEqual(['0:00', '0:42', '1:05', '1:02:05']);
  });
});

describe('wav writer', () => {
  it('writes a header the app\'s own importer reads back', () => {
    const chunks = [floatToInt16(new Float32Array([0, 0.5, -0.5])), floatToInt16(new Float32Array([1, -1]))];
    const header = wavHeader(totalSamples(chunks), 48000);
    const info = parseWavHeader(header, 44 + 10)!;
    expect([info.format, info.channels, info.sampleRate, info.bitsPerSample, info.frames]).toEqual(['pcm', 1, 48000, 16, 5]);
  });
  it('converts to 16-bit with clipping and keeps full scale', () => {
    expect(Array.from(floatToInt16(new Float32Array([1, -1, 2, -2, 0])))).toEqual([32767, -32768, 32767, -32768, 0]);
  });
  it('blob size matches the estimate', async () => {
    const chunks = [new Int16Array(100), new Int16Array(28)];
    expect(wavBlob(chunks, 44100).size).toBe(wavBytes(128 / 44100, 44100));
  });
  it('file names are safe and carry job, talent and take', () => {
    expect(takeFileName('Intro / Ünï: v2', 'Ada O.', 3)).toBe('Intro-Uni-v2_Ada-O_take-3.wav');
    expect(takeFileName('', '', 1)).toBe('Voice-recording_Talent_take-1.wav');
  });
  it('peak', () => expect(peakOf(new Float32Array([0.1, -0.7, 0.3]))).toBeCloseTo(0.7));
});
