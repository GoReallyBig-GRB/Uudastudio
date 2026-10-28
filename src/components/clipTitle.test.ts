import { describe, expect, it } from 'vitest';
import { displayTitle, fitTitle, formatClipLength, nextPartName } from './clipTitle';

const measure = (s: string) => s.length * 6; // fixed-width stand-in for canvas measureText

describe('fitTitle', () => {
  it('returns the whole title when it fits', () => {
    expect(fitTitle('Intro', 100, measure)).toBe('Intro');
  });

  it('cuts to the available width with an ellipsis', () => {
    const out = fitTitle('Marriage Sex - Do You Have To Always Be In The Mood', 90, measure);
    expect(out.endsWith('…')).toBe(true);
    expect(measure(out)).toBeLessThanOrEqual(90);
    // It is the longest prefix that fits: one more character would not.
    const body = out.slice(0, -1);
    expect(measure(`${'Marriage Sex - Do You Have To Always Be In The Mood'.slice(0, body.length + 1)}…`)).toBeGreaterThan(90);
  });

  it('draws nothing when there is too little room', () => {
    expect(fitTitle('Intro', 10, measure)).toBe('');
    expect(fitTitle('Intro', 0, measure)).toBe('');
    expect(fitTitle('Intro', Number.NaN, measure)).toBe('');
    expect(fitTitle('', 100, measure)).toBe('');
  });

  it('never exceeds the width, whatever the width', () => {
    for (let w = 0; w < 300; w += 7) {
      const out = fitTitle('A fairly long clip name for testing', w, measure);
      expect(measure(out)).toBeLessThanOrEqual(Math.max(0, w));
    }
  });
});

describe('part names', () => {
  it('does not stack (Part 2) tags when splitting again', () => {
    expect(nextPartName('Take')).toBe('Take (Part 2)');
    expect(nextPartName('Take (Part 2)')).toBe('Take (Part 2)');
    expect(nextPartName('Take (Part 2) (Part 2) (Part 2)')).toBe('Take (Part 2)');
  });

  it('collapses an existing pile of tags for display', () => {
    expect(displayTitle('Take (Part 2) (Part 2) (Part 2)')).toBe('Take (Part 2)');
    expect(displayTitle('Take (Part 2)(Part 2)')).toBe('Take (Part 2)');
    expect(displayTitle('Take')).toBe('Take');
  });

  it('falls back for blank names', () => {
    expect(displayTitle('')).toBe('Audio Clip');
    expect(displayTitle(undefined)).toBe('Audio Clip');
    expect(displayTitle('  ')).toBe('Audio Clip');
  });

  it('keeps a tag that is the whole name', () => {
    expect(displayTitle('(Part 2) (Part 2)')).toBe('(Part 2)');
  });
});

describe('formatClipLength', () => {
  it('shows seconds under a minute and m:ss above', () => {
    expect(formatClipLength(12.44)).toBe('12.4s');
    expect(formatClipLength(185)).toBe('3:05');
    expect(formatClipLength(60)).toBe('1:00');
  });

  it('returns nothing for invalid values', () => {
    expect(formatClipLength(Number.NaN)).toBe('');
    expect(formatClipLength(-1)).toBe('');
  });
});
