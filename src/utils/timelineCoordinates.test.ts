import { describe, expect, it } from 'vitest';
import { timeToViewportX, viewportXToTime } from './timelineCoordinates';

describe('timeline ruler coordinate transforms', () => {
  it.each([
    { time: 0, zoom: 100, scroll: 0 },
    { time: 12.5, zoom: 80, scroll: 250 },
    { time: 3600, zoom: 30, scroll: 100_000 },
    { time: 7200, zoom: 60, scroll: 430_000 },
  ])('round-trips time $time at zoom $zoom and scroll $scroll', ({ time, zoom, scroll }) => {
    const viewportX = timeToViewportX(time, zoom, scroll);
    expect(viewportXToTime(viewportX, zoom, scroll)).toBeCloseTo(time, 8);
  });

  it('maps a scrolled viewport point back into timeline time', () => {
    expect(viewportXToTime(150, 50, 850)).toBe(20);
  });

  it('clamps positions before the timeline start to zero', () => {
    expect(viewportXToTime(0, 100, 0)).toBe(0);
    expect(viewportXToTime(0, 100, 500)).toBe(5);
    expect(viewportXToTime(-700, 100, 0)).toBe(0);
  });

  it('guards invalid zoom values during pointer seeking', () => {
    expect(viewportXToTime(100, 0, 50)).toBe(0);
    expect(viewportXToTime(100, -1, 50)).toBe(0);
    expect(viewportXToTime(100, Number.NaN, 50)).toBe(0);
  });
});
