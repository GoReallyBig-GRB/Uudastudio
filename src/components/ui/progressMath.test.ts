import { describe, expect, it } from 'vitest';
import { clampPercent, formatDuration, secondsLeft } from './progressMath';

describe('progress math', () => {
  it('estimates the time left from the speed so far', () => {
    expect(secondsLeft(30, 0.5)).toBeCloseTo(30);
    expect(secondsLeft(10, 0.25)).toBeCloseTo(30);
  });
  it('gives no estimate at the very start, and zero at the end', () => {
    expect(secondsLeft(5, 0.01)).toBeNull();
    expect(secondsLeft(0, 0.5)).toBeNull();
    expect(secondsLeft(50, 1)).toBe(0);
  });
  it('formats durations', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(185)).toBe('3m 05s');
    expect(formatDuration(3720)).toBe('1h 02m');
  });
  it('clamps the percentage', () => {
    expect(clampPercent(-1)).toBe(0);
    expect(clampPercent(0.456)).toBe(46);
    expect(clampPercent(3)).toBe(100);
  });
});
