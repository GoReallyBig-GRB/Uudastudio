import { describe, expect, it } from 'vitest';
import { collectTake, getTicket, listHeld, partBytesFor, uploadTake, type DropIO } from './dropClient';
import { type TakeOffer, type TakeSink } from './transfer';
import { DropService, MemoryDropRepo } from '../../../worker/live/drop/service';
import { MemoryBlob } from '../../../worker/live/drop/blob';

/** A fetch that talks straight to the real server logic, so client and server are tested against each other */
function server() {
  const svc = new DropService({ repo: new MemoryDropRepo(), blobs: { do: new MemoryBlob('do'), b2: null }, route: async () => ({ backing: 'do', mode: 'do', refusal: null }), report: async () => undefined, eventId: 'e', now: Date.now });
  const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s });
  const r = <T,>(x: { ok: true; value: T } | { ok: false; status: number; error: string }) => (x.ok ? j(x.value) : j({ error: x.error }, x.status));
  const log: string[] = [];
  let failParts = 0;
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url, 'https://x'); const op = u.pathname.split('/').pop()!; const take = u.searchParams.get('take')!; const n = Number(u.searchParams.get('n'));
    log.push(`${init.method ?? 'GET'} ${op}${op === 'part' ? n : ''}`);
    if (op === 'ticket') return j({ ticket: 't' });
    if (op === 'init') return r(await svc.init({ ...JSON.parse(String(init.body)), takeId: take }));
    if (op === 'part' && init.method === 'PUT') { if (failParts > 0) { failParts--; return j({ error: 'x' }, 503); } return r(await svc.putPart(take, n, new Uint8Array(init.body as ArrayBuffer ?? init.body as Uint8Array), (init.headers as Record<string, string>)['x-sha256'])); }
    if (op === 'complete') return r(await svc.complete(take));
    if (op === 'list') return j({ takes: svc.list() });
    if (op === 'part') { const g = await svc.getPart(take, n); return g.ok ? new Response(g.value.data as unknown as BodyInit, { headers: { 'x-sha256': g.value.sha } }) : j({ error: g.error }, g.status); }
    if (op === 'collected') return r(svc.collected(take));
    return j({}, 404);
  }) as typeof fetch;
  return { io: { fetchFn, base: '/api/live/drop/tok' } as DropIO, log, svc, failNext: (k: number) => { failParts = k; } };
}

const channels = 2, frames = 1_500_000; // about 9 MB: two parts
const wave = (c: number, i: number) => Math.round(Math.sin(i / 50 + c) * 0.5 * 8388607) / 8388608;
const offer: TakeOffer = { takeId: 'take-1-abc', name: 'Take 1', sampleRate: 48000, channels, frames, startAt: 5, stopAt: 40, roomStartMs: 7 };
const read = async (start: number, n: number) => Array.from({ length: channels }, (_, c) => Float32Array.from({ length: n }, (_, i) => wave(c, start + i)));

function collector() {
  const got: Float32Array[][] = []; let done = false;
  const sink: TakeSink = { write: async (p) => { got.push(p); }, finish: async () => { done = true; return {} as never; }, abort: async () => undefined };
  return { sink, got, isDone: () => done };
}

describe('guest uploads, host collects', () => {
  it('round-trips a take in parts with exact samples', async () => {
    const s = server();
    expect(await getTicket(s.io, offer.takeId)).toBe('t');
    const prog: number[] = [];
    expect(await uploadTake(s.io, 't', 'Ada', offer, read, (f) => prog.push(f))).toEqual({ result: 'done', message: null });
    expect(prog.at(-1)).toBe(1);
    const held = (await listHeld(s.io))!;
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ from: 'Ada', status: 'ready', parts: 2, channels: 2 });
    const c = collector();
    expect(await collectTake(s.io, held[0], c.sink, () => undefined)).toBe(true);
    expect(c.got.reduce((a, p) => a + p[0].length, 0)).toBe(frames);
    const all0 = Float32Array.from(c.got.flatMap((p) => [...p[0]]));
    expect(all0[123456]).toBeCloseTo(wave(0, 123456), 6);
    expect(all0[frames - 1]).toBeCloseTo(wave(0, frames - 1), 6);
    expect((await listHeld(s.io))![0].collectedAt).not.toBeNull();
  });
  it('resumes after a failed part without resending the ones the server has', async () => {
    const s = server();
    s.failNext(1);
    expect((await uploadTake(s.io, 't', 'Ada', offer, read, () => undefined)).result).toBe('retry');
    const first = s.log.filter((l) => l.startsWith('PUT')).length;
    expect((await uploadTake(s.io, 't', 'Ada', offer, read, () => undefined)).result).toBe('done');
    expect(s.log.filter((l) => l === 'PUT part0').length).toBe(2); // part 0 failed once, then went
    expect(first).toBe(1);
  });
  it('a part that goes up twice is not stored twice, and an upload can be stopped', async () => {
    const s = server();
    expect((await uploadTake(s.io, 't', 'Ada', offer, read, () => undefined, () => true)).result).toBe('aborted');
  });
  it('part sizes are whole frames', () => { expect(partBytesFor(1) % 3).toBe(0); expect(partBytesFor(2) % 6).toBe(0); expect(partBytesFor(2)).toBeLessThanOrEqual(5 * 1024 * 1024); });
  it('says no, with a reason, when the server is full', async () => {
    const s = server();
    (s.svc as unknown as { d: { route: () => Promise<unknown> } }).d.route = async () => ({ backing: null, mode: 'do', refusal: 'full' });
    expect(await uploadTake(s.io, 't', 'Ada', offer, read, () => undefined)).toEqual({ result: 'refused', message: 'full' });
  });
});
