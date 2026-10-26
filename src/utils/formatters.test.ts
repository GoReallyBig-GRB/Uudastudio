import { describe, it, expect } from 'vitest';
import { formatTrackLength, trackEndSeconds } from './formatters';

describe('track length display', () => {
  it('uses the end of the last clip', () => {
    expect(trackEndSeconds([])).toBe(0);
    expect(trackEndSeconds([{ startSeconds: 0, durationSeconds: 10 }, { startSeconds: 30, durationSeconds: 5 }])).toBe(35);
  });
  it('formats for a quick glance', () => {
    expect(formatTrackLength(0)).toBe('0:00');
    expect(formatTrackLength(45)).toBe('0:45');
    expect(formatTrackLength(187)).toBe('3:07');
    expect(formatTrackLength(5225)).toBe('1:27:05');
  });
});
