import { describe, expect, it } from 'vitest';
import type { Clip } from '../types';
import { edgeZonePx, pickEdge, trimEdge } from './clipEdge';

const clip = (id: string, start: number, dur: number): Clip => ({ id, trackId: 't', assetId: 'a', name: id, startSeconds: start, offsetSeconds: 0, durationSeconds: dur, gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'linear' } as Clip);

describe('edge zone', () => {
  it('is 10 px normally, wider on touch, and shrinks on very short clips', () => {
    expect(edgeZonePx(400)).toBe(10);
    expect(edgeZonePx(400, true)).toBe(18);
    expect(edgeZonePx(18)).toBe(6);
    expect(edgeZonePx(3)).toBe(4);
  });
});

describe('pickEdge', () => {
  const clips = [clip('a', 1, 2), clip('b', 3.05, 2)]; // 100 px per second: a ends at 300, b starts at 305
  it('finds the end under the pointer on either side', () => {
    expect(pickEdge(clips, new Map(), 104, 100)).toEqual({ clipId: 'a', edge: 'left', distance: 4 });
    expect(pickEdge(clips, new Map(), 296, 100)?.edge).toBe('right');
  });
  it('picks the nearest end when two ends are close, so a neighbour cannot steal it', () => {
    expect(pickEdge(clips, new Map(), 304, 100)?.clipId).toBe('b');
    expect(pickEdge(clips, new Map(), 301, 100)?.clipId).toBe('a');
  });
  it('misses when the pointer is in the middle of a clip', () => {
    expect(pickEdge(clips, new Map(), 200, 100)).toBeNull();
  });
  it('skips ends that are joins inside one edited clip', () => {
    const seams = new Map([['a', { left: false, right: true }], ['b', { left: true, right: false }]]);
    expect(pickEdge(clips, seams, 302, 100)).toBeNull();
    expect(pickEdge(clips, seams, 104, 100)?.clipId).toBe('a');
  });
});

describe('trimEdge', () => {
  const init = { startSeconds: 4, offsetSeconds: 2, durationSeconds: 5 };
  it('trims inward from the left and the right', () => {
    expect(trimEdge('left', 1, init, 20)).toEqual({ startSeconds: 5, offsetSeconds: 3, durationSeconds: 4 });
    expect(trimEdge('right', -1, init, 20)).toEqual({ startSeconds: 4, offsetSeconds: 2, durationSeconds: 4 });
  });
  it('brings back trimmed audio when dragged outward, up to the source start', () => {
    expect(trimEdge('left', -1, init, 20)).toEqual({ startSeconds: 3, offsetSeconds: 1, durationSeconds: 6 });
    expect(trimEdge('left', -9, init, 20)).toEqual({ startSeconds: 2, offsetSeconds: 0, durationSeconds: 7 });
  });
  it('cannot pass time 0 on the left', () => {
    expect(trimEdge('left', -9, { startSeconds: 1, offsetSeconds: 5, durationSeconds: 3 }, 20)).toEqual({ startSeconds: 0, offsetSeconds: 4, durationSeconds: 4 });
  });
  it('grows the right end up to the end of the source, and not beyond', () => {
    expect(trimEdge('right', 3, init, 20)).toEqual({ startSeconds: 4, offsetSeconds: 2, durationSeconds: 8 });
    expect(trimEdge('right', 99, init, 20)).toEqual({ startSeconds: 4, offsetSeconds: 2, durationSeconds: 18 });
    expect(trimEdge('right', 99, init, null).durationSeconds).toBe(5);
  });
  it('stops at the neighbouring clip when extending', () => {
    expect(trimEdge('right', 9, init, 20, { minStart: 0, maxEnd: 11 }).durationSeconds).toBe(7);
    expect(trimEdge('left', -9, init, 20, { minStart: 3.5, maxEnd: Infinity })).toEqual({ startSeconds: 3.5, offsetSeconds: 1.5, durationSeconds: 5.5 });
  });
  it('never makes a clip shorter than the minimum', () => {
    expect(trimEdge('left', 99, init, 20).durationSeconds).toBeCloseTo(0.05, 6);
    expect(trimEdge('right', -99, init, 20).durationSeconds).toBeCloseTo(0.05, 6);
  });
});
