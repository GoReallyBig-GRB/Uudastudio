import { describe, expect, it } from 'vitest';
import { LIMITS, fileKindOf, liveElsewhere, stateOf, timeClash, validateEvent, type LiveEventRow } from './rules';
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
    const v = validateEvent({ kind: 'scheduled', title: 'x'.repeat(500), startsAt: T0 + 1, participants: [{ name: 'Ada', whatsapp: '+234 803 123 4567', email: 'ada@example.com' }, { name: '  ' }] }, T0);
    expect(v.ok && v.value.title.length).toBe(LIMITS.title);
    expect(v.ok && v.value.participants).toEqual([{ name: 'Ada', whatsapp: '2348031234567', email: 'ada@example.com' }]);
  });
  it('keeps WhatsApp and email apart, and reads the old single contact box', () => {
    const v = validateEvent({ kind: 'scheduled', title: 'T', startsAt: T0 + 1, participants: [{ name: 'A', contact: 'a@x.com' }, { name: 'B', contact: '+234 803 111 2222' }] }, T0);
    expect(v.ok && v.value.participants).toEqual([{ name: 'A', whatsapp: '', email: 'a@x.com' }, { name: 'B', whatsapp: '2348031112222', email: '' }]);
  });
  it('refuses a bad email, a short number and a silly duration', () => {
    const base = { kind: 'scheduled', title: 'T', startsAt: T0 + 1 };
    expect(validateEvent({ ...base, participants: [{ name: 'A', email: 'nope' }] }, T0).ok).toBe(false);
    expect(validateEvent({ ...base, participants: [{ name: 'A', whatsapp: '123' }] }, T0).ok).toBe(false);
    expect(validateEvent({ ...base, durationMin: 2 }, T0).ok).toBe(false);
    const ok = validateEvent({ ...base, durationMin: 90 }, T0);
    expect(ok.ok && ok.value.durationMin).toBe(90);
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
    await store.save({ id: 'e1', userId: 'u1', token: 'tok-1234567890abcdef', kind: 'scheduled', mode: 'conversation', title: 'Panel', description: 'About radio', notes: 'Read https://example.com', startsAt: T0 + 3600_000, durationMin: 60, activatedAt: null, endedAt: null, participants: [], hostName: 'Host', createdAt: T0, updatedAt: T0 });
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

describe('two events never share a time', () => {
  const row = (o: Partial<LiveEventRow>): LiveEventRow => ({ id: 'a', userId: 'u', token: 't', kind: 'scheduled', mode: 'conversation', title: 'A', description: '', notes: '', startsAt: 1_000_000, durationMin: 60, activatedAt: null, endedAt: null, participants: [], hostName: 'h', createdAt: 0, updatedAt: 0, ...o });
  const now = 900_000;
  it('refuses a time that overlaps another event, and allows one right after it', () => {
    const a = row({});
    expect(timeClash([a], null, 1_000_000 + 30 * 60_000, 30, now)?.id).toBe('a');
    expect(timeClash([a], null, 1_000_000 + 60 * 60_000, 30, now)).toBeNull();
    expect(timeClash([a], 'a', 1_000_000, 60, now)).toBeNull();
  });
  it('treats an unset length as an hour', () => {
    expect(timeClash([row({ durationMin: null })], null, 1_000_000 + 50 * 60_000, null, now)?.id).toBe('a');
  });
  it('knows when another event is live', () => {
    const live = row({ id: 'b', activatedAt: 800_000 });
    expect(liveElsewhere([live], 'x', now)?.id).toBe('b');
    expect(liveElsewhere([live], 'b', now)).toBeNull();
    expect(liveElsewhere([row({ endedAt: 850_000 })], 'x', now)).toBeNull();
  });
});
