import { describe, expect, it } from 'vitest';
import { analyseFrames, frameOf, toDb, type Frame } from './micAnalysis';

const frames = (noise: number, speech: number, peak: number, n = 100): Frame[] =>
  Array.from({ length: n }, (_, i) => (i % 3 === 0 ? { rmsDb: noise, peakDb: noise + 6 } : { rmsDb: speech, peakDb: i === 5 ? peak : Math.min(speech + 8, -3) }));

describe('microphone check', () => {
  it('measures a block of samples', () => {
    expect(toDb(1)).toBeCloseTo(0);
    expect(toDb(0)).toBe(-120);
    const f = frameOf(new Float32Array(100).fill(0.5));
    expect(f.rmsDb).toBeCloseTo(-6.02, 1);
    expect(f.peakDb).toBeCloseTo(-6.02, 1);
    expect(frameOf([]).rmsDb).toBe(-120);
  });
  it('calls a good level good, with a quiet room', () => {
    const r = analyseFrames(frames(-70, -22, -8));
    expect(r.verdict).toBe('good');
    expect(r.room).toBe('quiet');
    expect(r.messages).toEqual(['Good level.']);
  });
  it('hears nothing, no speech, too quiet, too loud and clipping', () => {
    expect(analyseFrames([]).verdict).toBe('silent');
    expect(analyseFrames(frames(-90, -80, -70)).verdict).toBe('silent');
    expect(analyseFrames(frames(-48, -46, -30)).verdict).toBe('no-speech');
    expect(analyseFrames(frames(-70, -38, -20)).verdict).toBe('too-quiet');
    expect(analyseFrames(frames(-70, -9, -3)).verdict).toBe('too-loud');
    expect(analyseFrames(frames(-70, -22, -0.2)).verdict).toBe('clipping');
  });
  it('warns about a noisy room', () => {
    const r = analyseFrames(frames(-36, -20, -8));
    expect(r.room).toBe('noisy');
    expect(r.messages[1]).toMatch(/background noise/);
  });
});
