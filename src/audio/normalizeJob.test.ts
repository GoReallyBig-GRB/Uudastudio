import { describe, expect, it } from 'vitest';
import { amplifyProcessor, measureSource } from './chunkedJob';
import { createVirtualSource } from './chunkedProcess';
import { planNormalize } from './dsp/leveling';

const SR = 44100;
const piece = (data: Float32Array[]) => ({ frames: data[0].length, gain: 1, muted: false, read: async (s: number, n: number) => data.map((c) => c.subarray(s, s + n)) });

describe('normalize job', () => {
  it('measures a long two-piece source in blocks and lands the peak on target after the gain', async () => {
    const a = Float32Array.from({ length: SR * 30 }, (_, i) => 0.1 * Math.sin(i * 0.03));
    const b = Float32Array.from({ length: SR * 25 }, (_, i) => 0.2 * Math.sin(i * 0.05));
    const src = createVirtualSource([piece([a, a]), piece([b, b])], 2);
    const m = await measureSource(src, SR);
    expect(m.peak).toBeCloseTo(0.2, 3);
    const plan = planNormalize(m, { mode: 'peak', peakDb: -3 });
    const out = await amplifyProcessor(plan.gainDb)(await src.read(0, src.totalFrames), { leadIn: 0, sampleRate: SR, index: 0 });
    let pk = 0; for (const v of out[0]) pk = Math.max(pk, Math.abs(v));
    expect(20 * Math.log10(pk)).toBeCloseTo(-3, 1);
  });
  it('stops when cancelled', async () => {
    const a = new Float32Array(SR * 60).fill(0.1);
    const src = createVirtualSource([piece([a])], 1);
    await expect(measureSource(src, SR, undefined, { aborted: true })).rejects.toThrow();
  });
});
