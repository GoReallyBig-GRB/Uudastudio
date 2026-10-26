import { describe, it, expect } from 'vitest';
import { StreamedClipPlayer } from './streamScheduler';

interface Started { when: number; length: number; first: number; stopped: boolean }

function fakeCtx() {
  const ctx = {
    currentTime: 0,
    started: [] as Started[],
    createBuffer(n: number, length: number) {
      const chans = Array.from({ length: n }, () => new Float32Array(length));
      return { numberOfChannels: n, length, copyToChannel: (d: Float32Array, c: number) => chans[c].set(d), getChannelData: (c: number) => chans[c] } as any;
    },
    createBufferSource() {
      const s: any = {
        buffer: null, onended: null,
        connect() {}, disconnect() {},
        start(when: number) { ctx.started.push({ when, length: s.buffer.length, first: s.buffer.getChannelData(0)[0], stopped: false }); s.rec = ctx.started[ctx.started.length - 1]; },
        stop() { if (s.rec) s.rec.stopped = true; },
      };
      return s;
    },
  };
  return ctx;
}

// source whose sample value at frame i is i, so segment boundaries can be checked exactly
const ramp = (total: number) => async (start: number, frames: number) => {
  const n = Math.max(0, Math.min(frames, total - start));
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = start + i;
  return [a, a];
};
const dest = {} as any;

describe('StreamedClipPlayer', () => {
  it('schedules gapless, sample-exact segments and stops at the end', async () => {
    const ctx = fakeCtx();
    const p = new StreamedClipPlayer({ ctx, destination: dest, read: ramp(100), channels: 2, sampleRate: 10, startFrame: 0, frames: 100, when: 1, segmentSeconds: 3, lookaheadSeconds: 1000 });
    p.start(); await p.done;
    expect(ctx.started.map((s) => s.length)).toEqual([30, 30, 30, 10]);
    let t = 1;
    for (const s of ctx.started) { expect(s.when).toBeCloseTo(t, 9); t += s.length / 10; }
    expect(ctx.started.map((s) => s.first)).toEqual([0, 30, 60, 90]);
  });

  it('starts mid-file and honours the clip length', async () => {
    const ctx = fakeCtx();
    const p = new StreamedClipPlayer({ ctx, destination: dest, read: ramp(1000), channels: 1, sampleRate: 10, startFrame: 250, frames: 45, when: 0, segmentSeconds: 2, lookaheadSeconds: 1000 });
    p.start(); await p.done;
    expect(ctx.started.reduce((a, s) => a + s.length, 0)).toBe(45);
    expect(ctx.started[0].first).toBe(250);
  });

  it('uses a preloaded first segment without reading it again', async () => {
    const ctx = fakeCtx();
    const reads: number[] = [];
    const read = async (s: number, f: number) => { reads.push(s); return ramp(100)(s, f); };
    const pre = await ramp(100)(0, 30);
    const p = new StreamedClipPlayer({ ctx, destination: dest, read, channels: 2, sampleRate: 10, startFrame: 0, frames: 100, when: 0, preloaded: pre, segmentSeconds: 3, lookaheadSeconds: 1000 });
    p.start(); await p.done;
    expect(reads).toEqual([30, 60, 90]);
    expect(ctx.started.length).toBe(4);
  });

  it('only reads within the look-ahead window', async () => {
    const ctx = fakeCtx();
    let waits = 0;
    const wait = async () => { waits++; await new Promise((r) => setTimeout(r, 1)); };
    const p = new StreamedClipPlayer({ ctx, destination: dest, read: ramp(1000), channels: 1, sampleRate: 10, startFrame: 0, frames: 1000, when: 0, segmentSeconds: 5, lookaheadSeconds: 10, wait });
    p.start();
    await new Promise((r) => setTimeout(r, 20));
    // clock frozen at 0: segments at 0, 5, 10 are within 10 s, then it waits
    expect(ctx.started.map((s) => s.when)).toEqual([0, 5, 10]);
    expect(waits).toBeGreaterThan(0);
    ctx.currentTime = 20; // clock moves on → more gets scheduled
    await new Promise((r) => setTimeout(r, 20));
    expect(ctx.started.length).toBeGreaterThan(3);
    p.stop(); await p.done;
  });

  it('skips already-elapsed frames when late instead of drifting', async () => {
    const ctx = fakeCtx(); ctx.currentTime = 2;
    const p = new StreamedClipPlayer({ ctx, destination: dest, read: ramp(100), channels: 1, sampleRate: 10, startFrame: 0, frames: 30, when: 0, segmentSeconds: 3, lookaheadSeconds: 1000 });
    p.start(); await p.done;
    expect(ctx.started.length).toBe(1);
    expect(ctx.started[0].first).toBe(20);
    expect(ctx.started[0].when).toBeCloseTo(2, 9);
  });

  it('stop() halts live sources and ends early', async () => {
    const ctx = fakeCtx();
    const p = new StreamedClipPlayer({ ctx, destination: dest, read: ramp(100), channels: 1, sampleRate: 10, startFrame: 0, frames: 100, when: 0, segmentSeconds: 3, lookaheadSeconds: 1000 });
    p.start(); await p.done;
    p.stop();
    expect(ctx.started.every((s) => s.stopped)).toBe(true);
    expect(p.liveSourceCount).toBe(0);
  });

  it('reports read failures and does not throw', async () => {
    const ctx = fakeCtx(); let err: unknown = null;
    const p = new StreamedClipPlayer({ ctx, destination: dest, read: async () => { throw new Error('gone'); }, channels: 1, sampleRate: 10, startFrame: 0, frames: 30, when: 0, onError: (e) => { err = e; } });
    p.start(); await p.done;
    expect((err as Error).message).toBe('gone');
  });

  it('ends cleanly if stored audio is shorter than expected', async () => {
    const ctx = fakeCtx();
    const p = new StreamedClipPlayer({ ctx, destination: dest, read: ramp(40), channels: 1, sampleRate: 10, startFrame: 0, frames: 100, when: 0, segmentSeconds: 3, lookaheadSeconds: 1000 });
    p.start(); await p.done;
    expect(ctx.started.reduce((a, s) => a + s.length, 0)).toBe(40);
  });
});
