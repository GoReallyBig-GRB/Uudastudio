import { describe, expect, it } from 'vitest';
import type { StreamedMeta } from '../../assets/streamedStore';
import { AlignedSink, TakeReceiver, TakeSender, crc32, padFramesFor, decodeChunk, encodeChunk, pack24, unpack24, validOffer, type Control, type SinkFactory, type TakeOffer } from './transfer';

const SR = 8000;
const offerOf = (frames: number, id = 'tk1', channels = 1): TakeOffer => ({ takeId: id, name: 'Take', sampleRate: SR, channels, frames, startAt: 1000, stopAt: 5000, roomStartMs: 900 });
const wave = (frames: number, channels = 1): Float32Array[] => Array.from({ length: channels }, (_, c) => Float32Array.from({ length: frames }, (_, i) => 0.8 * Math.sin((i + c) / 7)));

/** A receiver that keeps what it was given, and a sender wired straight to it */
function rig(opts: { frames: number; channels?: number; corruptOnce?: number; dropAfterBytes?: number; id?: string; failWrite?: boolean }) {
  const source = wave(opts.frames, opts.channels ?? 1);
  const got: Float32Array[][] = [];
  const done: Array<{ offer: TakeOffer; meta: StreamedMeta }> = [];
  let aborted = 0;
  const factory: SinkFactory = async (offer) => ({
    write: async (p) => { if (opts.failWrite) throw new Error('disk'); got.push(p); },
    finish: async () => ({ storeId: 's1', sampleRate: offer.sampleRate, channels: offer.channels, frames: got.reduce((n, p) => n + p[0].length, 0), durationSeconds: 1, peakBase: 256, complete: true, createdAt: 0 }),
    abort: async () => { aborted++; got.length = 0; },
  });
  let sender: TakeSender;
  const recv = new TakeReceiver(factory, (c: Control) => { queueMicrotask(() => sender.onText(JSON.stringify(c))); }, (offer, meta) => done.push({ offer, meta }));
  let chunks = 0, bytes = 0, linkUp = true;
  const io = {
    sendText: (s: string) => { if (linkUp) void recv.onText(s); },
    sendBinary: (b: ArrayBuffer) => {
      if (!linkUp) return;
      chunks++; bytes += b.byteLength;
      let data = b;
      if (opts.corruptOnce === chunks) { data = b.slice(0); new Uint8Array(data)[20] ^= 0xff; }
      void recv.onBinary(data);
      if (opts.dropAfterBytes !== undefined && bytes >= opts.dropAfterBytes) { linkUp = false; opts.dropAfterBytes = undefined; }
    },
    buffered: () => 0,
  };
  sender = new TakeSender(io, async (s, n) => source.map((ch) => ch.slice(s, s + n)), { chunkFrames: 1000, maxBytesPerSec: 1e9, sleep: async () => undefined, replyTimeoutMs: 200 });
  return { sender, recv, got, done, source, stats: () => ({ chunks, aborted }), up: () => { linkUp = true; } };
}

describe('packing', () => {
  it('keeps 24-bit precision', () => {
    const x = wave(500)[0];
    const back = unpack24(pack24([x]), 1, 500)[0];
    let worst = 0; for (let i = 0; i < x.length; i++) worst = Math.max(worst, Math.abs(x[i] - back[i]));
    expect(worst).toBeLessThan(2e-7);
  });
  it('clips beyond full scale and keeps channels apart', () => {
    const [a, b] = unpack24(pack24([Float32Array.of(2, -2, 0), Float32Array.of(0.5, 0.25, -0.5)]), 2, 3);
    expect(a[0]).toBeCloseTo(1, 5); expect(a[1]).toBeCloseTo(-1, 5);
    expect(b[0]).toBeCloseTo(0.5, 6); expect(b[2]).toBeCloseTo(-0.5, 6);
  });
  it('has a known check value', () => { expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926); });
  it('rejects a damaged or wrong-sized piece', () => {
    const buf = encodeChunk(40, wave(100, 2));
    expect(decodeChunk(buf, 2)?.startFrame).toBe(40);
    const bad = buf.slice(0); new Uint8Array(bad)[30] ^= 1;
    expect(decodeChunk(bad, 2)).toBeNull();
    expect(decodeChunk(buf, 1)).toBeNull();
    expect(decodeChunk(new ArrayBuffer(4), 1)).toBeNull();
  });
  it('checks offers', () => {
    expect(validOffer(offerOf(100))).toBeNull();
    expect(validOffer(offerOf(0))).not.toBeNull();
    expect(validOffer({ ...offerOf(100), channels: 6 })).not.toBeNull();
    expect(validOffer({ ...offerOf(100), sampleRate: 5 })).not.toBeNull();
  });
});

describe('hand-over', () => {
  it('delivers a whole take, in order and exact', async () => {
    const r = rig({ frames: 3500, channels: 2 });
    const res = await r.sender.send(offerOf(3500, 'tk1', 2));
    expect(res).toBe('done');
    expect(r.done).toHaveLength(1);
    const left = Float32Array.from(r.got.flatMap((p) => Array.from(p[0])));
    expect(left).toHaveLength(3500);
    for (let i = 0; i < 3500; i += 97) expect(Math.abs(left[i] - r.source[0][i])).toBeLessThan(2e-7);
    expect(r.stats().chunks).toBe(4);
  });
  it('asks for a damaged piece again and still finishes exactly', async () => {
    const r = rig({ frames: 3000, corruptOnce: 2 });
    expect(await r.sender.send(offerOf(3000))).toBe('done');
    const all = Float32Array.from(r.got.flatMap((p) => Array.from(p[0])));
    expect(all).toHaveLength(3000);
    expect(Math.abs(all[1500] - r.source[0][1500])).toBeLessThan(2e-7);
  });
  it('carries on from where it stopped after the link drops', async () => {
    const r = rig({ frames: 5000, dropAfterBytes: 2 * (12 + 3000) });
    expect(await r.sender.send(offerOf(5000))).toBe('aborted'); // the link went quiet
    const before = r.got.reduce((n, p) => n + p[0].length, 0);
    expect(before).toBeGreaterThan(0); expect(before).toBeLessThan(5000);
    r.up();
    expect(await r.sender.send(offerOf(5000))).toBe('done');
    expect(r.got.reduce((n, p) => n + p[0].length, 0)).toBe(5000);
    expect(r.stats().aborted).toBe(0);
    expect(r.done).toHaveLength(1);
  });
  it('answers done at once for a take it already has', async () => {
    const r = rig({ frames: 1500 });
    await r.sender.send(offerOf(1500));
    const chunksBefore = r.stats().chunks;
    expect(await r.sender.send(offerOf(1500))).toBe('done');
    expect(r.stats().chunks).toBe(chunksBefore);
    expect(r.done).toHaveLength(1);
  });
  it('refuses an invalid offer and reports a disk problem', async () => {
    const bad = rig({ frames: 100 });
    expect(await bad.sender.send({ ...offerOf(100), channels: 9 })).toBe('refused');
    const full = rig({ frames: 1500, failWrite: true });
    expect(await full.sender.send(offerOf(1500))).toBe('refused');
    expect(full.sender.refusal).toMatch(/space/);
  });
  it('holds off while paused', async () => {
    const r = rig({ frames: 1000 });
    let paused = 3, naps = 0;
    const s2 = new TakeSender({ sendText: (t) => { void r.recv.onText(t); }, sendBinary: (b) => { void r.recv.onBinary(b); }, buffered: () => 0 }, async (s, n) => r.source.map((c) => c.slice(s, s + n)), { paused: () => paused-- > 0, sleep: async () => { naps++; }, maxBytesPerSec: 1e9, replyTimeoutMs: 200 });
    // wire the receiver's replies to this sender
    (r.recv as unknown as { reply: (c: Control) => void }).reply = (c) => queueMicrotask(() => s2.onText(JSON.stringify(c)));
    expect(await s2.send(offerOf(1000))).toBe('done');
    expect(naps).toBeGreaterThanOrEqual(3);
  });
});

describe('placing the file on the host timeline', () => {
  const sinkOf = () => { const got: Float32Array[][] = []; return { got, sink: { write: async (p: Float32Array[]) => { got.push(p.map((c) => Float32Array.from(c))); }, finish: async () => ({}) as StreamedMeta, abort: async () => undefined }, total: () => got.reduce((n, p) => n + p[0].length, 0) }; };
  it('works out the gap from the two start times', () => {
    expect(padFramesFor(1500, 1000, 8000)).toBe(4000);
    expect(padFramesFor(900, 1000, 8000)).toBe(-800);
    expect(padFramesFor(1500, null, 8000)).toBe(0);
    expect(padFramesFor(100_000, 1000, 8000)).toBe(0);
  });
  it('adds silence at the start when the guest began later', async () => {
    const o = sinkOf(); const a = new AlignedSink(o.sink, 500, 8000, 1);
    await a.write(wave(1000)); await a.write(wave(1000));
    expect(o.total()).toBe(2500);
    expect(o.got[0][0].every((v) => v === 0)).toBe(true);
    expect(o.got[1][0][0]).toBe(wave(1000)[0][0]);
  });
  it('trims the start when the guest began earlier, even across several pieces', async () => {
    const o = sinkOf(); const a = new AlignedSink(o.sink, -1500, 8000, 1);
    const src = wave(1000);
    await a.write(src); await a.write(src); await a.write(src);
    expect(o.total()).toBe(1500);
    expect(o.got[0][0][0]).toBe(src[0][500]);
  });
  it('leaves an aligned file alone and still builds the loudness record', async () => {
    const o = sinkOf(); const a = new AlignedSink(o.sink, 0, 8000, 1);
    await a.write([new Float32Array(16000).fill(0.1)]);
    expect(o.total()).toBe(16000);
    expect(a.envelope.bins).toHaveLength(20);
  });
});
