import { describe, expect, it } from 'vitest';
import { HostMixer, clampStrip, type MixCtx, type MixNode } from './hostMixer';

/** A stand-in for the browser's audio graph that only remembers what is connected to what */
class FakeNode implements MixNode {
  to = new Set<FakeNode>();
  gain = { value: 1 }; type = ''; frequency = { value: 0 }; Q = { value: 0 }; threshold = { value: 0 }; knee = { value: 0 }; ratio = { value: 0 }; attack = { value: 0 }; release = { value: 0 };
  fftSize = 512; stream: MediaStream = {} as MediaStream;
  constructor(public label = '') {}
  connect(n: MixNode) { this.to.add(n as FakeNode); return n; }
  disconnect(n?: MixNode) { if (n) { if (!this.to.delete(n as FakeNode)) throw new Error('not connected'); } else this.to.clear(); }
  getFloatTimeDomainData(a: Float32Array) { a.fill(0.5); }
}
const makeCtx = () => {
  const sources = new Map<MediaStream, FakeNode>();
  const dests: FakeNode[] = [];
  const ctx: MixCtx = {
    destination: new FakeNode('speakers'),
    createGain: () => new FakeNode('gain'), createBiquadFilter: () => new FakeNode('filter'), createDynamicsCompressor: () => new FakeNode('comp'), createAnalyser: () => new FakeNode('meter'),
    createMediaStreamSource: (s) => { const n = new FakeNode('src'); sources.set(s, n); return n; },
    createMediaStreamDestination: () => { const n = new FakeNode('dest'); n.stream = { id: `d${dests.length}` } as unknown as MediaStream; dests.push(n); return n; },
  };
  return { ctx, sources, dests };
};
const stream = (id: string) => ({ id } as unknown as MediaStream);
/** Does sound from `from` reach `to` through any chain of connections? */
const reaches = (from: FakeNode, to: FakeNode, seen = new Set<FakeNode>()): boolean => {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  for (const n of from.to) if (reaches(n, to, seen)) return true;
  return false;
};

describe('mix-minus', () => {
  it('gives each guest the host and the other guests, and never their own voice', () => {
    const { ctx, sources, dests } = makeCtx();
    const m = new HostMixer(ctx);
    const host = stream('host'), g = { a: stream('a'), b: stream('b'), c: stream('c') };
    m.setHostMic(host);
    m.addGuest('a', g.a); m.addGuest('b', g.b); m.addGuest('c', g.c);
    const mixFor = (id: string) => dests.find((d) => d.stream === m.mixMinusStream(id))!;
    for (const id of ['a', 'b', 'c'] as const) {
      expect(reaches(sources.get(host)!, mixFor(id))).toBe(true);
      for (const other of ['a', 'b', 'c'] as const) expect(reaches(sources.get(g[other])!, mixFor(id))).toBe(other !== id);
    }
  });

  it('keeps that true when guests come and go', () => {
    const { ctx, sources, dests } = makeCtx();
    const m = new HostMixer(ctx);
    const a = stream('a'), b = stream('b'), b2 = stream('b2');
    m.addGuest('a', a); m.addGuest('b', b);
    m.removeGuest('b');
    m.addGuest('b', b2); // rejoins
    const mixA = dests.find((d) => d.stream === m.mixMinusStream('a'))!;
    const mixB = dests.find((d) => d.stream === m.mixMinusStream('b'))!;
    expect(reaches(sources.get(b2)!, mixA)).toBe(true);
    expect(reaches(sources.get(b2)!, mixB)).toBe(false);
    expect(reaches(sources.get(a)!, mixB)).toBe(true);
    expect(reaches(sources.get(b)!, mixA)).toBe(false); // the old connection is gone
    expect(m.mixMinusStream('zzz')).toBeNull();
  });

  it('has the guest private mix ready before the guest sound arrives, then takes the sound when it does', () => {
    const { ctx, sources, dests } = makeCtx();
    const m = new HostMixer(ctx);
    const host = stream('host'), a = stream('a');
    m.setHostMic(host);
    m.addGuest('a', null);
    const mixA = dests.find((d) => d.stream === m.mixMinusStream('a'))!;
    expect(reaches(sources.get(host)!, mixA)).toBe(true);
    m.attachSource('a', a);
    expect(reaches(sources.get(a)!, mixA)).toBe(false); // still never their own voice
    m.addGuest('b', null);
    const mixB = dests.find((d) => d.stream === m.mixMinusStream('b'))!;
    expect(reaches(sources.get(a)!, mixB)).toBe(true);
  });
});

describe('program content', () => {
  it('can leave the host out of the program, while guests and the guests\' own mixes still hear the host', () => {
    const { ctx, sources, dests } = makeCtx();
    const m = new HostMixer(ctx);
    const host = stream('host'), a = stream('a');
    m.setHostMic(host); m.addGuest('a', a);
    const program = dests[0]; // the first destination the desk makes is the program
    expect(m.program).toBe(program.stream);
    expect(reaches(sources.get(host)!, program)).toBe(true);
    m.setProgramIncludesHost(false);
    expect(m.programIncludesHost).toBe(false);
    expect(reaches(sources.get(host)!, program)).toBe(false);
    expect(reaches(sources.get(a)!, program)).toBe(true);
    const mixA = dests.find((d) => d.stream === m.mixMinusStream('a'))!;
    expect(reaches(sources.get(host)!, mixA)).toBe(true);
    m.setProgramIncludesHost(true);
    expect(reaches(sources.get(host)!, program)).toBe(true);
  });
});

describe('channel strips', () => {
  it('limits settings to safe ranges and applies them', () => {
    expect(clampStrip({ volume: 9, presence: -40, muted: true })).toEqual({ volume: 2, presence: -6, muted: true });
    expect(clampStrip({ volume: NaN })).toEqual({});
    const { ctx } = makeCtx();
    const m = new HostMixer(ctx);
    m.addGuest('a', stream('a'));
    expect(m.setStrip('a', { volume: 1.5, lowCut: false, compressor: false, muted: true })).toMatchObject({ volume: 1.5, lowCut: false, compressor: false, muted: true });
    expect(m.setStrip('nobody', { volume: 1 })).toBeNull();
  });
  it('reads a level and flags clipping', () => {
    const { ctx } = makeCtx();
    const m = new HostMixer(ctx);
    m.addGuest('a', stream('a'));
    const l = m.level('a');
    expect(l.level).toBeGreaterThan(0.8);
    expect(l.clipping).toBe(false);
    expect(m.level('nobody')).toEqual({ level: 0, clipping: false });
  });
});
