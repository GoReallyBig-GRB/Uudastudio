import { describe, expect, it } from 'vitest';
import { LIMITS, fileKindOf, stateOf, validateEvent } from './rules';
import { MemoryLiveStore } from './store';
import { handleLive, type LiveEnv } from './handler';

const T0 = 1_800_000_000_000;

describe('event rules', () => {
  it('needs a title and a time for a scheduled event, but not for a quick one', () => {
    expect(validateEvent({ kind: 'scheduled', title: '', startsAt: T0 + 1000 }, T0).ok).toBe(false);
    expect(validateEvent({ kind: 'scheduled', title: 'Show' }, T0).ok).toBe(false);
    const q = validateEvent({ kind: 'quick' }, T0);
    expect(q.ok && q.value.title).toBe('Quick event');
    expect(q.ok && q.value.startsAt).toBeNull();
  });
  it('trims long text and keeps only named participants', () => {
    const v = validateEvent({ kind: 'scheduled', title: 'x'.repeat(500), startsAt: T0 + 1, participants: [{ name: 'Ada', contact: '+234' }, { name: '  ' }] }, T0);
    expect(v.ok && v.value.title.length).toBe(LIMITS.title);
    expect(v.ok && v.value.participants).toEqual([{ name: 'Ada', contact: '+234' }]);
  });
  it('waits until the time, opens at the time, and can be opened early or ended', () => {
    const e = { startsAt: T0 + 60_000, activatedAt: null, endedAt: null };
    expect(stateOf(e, T0)).toBe('waiting');
    expect(stateOf(e, T0 + 60_000)).toBe('open');
    expect(stateOf({ ...e, activatedAt: T0 }, T0)).toBe('open');
    expect(stateOf({ ...e, activatedAt: T0, endedAt: T0 + 5 }, T0 + 10)).toBe('ended');
    expect(stateOf(e, T0 + 60_000 + LIMITS.openMs)).toBe('ended');
  });
  it('accepts documents and audio only', () => {
    expect(fileKindOf('Brief.PDF')).toBe('doc');
    expect(fileKindOf('clip.mp3')).toBe('audio');
    expect(fileKindOf('run.exe')).toBeNull();
  });
});

// A stand-in for sign-in: the handler only needs userFor to work, so these tests go through the public guest routes and the rules.
describe('guest routes', () => {
  const store = new MemoryLiveStore();
  const env = { auth: {} as never, store, now: () => T0 } as LiveEnv;
  const seed = async () => {
    await store.save({ id: 'e1', userId: 'u1', token: 'tok-1234567890abcdef', kind: 'scheduled', title: 'Panel', description: 'About radio', notes: 'Read https://example.com', startsAt: T0 + 3600_000, activatedAt: null, endedAt: null, participants: [], hostName: 'Host', createdAt: T0, updatedAt: T0 });
    await store.addFile('e1', { id: 'f1', name: 'brief.pdf', mime: 'application/octet-stream', size: 3, kind: 'doc', data: new Uint8Array([1, 2, 3]) });
  };
  it('shows the details and says the room is not open yet', async () => {
    await seed();
    const r = await handleLive(new Request('https://x/api/live/join/tok-1234567890abcdef'), ['join', 'tok-1234567890abcdef'], env);
    const b = await r.json() as any;
    expect(r.status).toBe(200);
    expect(b.state).toBe('waiting');
    expect(b.notes).toContain('example.com');
    expect(b.files[0].name).toBe('brief.pdf');
    expect(b.userId).toBeUndefined();
  });
  it('opens when the producer opens it', async () => {
    await seed();
    await store.save({ ...(await store.byToken('tok-1234567890abcdef'))!, activatedAt: T0 });
    const r = await handleLive(new Request('https://x/api/live/join/tok-1234567890abcdef'), ['join', 'tok-1234567890abcdef'], env);
    expect((await r.json() as any).state).toBe('open');
  });
  it('downloads a file as an attachment, and refuses unknown links', async () => {
    await seed();
    const ok = await handleLive(new Request('https://x/a'), ['join', 'tok-1234567890abcdef', 'files', 'f1'], env);
    expect(ok.headers.get('content-disposition')).toContain('attachment');
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((await handleLive(new Request('https://x/a'), ['join', 'nope-nope-nope-nope-nope'], env)).status).toBe(404);
    expect((await handleLive(new Request('https://x/a'), ['join', 'short'], env)).status).toBe(404);
  });
});
