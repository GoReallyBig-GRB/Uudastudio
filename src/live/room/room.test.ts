import { describe, expect, it } from 'vitest';
import { RoomClock, estimateOffset } from './clockSync';
import { applyServerMessage, initialView } from './roomState';
import { RoomClient, backoffMs } from './roomClient';

describe('clock sync', () => {
  it('trusts the fastest round trip', () => {
    // Server is 5000 ms ahead. The slow sample is lopsided and would be wrong; the fast one is close.
    const e = estimateOffset([
      { sentAt: 1000, receivedAt: 1400, serverAt: 6350 },
      { sentAt: 2000, receivedAt: 2020, serverAt: 7010 },
    ]);
    expect(e?.errorMs).toBe(10);
    expect(e?.offsetMs).toBe(5000);
  });
  it('has no answer without samples and ignores impossible ones', () => {
    expect(estimateOffset([])).toBeNull();
    expect(estimateOffset([{ sentAt: 5, receivedAt: 1, serverAt: 0 }])).toBeNull();
  });
  it('converts between device time and room time both ways', () => {
    const c = new RoomClock();
    expect(c.ready).toBe(false);
    c.add({ sentAt: 100, receivedAt: 120, serverAt: 1110 }); // offset 1000
    expect(c.ready).toBe(true);
    expect(c.roomNow(500)).toBe(1500);
    expect(c.toLocal(4000)).toBe(3000);
  });
});

describe('room view', () => {
  it('builds the roster and follows admissions, mutes and recording', () => {
    let v = applyServerMessage(initialView(), { t: 'welcome', id: 'me', role: 'guest', admitted: false, now: 1, autoAdmit: false, take: null, endedAt: null, peers: [{ id: 'p', role: 'producer', name: 'Ada', admitted: true, muted: false, recording: false }] });
    expect(v.connected).toBe(true);
    expect(v.me).toEqual({ id: 'me', role: 'guest', admitted: false });
    v = applyServerMessage(v, { t: 'peer', id: 'me', admitted: true });
    expect(v.me?.admitted).toBe(true);
    v = applyServerMessage(v, { t: 'joined', peer: { id: 'g2', role: 'guest', name: 'Chi', admitted: false, muted: false, recording: false } });
    v = applyServerMessage(v, { t: 'peer', id: 'g2', muted: true });
    expect(v.peers.find((p) => p.id === 'g2')?.muted).toBe(true);
    v = applyServerMessage(v, { t: 'left', id: 'g2' });
    expect(v.peers.map((p) => p.id)).toEqual(['p']);
  });
  it('follows a take from record to stop, with markers and an end', () => {
    let v = applyServerMessage(initialView(), { t: 'record', take: 'take-1', startAt: 5000, n: 1 });
    expect(v.take).toEqual({ id: 'take-1', startAt: 5000, stopAt: null });
    v = applyServerMessage(v, { t: 'marker', take: 'take-1', at: 6000, n: 1 });
    expect(v.markers).toHaveLength(1);
    v = applyServerMessage(v, { t: 'stop', take: 'take-1', stopAt: 9000 });
    expect(v.take?.stopAt).toBe(9000);
    v = applyServerMessage(applyServerMessage(v, { t: 'record', take: 'take-2', startAt: 12000, n: 2 }), { t: 'ended', at: 15000, stopAt: 15000, take: 'take-2' });
    expect(v.endedAt).toBe(15000);
    expect(v.take?.stopAt).toBe(15000);
    expect(v.markers).toEqual([]);
  });
  it('keeps cues, removals and errors', () => {
    let v = applyServerMessage(initialView(), { t: 'cue', text: 'again from the top', at: 1 });
    expect(v.cue?.text).toBe('again from the top');
    v = applyServerMessage(v, { t: 'removed' });
    expect(v.closedReason).toMatch(/removed/);
    expect(applyServerMessage(v, { t: 'error', message: 'No.' }).error).toBe('No.');
  });
});

class FakeSocket {
  readyState = 0; sent: string[] = [];
  onopen: (() => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null; onclose: ((e: { code: number }) => void) | null = null;
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  say(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
  drop(code: number) { this.readyState = 3; this.onclose?.({ code }); }
}

describe('room connection', () => {
  const make = () => {
    const sockets: FakeSocket[] = []; const urls: string[] = []; const timeouts: Array<() => void> = [];
    const views: unknown[] = [];
    const c = new RoomClient({
      token: 'tok12345', name: 'Chi N', origin: 'https://uuda.test',
      onView: (v) => views.push(v),
      open: (u) => { urls.push(u); const s = new FakeSocket(); sockets.push(s); return s as unknown as WebSocket; },
      timers: { setTimeout: ((f: () => void) => { timeouts.push(f); return 1; }) as unknown as typeof setTimeout, clearTimeout: (() => undefined) as unknown as typeof clearTimeout, setInterval: (() => 1) as unknown as typeof setInterval, clearInterval: (() => undefined) as unknown as typeof clearInterval },
    });
    return { c, sockets, urls, timeouts };
  };
  it('connects to the right address with the guest name, asks for the time, and reads the welcome', () => {
    const { c, sockets, urls } = make();
    c.connect();
    expect(urls[0]).toBe('wss://uuda.test/api/live/room/tok12345?name=Chi%20N');
    sockets[0].open();
    const ask = JSON.parse(sockets[0].sent[0]);
    expect(ask.t).toBe('sync');
    sockets[0].say({ t: 'sync', c: ask.c, s: ask.c + 5000 });
    expect(c.clock.ready).toBe(true);
    sockets[0].say({ t: 'welcome', id: 'me', role: 'guest', admitted: false, now: 1, autoAdmit: false, take: null, endedAt: null, peers: [] });
    expect(c.state.me?.id).toBe('me');
  });
  it('reconnects after a drop, but not after being removed or replaced', () => {
    const { c, sockets, timeouts } = make();
    c.connect(); sockets[0].open();
    sockets[0].drop(1006);
    expect(c.state.connected).toBe(false);
    expect(timeouts).toHaveLength(1);
    timeouts[0](); // the retry runs
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    sockets[1].say({ t: 'removed' });
    sockets[1].drop(4002);
    expect(timeouts).toHaveLength(1); // no new retry
    expect(c.state.closedReason).toMatch(/removed/);
  });
  it('backs off 1, 2, 4, 8 then 10 seconds', () => {
    expect([0, 1, 2, 3, 4, 9].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 10000, 10000]);
  });
  it('does not send while the socket is not open', () => {
    const { c, sockets } = make();
    c.connect();
    expect(c.send({ t: 'marker' })).toBe(false);
    sockets[0].open();
    expect(c.send({ t: 'marker' })).toBe(true);
  });
});
