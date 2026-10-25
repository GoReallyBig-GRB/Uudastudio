import { describe, expect, it } from 'vitest';
import { getVisibleClipPixelRange } from './timelineViewport';

describe('viewport-local waveform clipping', () => {
  it('returns the full clip when it fits inside the viewport', () => {
    expect(getVisibleClipPixelRange(120, 300, 800)).toEqual({ startPx: 0, endPx: 300 });
  });

  it('clips the left side of a clip that starts before the viewport', () => {
    expect(getVisibleClipPixelRange(-120, 400, 800)).toEqual({ startPx: 120, endPx: 400 });
  });

  it('clips the right side of a clip that extends past the viewport', () => {
    expect(getVisibleClipPixelRange(650, 400, 800)).toEqual({ startPx: 0, endPx: 150 });
  });

  it('returns an empty range for clips completely outside the viewport', () => {
    expect(getVisibleClipPixelRange(-500, 200, 300)).toEqual({ startPx: 200, endPx: 200 });
    expect(getVisibleClipPixelRange(400, 200, 300)).toEqual({ startPx: 0, endPx: 0 });
  });

  it('handles invalid dimensions without producing an invalid range', () => {
    expect(getVisibleClipPixelRange(Number.NaN, -1, Number.POSITIVE_INFINITY))
      .toEqual({ startPx: 0, endPx: 0 });
  });
});
