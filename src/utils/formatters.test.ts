import { describe, it, expect } from 'vitest';
import { formatTrackLength, trackEndSeconds } from './formatters';

describe('track length display', () => {
  it('uses the end of the last clip', () => {
    expect(trackEndSeconds([])).toBe(0);
    expect(trackEndSeconds([{ startSeconds: 0, durationSeconds: 10 }, { startSeconds: 30, durationSeconds: 5 }])).toBe(35);
  });
  it('shows hours and minutes only', () => {
    expect(formatTrackLength(0)).toBe('');
    expect(formatTrackLength(45)).toBe('<1m');
    expect(formatTrackLength(187)).toBe('3m');
    expect(formatTrackLength(47 * 60)).toBe('47m');
    expect(formatTrackLength(5225)).toBe('1h 27m');
    expect(formatTrackLength(7200)).toBe('2h');
  });
});
