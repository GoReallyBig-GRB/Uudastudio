import { describe, expect, it } from 'vitest';
import { capChars, displayTitle, fitTitle, formatClipLength, nextPartName, placeTip } from './clipTitle';

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

describe('capChars', () => {
  it('leaves short titles and cuts long ones with an ellipsis', () => {
    expect(capChars('Take 1', 10)).toBe('Take 1');
    expect(capChars('A very long clip title', 10)).toBe('A very lo…');
    expect(capChars('A very long clip title', 10).length).toBe(10);
  });
});

describe('placeTip', () => {
  it('sits right of and below the pointer when there is room', () => {
    expect(placeTip(100, 100, 120, 24, 1000, 800)).toMatchObject({ left: 114, top: 118 });
  });
  it('flips left near the right edge', () => {
    const r = placeTip(950, 100, 120, 24, 1000, 800);
    expect(r.left).toBe(950 - 14 - 120);
  });
  it('flips above near the bottom edge', () => {
    const r = placeTip(100, 790, 120, 24, 1000, 800);
    expect(r.top).toBe(790 - 12 - 24);
  });
  it('never starts left of the margin and caps the width to the screen', () => {
    const r = placeTip(20, 100, 2000, 24, 600, 800);
    expect(r.left).toBe(8);
    expect(r.maxWidth).toBe(584);
  });
});
