import { describe, expect, it } from 'vitest';
import { MemoryBlob } from './blob';
import { FULL_MESSAGE, KEEP_AFTER_COLLECTED_MS, KEEP_IF_NOT_COLLECTED_MS, PART_BYTES, type Route } from './plan';
import { DropService, MemoryDropRepo, type InitInput } from './service';

const sha = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer))].map((x) => x.toString(16).padStart(2, '0')).join('');
const frames = 2_000_000; // 6 MB of mono 24-bit: two parts
const input = (id = 'take-1-a'): InitInput => ({ takeId: id, from: 'Ada', name: 'Take 1', bytes: frames * 3, frames, sampleRate: 48000, channels: 1, startAt: 10, stopAt: 99, roomStartMs: 12 });
const payload = (n: number, size: number) => Uint8Array.from({ length: size }, (_, i) => (i * 7 + n) & 255);

function rig(route: Route = { backing: 'do', mode: 'do', refusal: null }) {
  let now = 1_000_000;
  const doBlob = new MemoryBlob('do'), b2 = new MemoryBlob('b2');
  const reports: Array<[string, string, number]> = [];
  const svc = new DropService({ repo: new MemoryDropRepo(), blobs: { do: doBlob, b2 }, route: async () => route, report: async (b, k, n) => { reports.push([b, k, n]); }, eventId: 'ev', now: () => now });
  return { svc, doBlob, b2, reports, tick: (ms: number) => { now += ms; } };
}
async function upload(r: ReturnType<typeof rig>, id = 'take-1-a') {
  const total = frames * 3;
  const parts = [payload(0, PART_BYTES), payload(1, total - PART_BYTES)];
  for (let n = 0; n < parts.length; n++) { const res = await r.svc.putPart(id, n, parts[n], await sha(parts[n])); expect(res.ok).toBe(true); }
  return parts;
}

describe('holding a take for the host', () => {
  it('takes a take in parts, finishes it and gives the same bytes back', async () => {
    const r = rig();
    const init = await r.svc.init(input());
    expect(init).toMatchObject({ ok: true, value: { parts: 2, received: [], ready: false } });
    const parts = await upload(r);
    expect(await r.svc.complete('take-1-a')).toMatchObject({ ok: true });
    for (let n = 0; n < 2; n++) {
      const got = await r.svc.getPart('take-1-a', n);
      expect(got.ok && Array.from(got.value.data.slice(0, 50))).toEqual(Array.from(parts[n].slice(0, 50)));
      expect(got.ok && got.value.data.length).toBe(parts[n].length);
    }
    expect(r.doBlob.bytes()).toBe(frames * 3);
    expect(r.reports.at(-1)).toEqual(['do', 'ev/take-1-a', frames * 3]);
  });
  it('resumes: a repeat start says which parts it already has', async () => {
    const r = rig();
    await r.svc.init(input());
    await r.svc.putPart('take-1-a', 0, payload(0, PART_BYTES), await sha(payload(0, PART_BYTES)));
    expect(await r.svc.init(input())).toMatchObject({ ok: true, value: { received: [0], ready: false } });
    expect(await r.svc.complete('take-1-a')).toMatchObject({ ok: false, status: 409 });
  });
  it('refuses a damaged or wrongly sized part, and a take that does not add up', async () => {
    const r = rig();
    await r.svc.init(input());
    expect(await r.svc.putPart('take-1-a', 0, payload(0, PART_BYTES), 'bad')).toMatchObject({ ok: false, status: 422 });
    expect(await r.svc.putPart('take-1-a', 0, payload(0, 100), await sha(payload(0, 100)))).toMatchObject({ ok: false, status: 422 });
    expect(await r.svc.putPart('take-1-a', 5, payload(0, 100), 'x')).toMatchObject({ ok: false, status: 400 });
    expect(await r.svc.init({ ...input('take-2-a'), bytes: 10 })).toMatchObject({ ok: false, status: 400 });
    expect(await r.svc.init({ ...input(), frames: frames + 1, bytes: (frames + 1) * 3 })).toMatchObject({ ok: false, status: 409 });
  });
  it('sends a take to B2 when the router says so, and refuses clearly when there is no room', async () => {
    const r = rig({ backing: 'b2', mode: 'b2', refusal: null });
    await r.svc.init(input());
    await upload(r);
    await r.svc.complete('take-1-a');
    expect(r.b2.bytes()).toBe(frames * 3);
    expect(r.doBlob.bytes()).toBe(0);
    expect(r.b2.completed.has('ev/take-1-a')).toBe(true);
    const full = rig({ backing: null, mode: 'do', refusal: FULL_MESSAGE });
    expect(await full.svc.init(input())).toMatchObject({ ok: false, status: 507, error: FULL_MESSAGE });
  });
  it('lists takes for the host and deletes 24 hours after collection', async () => {
    const r = rig();
    await r.svc.init(input()); await upload(r); await r.svc.complete('take-1-a');
    expect(r.svc.list()).toEqual([expect.objectContaining({ takeId: 'take-1-a', from: 'Ada', status: 'ready', parts: 2, received: 2, collectedAt: null })]);
    expect(await r.svc.sweep()).toBe(1_000_000 + KEEP_IF_NOT_COLLECTED_MS);
    const c = r.svc.collected('take-1-a');
    expect(c).toMatchObject({ ok: true, value: { deleteAt: 1_000_000 + KEEP_AFTER_COLLECTED_MS } });
    r.tick(KEEP_AFTER_COLLECTED_MS - 1);
    expect(await r.svc.sweep()).toBe(1_000_000 + KEEP_AFTER_COLLECTED_MS);
    expect(r.doBlob.bytes()).toBeGreaterThan(0);
    r.tick(2);
    expect(await r.svc.sweep()).toBeNull();
    expect(r.doBlob.bytes()).toBe(0);
    expect(r.svc.list()).toEqual([]);
    expect(r.reports.at(-1)).toEqual(['do', 'ev/take-1-a', 0]);
  });
  it('deletes an uncollected take after 7 days', async () => {
    const r = rig();
    await r.svc.init(input()); await upload(r); await r.svc.complete('take-1-a');
    r.tick(KEEP_IF_NOT_COLLECTED_MS + 1);
    expect(await r.svc.sweep()).toBeNull();
    expect(r.svc.list()).toEqual([]);
  });
  it('will not give out a take that is not finished', async () => {
    const r = rig();
    await r.svc.init(input());
    expect(await r.svc.getPart('take-1-a', 0)).toMatchObject({ ok: false, status: 404 });
    expect(r.svc.collected('take-1-a')).toMatchObject({ ok: false, status: 404 });
  });
});
