import { describe, expect, it, vi } from 'vitest';
import type { Asset, Clip } from '../types';

vi.mock('../assets/streamedStore', () => ({ readStreamedFrames: vi.fn() }));
vi.mock('../assets/streamedWriter', () => ({ createStreamedWriter: vi.fn() }));

import { amplifyProcessor, pieceFromClip } from './chunkedJob';

const fakeBuffer = (data: number[]) => ({ numberOfChannels: 1, getChannelData: () => Float32Array.from(data) }) as unknown as AudioBuffer;
const asset = (data: number[]): Asset => ({ id: 'a', name: 'a', kind: 'recording', buffer: fakeBuffer(data), sampleRate: 10, durationSeconds: data.length / 10, numberOfChannels: 1 });
const clip = (offset: number, dur: number, extra: Partial<Clip> = {}): Clip => ({
  id: 'c', trackId: 't', assetId: 'a', name: 'c', startSeconds: 0, offsetSeconds: offset, durationSeconds: dur,
  gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'exponential', ...extra,
});

describe('pieceFromClip', () => {
  it('reads the clip\'s stretch of an in-memory asset, honouring offset, gain and mute', async () => {
    const a = asset([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const p = pieceFromClip(a, clip(0.3, 0.4, { gain: 2 }));
    expect(p.frames).toBe(4);
    expect(p.gain).toBe(2);
    expect(Array.from((await p.read(1, 2))[0])).toEqual([4, 5]);
    expect(pieceFromClip(a, clip(0, 1, { muted: true })).muted).toBe(true);
  });
});

describe('amplifyProcessor', () => {
  it('multiplies every sample by the dB gain', async () => {
    const out = await amplifyProcessor(6.0206)([Float32Array.from([0.25, -0.5])], { leadIn: 0, sampleRate: 10, index: 0 });
    expect(out[0][0]).toBeCloseTo(0.5, 3);
    expect(out[0][1]).toBeCloseTo(-1, 3);
  });
});
