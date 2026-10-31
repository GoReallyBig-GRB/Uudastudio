import { describe, expect, it } from 'vitest';
import {
  ChunkedCancelled, PieceSource, createVirtualSource, crossfadeInto, planBlocks, processedUndoLimit, runChunked, stretchedFrames,
} from './chunkedProcess';

/** A piece whose samples are base, base+1, base+2 ... so positions can be checked */
const ramp = (frames: number, base: number, extra: Partial<PieceSource> = {}): PieceSource => ({
  frames, gain: 1, muted: false,
  read: async (start, count) => {
    const n = Math.max(0, Math.min(count, frames - start));
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = base + start + i;
    return [a];
  },
  ...extra,
});

describe('virtual source', () => {
  it('reads across piece boundaries as one stretch of audio', async () => {
    const s = createVirtualSource([ramp(4, 0), ramp(3, 100)], 1);
    expect(s.totalFrames).toBe(7);
    expect(Array.from((await s.read(2, 4))[0])).toEqual([2, 3, 100, 101]);
    expect(Array.from((await s.read(5, 10))[0])).toEqual([101, 102]);
  });

  it('applies gain, silences muted pieces and fills every channel from a mono piece', async () => {
    const s = createVirtualSource([ramp(2, 1, { gain: 2 }), ramp(2, 10, { muted: true })], 2);
    const [l, r] = await s.read(0, 4);
    expect(Array.from(l)).toEqual([2, 4, 0, 0]);
    expect(Array.from(r)).toEqual([2, 4, 0, 0]);
  });
});

describe('planBlocks', () => {
  it('covers every frame once, with a lead-in that never reaches before the start', () => {
    const b = planBlocks(25, 10, 4);
    expect(b.map((x) => [x.start, x.frames, x.leadIn])).toEqual([[0, 10, 0], [10, 10, 4], [20, 5, 4]]);
    expect(b.reduce((n, x) => n + x.frames, 0)).toBe(25);
  });
  it('a short lead-in at the start is clamped, and empty input has no blocks', () => {
    expect(planBlocks(100, 50, 80)[1].leadIn).toBe(50);
    expect(planBlocks(0, 10, 4)).toEqual([]);
  });
});

describe('runChunked', () => {
  it('processes block by block and writes the lead-in-free result in order', async () => {
    const source = createVirtualSource([ramp(10, 0), ramp(10, 100)], 1);
    const out: number[] = [];
    const seenLeadIn: number[] = [];
    const frames = await runChunked({
      source, sampleRate: 1, blockSeconds: 6, leadInSeconds: 2,
      process: (block, info) => { seenLeadIn.push(info.leadIn); return block.map((c) => c.map((v) => v * 2)); },
      write: async (chunk) => { out.push(...chunk[0]); },
    });
    expect(frames).toBe(20);
    expect(seenLeadIn).toEqual([0, 2, 2, 2]);
    const expected = [...Array.from({ length: 10 }, (_, i) => i), ...Array.from({ length: 10 }, (_, i) => 100 + i)].map((v) => v * 2);
    expect(out).toEqual(expected);
  });

  it('reports progress up to 1', async () => {
    const source = createVirtualSource([ramp(9, 0)], 1);
    const p: number[] = [];
    await runChunked({ source, sampleRate: 1, blockSeconds: 3, process: (b) => b, write: async () => {}, onProgress: (f) => p.push(f) });
    expect(p).toEqual([1 / 3, 2 / 3, 1]);
  });

  it('stops between blocks when cancelled', async () => {
    const source = createVirtualSource([ramp(9, 0)], 1);
    const signal = { aborted: false };
    let writes = 0;
    await expect(
      runChunked({ source, sampleRate: 1, blockSeconds: 3, signal, process: (b) => b, write: async () => { writes++; signal.aborted = true; } }),
    ).rejects.toBeInstanceOf(ChunkedCancelled);
    expect(writes).toBe(1);
  });
});

describe('undo limit for processed long audio', () => {
  it('has no limit under 20 minutes, then tightens with length', () => {
    expect(processedUndoLimit(10)).toBeNull();
    expect(processedUndoLimit(20)).toBe(3);
    expect(processedUndoLimit(59)).toBe(3);
    expect(processedUndoLimit(60)).toBe(2);
    expect(processedUndoLimit(119)).toBe(2);
    expect(processedUndoLimit(120)).toBe(1);
    expect(processedUndoLimit(NaN)).toBeNull();
  });
});

describe('stretch and cross-fade helpers', () => {
  it('output length is input over ratio', () => {
    expect(stretchedFrames(1000, 2)).toBe(500);
    expect(stretchedFrames(1000, 0.5)).toBe(2000);
    expect(stretchedFrames(1000, 0)).toBe(1000);
  });
  it('a cross-fade of identical audio keeps the level steady', () => {
    const a = new Float32Array(64).fill(1);
    const b = new Float32Array(64).fill(1);
    crossfadeInto(a, b);
    expect(a[0]).toBeCloseTo(1, 5);
    expect(a[63]).toBeCloseTo(1, 5);
    expect(Math.min(...a)).toBeGreaterThan(0.999);
    expect(Math.max(...a)).toBeLessThan(1.001);
  });
});
