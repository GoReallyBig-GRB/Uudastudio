import { describe, expect, it } from 'vitest';
import { ROOM, decideJoin, freshMeta, parseClientMessage, step, type Peer, type RoomMeta } from './room';

const peer = (id: string, role: 'producer' | 'guest', admitted = true): Peer => ({ id, role, name: id, admitted, muted: false, recording: false, joinedAt: 0 });
const prod = peer('p', 'producer');
const rnd = () => 'x';
const run = (meta: RoomMeta, peers: Peer[], from: Peer, raw: unknown, now = 1000) => {
  const msg = parseClientMessage(JSON.stringify(raw));
  if (!msg) throw new Error('did not parse');
  return step(meta, peers, from, msg, now, rnd);
};

describe('parsing', () => {
  it('rejects junk, oversized and malformed messages', () => {
    expect(parseClientMessage('nope')).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'bogus' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'signal', to: 'a', data: 'x'.repeat(ROOM.signalBytes + 1) }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'cue', to: 'all', text: '   ' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'sync', c: 'x' }))).toBeNull();
  });
  it('trims and limits text', () => {
    const m = parseClientMessage(JSON.stringify({ t: 'cue', to: 'all', text: ` ${'a'.repeat(900)} ` }));
    expect(m && m.t === 'cue' && m.text.length).toBe(ROOM.text);
  });
});

describe('joining', () => {
  it('lets the producer straight in and puts guests in the waiting room', () => {
    expect(decideJoin([], 'producer', freshMeta())).toEqual({ ok: true, admitted: true });
    expect(decideJoin([prod], 'guest', freshMeta())).toEqual({ ok: true, admitted: false });
  });
  it('auto-admit seats guests until the call has 4 people, then they wait', () => {
    const meta = { ...freshMeta(), autoAdmit: true };
    const three = [prod, ...['a', 'b'].map((i) => peer(i, 'guest'))];
    expect(decideJoin(three, 'guest', meta).admitted).toBe(true);
    const four = [...three, peer('c', 'guest')];
    expect(decideJoin(four, 'guest', meta)).toEqual({ ok: true, admitted: false });
  });
  it('refuses when the waiting room is full or the session ended', () => {
    const waiting = Array.from({ length: ROOM.waiting }, (_, i) => peer(`w${i}`, 'guest', false));
    expect(decideJoin([prod, ...waiting], 'guest', freshMeta()).ok).toBe(false);
    expect(decideJoin([prod], 'guest', { ...freshMeta(), endedAt: 5 }, 5 + ROOM.deliveryMs + 1).error).toMatch(/ended/);
    // shortly after the end guests may reconnect to hand over their recordings
    expect(decideJoin([prod], 'guest', { ...freshMeta(), endedAt: 5 }, 60_000)).toEqual({ ok: true, admitted: true });
  });
});

describe('who may do what', () => {
  const guest = peer('g', 'guest');
  it('only the producer can admit, remove, cue, record, stop, mark or end', () => {
    for (const raw of [{ t: 'admit', id: 'p' }, { t: 'remove', id: 'p' }, { t: 'cue', to: 'all', text: 'hi' }, { t: 'auto', on: true }, { t: 'record' }, { t: 'stop' }, { t: 'marker' }, { t: 'end' }]) {
      const r = run(freshMeta(), [prod, guest], guest, raw);
      expect(r.out[0]?.msg.t).toBe('error');
      expect(r.meta).toEqual(freshMeta());
      expect(r.kick).toEqual([]);
    }
  });
  it('admits a waiting guest, and refuses when the call is full', () => {
    const w = peer('w', 'guest', false);
    const ok = run(freshMeta(), [prod, w], prod, { t: 'admit', id: 'w' });
    expect(ok.peers.w).toEqual({ admitted: true });
    const full = [prod, ...['a', 'b', 'c'].map((i) => peer(i, 'guest')), w];
    expect(run(freshMeta(), full, prod, { t: 'admit', id: 'w' }).out[0].msg.t).toBe('error');
  });
  it('auto-admit seats the waiting guests that fit', () => {
    const w1 = peer('w1', 'guest', false), w2 = peer('w2', 'guest', false);
    const r = run(freshMeta(), [prod, w1, w2], prod, { t: 'auto', on: true });
    expect(r.meta.autoAdmit).toBe(true);
    expect(Object.keys(r.peers).sort()).toEqual(['w1', 'w2']);
  });
});

describe('call signalling', () => {
  it('passes messages only between people who are in the call', () => {
    const a = peer('a', 'guest'), w = peer('w', 'guest', false);
    const good = run(freshMeta(), [prod, a, w], a, { t: 'signal', to: 'p', data: { sdp: 'x' } });
    expect(good.out).toEqual([{ to: 'p', msg: { t: 'signal', from: 'a', data: { sdp: 'x' } } }]);
    expect(run(freshMeta(), [prod, a, w], a, { t: 'signal', to: 'w', data: 1 }).out[0].msg.t).toBe('error');
    expect(run(freshMeta(), [prod, a, w], w, { t: 'signal', to: 'a', data: 1 }).out[0].msg.t).toBe('error');
    expect(run(freshMeta(), [prod, a], a, { t: 'signal', to: 'nobody', data: 1 }).out[0].msg.t).toBe('error');
  });
});

describe('recording', () => {
  it('starts every device together, a lead time ahead, and not twice', () => {
    const r = run(freshMeta(), [prod], prod, { t: 'record' }, 10_000);
    expect(r.meta.take).toEqual({ id: 'take-1-x', startAt: 13_000, stopAt: null });
    expect(r.out[0]).toEqual({ to: 'all', msg: { t: 'record', take: 'take-1-x', startAt: 13_000, n: 1 } });
    expect(run(r.meta, [prod], prod, { t: 'record' }).out[0].msg.t).toBe('error');
  });
  it('keeps the lead time between 2 and 15 seconds', () => {
    expect(run(freshMeta(), [prod], prod, { t: 'record', leadMs: 1 }, 0).meta.take?.startAt).toBe(ROOM.minLeadMs);
    expect(run(freshMeta(), [prod], prod, { t: 'record', leadMs: 999999 }, 0).meta.take?.startAt).toBe(ROOM.maxLeadMs);
  });
  it('stops, drops markers while recording, numbers them, and a new take starts them again', () => {
    const started = run(freshMeta(), [prod], prod, { t: 'record' }, 0).meta;
    expect(run(started, [prod], prod, { t: 'marker' }, 1000).out[0].msg.t).toBe('error'); // before the start time
    const m1 = run(started, [prod], prod, { t: 'marker' }, 4000);
    expect(m1.out[0].msg).toMatchObject({ t: 'marker', n: 1, at: 4000 });
    const m2 = run(m1.meta, [prod], prod, { t: 'marker' }, 5000);
    expect(m2.out[0].msg).toMatchObject({ n: 2 });
    const stopped = run(m2.meta, [prod], prod, { t: 'stop' }, 9000);
    expect(stopped.out[0].msg).toMatchObject({ t: 'stop', stopAt: 9000 });
    expect(run(stopped.meta, [prod], prod, { t: 'marker' }, 9500).out[0].msg.t).toBe('error');
    expect(run(stopped.meta, [prod], prod, { t: 'stop' }).out[0].msg.t).toBe('error');
    const again = run(stopped.meta, [prod], prod, { t: 'record' }, 20_000);
    expect(again.meta.take?.id).toBe('take-2-x');
    expect(again.meta.markers).toBe(0);
  });
  it('ending the session stops a running take and then refuses everything', () => {
    const started = run(freshMeta(), [prod], prod, { t: 'record' }, 0).meta;
    const ended = run(started, [prod], prod, { t: 'end' }, 8000);
    expect(ended.meta.endedAt).toBe(8000);
    expect(ended.out[0].msg).toMatchObject({ t: 'ended', stopAt: 8000 });
    expect(run(ended.meta, [prod], prod, { t: 'record' }).out[0].msg.t).toBe('error');
    // recordings can still be handed over after the end
    const a = peer('a', 'guest', false);
    expect(run(ended.meta, [prod, a], a, { t: 'signal', to: 'p', data: 1 }).out[0].msg.t).toBe('signal');
  });
});

describe('clock sync and status', () => {
  it('answers a sync with the server time', () => {
    const r = run(freshMeta(), [prod], prod, { t: 'sync', c: 42 }, 777);
    expect(r.out).toEqual([{ to: 'p', msg: { t: 'sync', c: 42, s: 777 } }]);
  });
  it('tells everyone when someone mutes', () => {
    const g = peer('g', 'guest');
    const r = run(freshMeta(), [prod, g], g, { t: 'state', muted: true });
    expect(r.peers.g).toEqual({ muted: true });
    expect(r.out[0]).toEqual({ to: 'all', msg: { t: 'peer', id: 'g', muted: true } });
  });
});

import { roomAccess } from './roomEntry';
import type { LiveEventRow } from './rules';

describe('who may enter the room', () => {
  const ev = (o: Partial<LiveEventRow> = {}): LiveEventRow => ({ id: 'e', userId: 'owner', token: 'tok', kind: 'quick', title: 't', description: '', notes: '', startsAt: null, durationMin: null, activatedAt: 1000, endedAt: null, participants: [], hostName: 'h', createdAt: 0, updatedAt: 0, ...o });
  it('has no room for an unknown link', () => { expect(roomAccess(null, 5, null, '', 'x')).toMatchObject({ ok: false, status: 404 }); });
  it('makes the signed-in owner the producer, and anyone else a named guest', () => {
    expect(roomAccess(ev(), 5000, 'owner', 'Ada', '')).toEqual({ ok: true, role: 'producer', name: 'Ada', openedAt: 1000 });
    expect(roomAccess(ev(), 5000, 'someone-else', 'Bob', 'Chi')).toEqual({ ok: true, role: 'guest', name: 'Chi', openedAt: 1000 });
    expect(roomAccess(ev(), 5000, null, '', '  ')).toMatchObject({ ok: false, status: 400 });
  });
  it('keeps guests out until the event is open, but lets the producer prepare', () => {
    const waiting = ev({ kind: 'scheduled', startsAt: 10_000_000, activatedAt: null });
    expect(roomAccess(waiting, 5000, null, '', 'Chi')).toMatchObject({ ok: false, status: 425 });
  });
  it('lets people back in for a while after the end to hand over recordings, then closes', () => {
    const ended = ev({ endedAt: 100_000 });
    expect(roomAccess(ended, 100_000 + 3600_000, null, '', 'Chi').ok).toBe(true);
    expect(roomAccess(ended, 100_000 + ROOM.deliveryMs + 1, null, '', 'Chi')).toMatchObject({ ok: false, status: 410 });
  });
});

import { clockStep } from './room';
import { limitSchedule } from './plan';

describe('the 3-hour session clock', () => {
  const opened = 1_000_000; const s = limitSchedule(opened);
  const meta = { ...freshMeta(), openedAt: opened };
  it('waits, warns 15 minutes before, says time is up, then ends the room', () => {
    expect(clockStep(meta, opened + 60_000)).toMatchObject({ out: [], nextAt: s.warnAt });
    const soon = clockStep(meta, s.warnAt);
    expect(soon.out[0].msg).toMatchObject({ t: 'limit', phase: 'soon', limitAt: s.limitAt });
    expect(soon.nextAt).toBe(s.limitAt);
    expect(clockStep(soon.meta, s.warnAt + 1000).out).toEqual([]); // not repeated
    const over = clockStep(soon.meta, s.limitAt);
    expect(over.out[0].msg).toMatchObject({ phase: 'over', hardAt: s.hardAt });
    const end = clockStep(over.meta, s.hardAt);
    expect(end.meta.endedAt).toBe(s.hardAt);
    expect(end.out[0].msg).toMatchObject({ t: 'ended', reason: 'time' });
    expect(end.nextAt).toBeNull();
  });
  it('stops a running take when time runs out, and does nothing before the room knows its start', () => {
    const rec = { ...meta, take: { id: 't', startAt: opened + 1000, stopAt: null } };
    expect(clockStep(rec, s.hardAt).meta.take?.stopAt).toBe(s.hardAt);
    expect(clockStep(freshMeta(), 9e15).out).toEqual([]);
  });
  it('refuses a new take once time is up, and tells the host the limit is 3 hours', () => {
    const r = step(meta, [prod], prod, { t: 'record' }, s.limitAt + 1, rnd);
    expect(r.out[0].msg).toMatchObject({ t: 'error', message: expect.stringMatching(/3-hour/) });
    expect(step(meta, [prod], prod, { t: 'record' }, s.limitAt - 1, rnd).out[0].msg.t).toBe('record');
  });
  it('limits a room to 4 people', () => { expect(ROOM.admitted).toBe(4); });
});
