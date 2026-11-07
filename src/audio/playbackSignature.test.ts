import { describe, expect, it } from 'vitest';
import type { Clip, Track } from '../types';
import { playbackSignature } from './playbackSignature';

const clip = (over: Partial<Clip> = {}): Clip => ({
  id: 'c', trackId: 't', assetId: 'a', name: 'c', startSeconds: 0, offsetSeconds: 0, durationSeconds: 5,
  gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'linear', ...over,
});
const tr = (clips: Clip[]): Track[] => [{ id: 't', name: 't', clips, volume: 1, pan: 0, muted: false, solo: false }];

describe('playbackSignature', () => {
  it('ignores gain, track fader and names, which apply live', () => {
    const a = playbackSignature(tr([clip()]));
    expect(playbackSignature(tr([clip({ gain: 2, name: 'x' })]))).toBe(a);
    const louder = tr([clip()]); louder[0].volume = 0.2;
    expect(playbackSignature(louder)).toBe(a);
  });
  it('changes for anything that is fixed when playback is scheduled', () => {
    const a = playbackSignature(tr([clip()]));
    for (const over of [{ startSeconds: 1 }, { durationSeconds: 4 }, { offsetSeconds: 1 }, { muted: true }, { fadeOutSeconds: 1 }, { id: 'd' }, { assetId: 'b' }, { groupId: 'g' }]) {
      expect(playbackSignature(tr([clip(over)]))).not.toBe(a);
    }
    expect(playbackSignature(tr([clip(), clip({ id: 'd' })]))).not.toBe(a);
  });
});
