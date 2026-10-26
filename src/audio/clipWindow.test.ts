import { describe, it, expect } from 'vitest';
import { clipPlaybackWindow } from './engine';

const clip: any = { startSeconds: 10, offsetSeconds: 5, durationSeconds: 20 };

describe('clipPlaybackWindow', () => {
  it('clip in the future starts later with its own offset', () => {
    expect(clipPlaybackWindow(clip, 4, 100)).toEqual({ when: 106, offsetSeconds: 5, durationSeconds: 20 });
  });
  it('playhead inside the clip starts now, partway in', () => {
    expect(clipPlaybackWindow(clip, 15, 100)).toEqual({ when: 100, offsetSeconds: 10, durationSeconds: 15 });
  });
  it('finished clip gives nothing', () => {
    expect(clipPlaybackWindow(clip, 30, 100) === null).toBe(true);
    expect(clipPlaybackWindow(clip, 31, 100) === null).toBe(true);
  });
});
