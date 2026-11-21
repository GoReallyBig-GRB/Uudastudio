import { describe, expect, it } from 'vitest';
import { RoomHost, type HostSocket, type HostState } from './roomHost';

class Sock implements HostSocket {
  att: unknown = null; got: Array<Record<string, unknown>> = []; closedWith: number | null = null;
  send(d: string) { this.got.push(JSON.parse(d)); }
  close(code?: number) { this.closedWith = code ?? 1000; }
  serializeAttachment(v: unknown) { this.att = JSON.parse(JSON.stringify(v)); }
  deserializeAttachment() { return this.att; }
  last(t: string) { return [...this.got].reverse().find((m) => m.t === t); }
}
const setup = () => {
  const socks: Sock[] = []; const store = new Map<string, unknown>(); const alarms: number[] = []; let n = 0;
  const state: HostState = { getWebSockets: () => socks.filter((s) => s.closedWith === null), acceptWebSocket: (s) => { socks.push(s as Sock); }, storage: { get: async <T,>(k: string) => store.get(k) as T | undefined, put: async (k, v) => { store.set(k, v); }, setAlarm: async (at) => { alarms.push(at); } } };
  const host = new RoomHost(state, () => ({ client: new Sock(), server: new Sock() }), () => `id${++n}`);
  const join = async (role: 'producer' | 'guest', name: string, now = 1000, openedAt: number | null = null, key = '') => { await host.connect(role, name, now, openedAt, 'conversation', key); return socks[socks.length - 1]; };
  return { host, join, socks, alarms };
};

describe('room host', () => {
  it('welcomes the producer, puts a guest in the waiting room and tells the producer', async () => {
    const { join } = setup();
    const p = await join('producer', 'Ada');
    expect(p.last('welcome')).toMatchObject({ role: 'producer', admitted: true, peers: [] });
    const g = await join('guest', 'Chi');
    expect(g.last('welcome')).toMatchObject({ role: 'guest', admitted: false });
    expect((g.last('welcome')!.peers as unknown[])).toHaveLength(1);
    expect(p.last('joined')).toMatchObject({ peer: { name: 'Chi', admitted: false } });
  });
  it('admits on the producer\'s word and then lets the two exchange call signalling', async () => {
    const { host, join } = setup();
    const p = await join('producer', 'Ada'); const g = await join('guest', 'Chi');
    const gid = (g.att as { id: string }).id; const pid = (p.att as { id: string }).id;
    await host.message(g, JSON.stringify({ t: 'signal', to: pid, data: { sdp: 1 } }), 2000);
    expect(g.last('error')).toBeTruthy(); // not admitted yet
    await host.message(p, JSON.stringify({ t: 'admit', id: gid }), 2100);
    expect((g.att as { admitted: boolean }).admitted).toBe(true);
    expect(g.last('peer')).toMatchObject({ id: gid, admitted: true });
    await host.message(g, JSON.stringify({ t: 'signal', to: pid, data: { sdp: 1 } }), 2200);
    expect(p.last('signal')).toMatchObject({ from: gid, data: { sdp: 1 } });
  });
  it('sends record only to people in the call, and remembers the take across sleep', async () => {
    const { host, join, socks } = setup();
    const p = await join('producer', 'Ada'); const a = await join('guest', 'In'); const w = await join('guest', 'Waiting');
    await host.message(p, JSON.stringify({ t: 'admit', id: (a.att as { id: string }).id }), 2000);
    await host.message(p, JSON.stringify({ t: 'record', leadMs: 3000 }), 5000);
    expect(a.last('record')).toMatchObject({ startAt: 8000 });
    expect(p.last('record')).toMatchObject({ startAt: 8000 });
    expect(w.last('record')).toBeUndefined();
    // a new host over the same storage and sockets (the object woke up again) still knows about the take
    const late = await host.connect('guest', 'Late', 6000);
    void late;
    expect(socks[socks.length - 1].last('welcome')).toMatchObject({ take: { startAt: 8000, stopAt: null } });
  });
  it('removes a guest and tells the rest when someone leaves', async () => {
    const { host, join } = setup();
    const p = await join('producer', 'Ada'); const g = await join('guest', 'Chi');
    await host.message(p, JSON.stringify({ t: 'remove', id: (g.att as { id: string }).id }), 2000);
    expect(g.last('removed')).toBeTruthy();
    expect(g.closedWith).toBe(4002);
    const g2 = await join('guest', 'Dee');
    host.closed(g2, 1001);
    expect(p.last('left')).toMatchObject({ id: (g2.att as { id: string }).id });
  });
  it('lets a new producer connection take over without announcing a departure', async () => {
    const { host, join } = setup();
    const p1 = await join('producer', 'Ada'); const g = await join('guest', 'Chi');
    await join('producer', 'Ada');
    expect(p1.closedWith).toBe(4001);
    host.closed(p1, 4001);
    expect(g.last('left')).toBeUndefined();
  });
  it('refuses guests when the waiting room is full and rejects unreadable messages', async () => {
    const { host, join } = setup();
    const p = await join('producer', 'Ada');
    for (let i = 0; i < 8; i++) await join('guest', `w${i}`);
    const extra = await join('guest', 'Nine');
    expect(extra.closedWith).toBe(4003);
    expect(extra.last('error')).toBeTruthy();
    await host.message(p, 'not json', 2000);
    expect(p.last('error')).toMatchObject({ message: expect.stringMatching(/not understood/) });
  });
  it('starts the session clock with the first connection and rings the warning, the limit and the end', async () => {
    const { host, join, alarms } = setup();
    const opened = 5_000_000;
    const p = await join('producer', 'Ada', opened + 1000, opened);
    expect(alarms[0]).toBe(opened + 165 * 60_000);
    expect(p.last('welcome')).toMatchObject({ limit: { phase: 'none', limitAt: opened + 180 * 60_000 } });
    await host.alarm(opened + 165 * 60_000);
    expect(p.last('limit')).toMatchObject({ phase: 'soon' });
    expect(alarms[1]).toBe(opened + 180 * 60_000);
    await host.alarm(opened + 180 * 60_000);
    expect(p.last('limit')).toMatchObject({ phase: 'over' });
    await host.alarm(opened + 190 * 60_000);
    expect(p.last('ended')).toMatchObject({ reason: 'time' });
  });

  describe('rejoining and removal', () => {
    const KEY_A = 'aaaaaaaaaaaaaaaaaaaaaa';
    const KEY_B = 'bbbbbbbbbbbbbbbbbbbbbb';
    it('gives a guest who reconnects the same identity and the place they already had', async () => {
      const { host, join } = setup();
      const p = await join('producer', 'Ada'); const g = await join('guest', 'Chi', 1000, null, KEY_A);
      const gid = (g.att as { id: string }).id;
      await host.message(p, JSON.stringify({ t: 'admit', id: gid }), 2000);
      host.closed(g, 1006); // the network blipped
      expect(p.last('left')).toMatchObject({ id: gid });
      const g2 = await join('guest', 'Chi', 3000, null, KEY_A);
      expect((g2.att as { id: string; admitted: boolean })).toMatchObject({ id: gid, admitted: true });
      expect(g2.last('welcome')).toMatchObject({ id: gid, admitted: true });
      expect(p.last('joined')).toMatchObject({ peer: { id: gid, admitted: true } });
    });
    it('never sends the rejoin key or its hash to anyone', async () => {
      const { join } = setup();
      const p = await join('producer', 'Ada'); const g = await join('guest', 'Chi', 1000, null, KEY_A);
      expect(JSON.stringify(p.got)).not.toContain(KEY_A);
      expect(JSON.stringify(p.got)).not.toContain((g.att as { rk: string }).rk);
    });
    it('replaces the old connection when the same browser comes back before the drop is noticed', async () => {
      const { host, join } = setup();
      const p = await join('producer', 'Ada'); const g = await join('guest', 'Chi', 1000, null, KEY_A);
      await host.message(p, JSON.stringify({ t: 'admit', id: (g.att as { id: string }).id }), 2000);
      const g2 = await join('guest', 'Chi', 3000, null, KEY_A);
      expect(g.closedWith).toBe(4001);
      expect((g2.att as { id: string }).id).toBe((g.att as { id: string }).id);
    });
    it('treats a different browser as a different person', async () => {
      const { join } = setup();
      await join('producer', 'Ada'); const a = await join('guest', 'Chi', 1000, null, KEY_A); const b = await join('guest', 'Chi', 1000, null, KEY_B);
      expect((a.att as { id: string }).id).not.toBe((b.att as { id: string }).id);
    });
    it('keeps a removed guest out, in a new tab too, until the producer invites them back', async () => {
      const { host, join } = setup();
      const p = await join('producer', 'Ada'); const g = await join('guest', 'Chi', 1000, null, KEY_A);
      const gid = (g.att as { id: string }).id;
      await host.message(p, JSON.stringify({ t: 'remove', id: gid }), 2000);
      expect(p.last('barred')).toMatchObject({ list: [{ id: gid, name: 'Chi' }] });
      const again = await join('guest', 'Chi', 3000, null, KEY_A);
      expect(again.closedWith).toBe(4003);
      expect(again.last('error')).toMatchObject({ message: expect.stringMatching(/removed you/) });
      await host.message(p, JSON.stringify({ t: 'reinvite', id: gid }), 4000);
      expect(p.last('barred')).toMatchObject({ list: [] });
      const back = await join('guest', 'Chi', 5000, null, KEY_A);
      expect(back.closedWith).toBeNull();
      expect((back.att as { admitted: boolean }).admitted).toBe(true); // invited back means no second wait
    });
    it('lists the removed to the producer only, and only the producer can invite back', async () => {
      const { host, join } = setup();
      const p = await join('producer', 'Ada'); const g = await join('guest', 'Chi', 1000, null, KEY_A); const o = await join('guest', 'Dee', 1000, null, KEY_B);
      await host.message(p, JSON.stringify({ t: 'remove', id: (g.att as { id: string }).id }), 2000);
      expect(o.last('barred')).toBeUndefined();
      await host.message(o, JSON.stringify({ t: 'reinvite', id: (g.att as { id: string }).id }), 2100);
      expect(o.last('error')).toMatchObject({ message: expect.stringMatching(/Only the producer/) });
    });
    it('turns auto-admit off when someone is removed, so a new arrival waits for the producer', async () => {
      const { host, join } = setup();
      const p = await join('producer', 'Ada');
      await host.message(p, JSON.stringify({ t: 'auto', on: true }), 1500);
      const g = await join('guest', 'Chi', 1600, null, KEY_A);
      expect((g.att as { admitted: boolean }).admitted).toBe(true);
      await host.message(p, JSON.stringify({ t: 'remove', id: (g.att as { id: string }).id }), 2000);
      expect(p.last('auto')).toMatchObject({ on: false });
      const other = await join('guest', 'Dee', 2100, null, KEY_B);
      expect((other.att as { admitted: boolean }).admitted).toBe(false);
    });
    it('ignores a rejoin key that is not well formed', async () => {
      const { join } = setup();
      await join('producer', 'Ada');
      const g = await join('guest', 'Chi', 1000, null, 'short');
      expect((g.att as { rk?: string }).rk).toBeUndefined();
    });
  });

  describe('floods', () => {
    it('drops messages sent faster than the limit and disconnects a client that keeps going', async () => {
      const { host, join } = setup();
      const p = await join('producer', 'Ada');
      for (let i = 0; i < 400; i++) await host.message(p, JSON.stringify({ t: 'state', muted: i % 2 === 0 }), 5000);
      expect(p.last('error')).toMatchObject({ message: expect.stringMatching(/too fast/) });
      expect(p.closedWith).toBe(4008);
    });
    it('lets a normal burst of call signalling through', async () => {
      const { host, join } = setup();
      const p = await join('producer', 'Ada'); const g = await join('guest', 'Chi');
      await host.message(p, JSON.stringify({ t: 'admit', id: (g.att as { id: string }).id }), 1500);
      for (let i = 0; i < 60; i++) await host.message(g, JSON.stringify({ t: 'signal', to: (p.att as { id: string }).id, data: { candidate: i } }), 2000);
      expect(p.got.filter((m) => m.t === 'signal')).toHaveLength(60);
      expect(g.closedWith).toBeNull();
    });
    it('stops accepting more connections than the room allows, but always lets the producer in', async () => {
      const { host, join, socks } = setup();
      const p = await join('producer', 'Ada');
      await host.message(p, JSON.stringify({ t: 'end' }), 2000); // after the end everyone is admitted, so only the cap limits them
      for (let i = 0; i < 30; i++) await join('guest', `g${i}`, 3000);
      expect(socks.filter((x) => x.closedWith === 4003).length).toBeGreaterThan(0);
      const open = socks.filter((x) => x.closedWith === null).length;
      expect(open).toBeLessThanOrEqual(25);
      const again = await join('producer', 'Ada', 4000);
      expect(again.closedWith).toBeNull();
    });
  });
});
