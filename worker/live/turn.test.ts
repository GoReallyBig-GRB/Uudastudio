import { describe, expect, it } from 'vitest';
import { STUN_ONLY, iceServersFor, iceServersForEvent } from './turn';
import { MemoryRelayLedger, RELAY, monthKey, relayDecision } from './relayLedger';

const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('ice servers', () => {
  it('uses the free STUN server alone when no relay key is set', async () => {
    expect(await iceServersFor({}, reply(500, {}))).toEqual({ iceServers: STUN_ONLY, relay: false });
  });
  it('asks Cloudflare for short-lived relay credentials and drops port 53 addresses', async () => {
    let seen: { url: string; auth: string | null; body: string } | null = null;
    const f = (async (url: string, init: RequestInit) => { seen = { url, auth: new Headers(init.headers).get('authorization'), body: String(init.body) }; return new Response(JSON.stringify({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:5349?transport=tcp'], username: 'u', credential: 'c' }] }), { status: 201 }); }) as unknown as typeof fetch;
    const r = await iceServersFor({ TURN_KEY_ID: 'k1', TURN_API_TOKEN: 'tok' }, f);
    expect(seen!.url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/k1/credentials/generate-ice-servers');
    expect(seen!.auth).toBe('Bearer tok');
    expect(JSON.parse(seen!.body)).toEqual({ ttl: 14400 });
    expect(r.relay).toBe(true);
    expect(r.iceServers[1].urls).toEqual(['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:5349?transport=tcp']);
  });
  it('falls back to STUN when Cloudflare refuses or fails', async () => {
    expect((await iceServersFor({ TURN_KEY_ID: 'k', TURN_API_TOKEN: 't' }, reply(403, {}))).relay).toBe(false);
    const boom = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect(await iceServersFor({ TURN_KEY_ID: 'k', TURN_API_TOKEN: 't' }, boom)).toEqual({ iceServers: STUN_ONLY, relay: false });
  });
});

describe('the monthly relay allowance', () => {
  const NOW = Date.UTC(2026, 10, 17);
  const ok = (async () => new Response(JSON.stringify({ iceServers: [{ urls: ['turn:t:3478'], username: 'u', credential: 'c' }] }), { status: 201 })) as unknown as typeof fetch;
  const env = { TURN_KEY_ID: 'k', TURN_API_TOKEN: 't' };
  it('lets everyone have relay below 80%, then only rooms that already have it, then nobody', () => {
    expect(relayDecision(0, false)).toBe('allow');
    expect(relayDecision(799_999, false)).toBe('allow');
    expect(relayDecision(800_000, false)).toBe('deny');
    expect(relayDecision(800_000, true)).toBe('room-only-ok');
    expect(relayDecision(949_999, true)).toBe('room-only-ok');
    expect(relayDecision(950_000, true)).toBe('deny');
  });
  it('reserves the worst case for every set of credentials it hands out', async () => {
    const ledger = new MemoryRelayLedger();
    const r = await iceServersForEvent(env, ledger, 'e1', NOW, ok);
    expect(r).toMatchObject({ relay: true, capped: false });
    expect(await ledger.reserved(monthKey(NOW))).toBe(RELAY.reserveMb);
    expect(await ledger.roomHasRelay(monthKey(NOW), 'e1')).toBe(true);
  });
  it('stops handing out relay when the cap is reached, but keeps an event already using it going', async () => {
    const ledger = new MemoryRelayLedger();
    await ledger.reserve(monthKey(NOW), 'elsewhere', 810_000); // past 80%, spent by other events
    await ledger.reserve(monthKey(NOW), 'running', RELAY.reserveMb); // this one already has relay
    const fresh = await iceServersForEvent(env, ledger, 'new', NOW, ok);
    expect(fresh).toEqual({ iceServers: STUN_ONLY, relay: false, capped: true });
    expect((await iceServersForEvent(env, ledger, 'running', NOW, ok)).relay).toBe(true);
    expect(await ledger.roomHasRelay(monthKey(NOW), 'new')).toBe(false); // a refusal reserves nothing
  });
  it('gives one event only a few sets of credentials a month, however often it asks', async () => {
    const ledger = new MemoryRelayLedger();
    let relayed = 0;
    for (let i = 0; i < 50; i++) if ((await iceServersForEvent(env, ledger, 'busy', NOW, ok)).relay) relayed++;
    expect(relayed).toBe(RELAY.roomCapMb / RELAY.reserveMb);
    expect(await ledger.reserved(monthKey(NOW))).toBe(RELAY.roomCapMb);
    expect((await iceServersForEvent(env, ledger, 'busy', NOW, ok))).toEqual({ iceServers: STUN_ONLY, relay: false, capped: true });
    expect((await iceServersForEvent(env, ledger, 'other', NOW, ok)).relay).toBe(true); // another event is not affected
  });
  it('starts again on the first of the next month', async () => {
    const ledger = new MemoryRelayLedger();
    await ledger.reserve(monthKey(NOW), 'x', 990_000);
    expect((await iceServersForEvent(env, ledger, 'new', NOW, ok)).capped).toBe(true);
    expect((await iceServersForEvent(env, ledger, 'new', Date.UTC(2026, 11, 1), ok)).relay).toBe(true);
  });
  it('never reserves anything when no relay key is set', async () => {
    const ledger = new MemoryRelayLedger();
    expect(await iceServersForEvent({}, ledger, 'e', NOW, ok)).toEqual({ iceServers: STUN_ONLY, relay: false, capped: false });
    expect(await ledger.reserved(monthKey(NOW))).toBe(0);
  });
});
