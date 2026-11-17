import { describe, expect, it } from 'vitest';
import { STUN_ONLY, iceServersFor } from './turn';

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
    expect(JSON.parse(seen!.body)).toEqual({ ttl: 43200 });
    expect(r.relay).toBe(true);
    expect(r.iceServers[1].urls).toEqual(['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:5349?transport=tcp']);
  });
  it('falls back to STUN when Cloudflare refuses or fails', async () => {
    expect((await iceServersFor({ TURN_KEY_ID: 'k', TURN_API_TOKEN: 't' }, reply(403, {}))).relay).toBe(false);
    const boom = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect(await iceServersFor({ TURN_KEY_ID: 'k', TURN_API_TOKEN: 't' }, boom)).toEqual({ iceServers: STUN_ONLY, relay: false });
  });
});
