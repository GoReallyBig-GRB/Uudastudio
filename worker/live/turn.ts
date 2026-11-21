/**
 * Connection helpers for the voice call. Devices connect straight to each other; when a network blocks that, Cloudflare's relay (TURN)
 * carries the call. Its credentials are made here, short-lived, so the key never reaches a browser. Without the key the call still works
 * for most networks through the free STUN server alone, and the page says so.
 */
import { RELAY, monthKey, relayDecision, type RelayLedger } from './relayLedger';

export interface TurnEnv { TURN_KEY_ID?: string; TURN_API_TOKEN?: string }
export interface IceServer { urls: string | string[]; username?: string; credential?: string }

export const STUN_ONLY: IceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];
/** A full session (3 hours) and its grace period, with a margin. Credentials are only worth stealing while they last, so no longer than that. */
export const TURN_TTL_SECONDS = 4 * 3600;

export async function iceServersFor(env: TurnEnv, doFetch: typeof fetch = fetch): Promise<{ iceServers: IceServer[]; relay: boolean }> {
  if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN) return { iceServers: STUN_ONLY, relay: false };
  try {
    const res = await doFetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.TURN_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
    });
    if (!res.ok) return { iceServers: STUN_ONLY, relay: false };
    const body = (await res.json()) as { iceServers?: IceServer[] };
    // Port 53 addresses time out in browsers and only slow the connection down
    const servers = (body.iceServers ?? []).map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)) })).filter((s) => s.urls.length > 0);
    const relay = servers.some((s) => s.username && s.credential);
    return relay ? { iceServers: servers, relay } : { iceServers: STUN_ONLY, relay: false };
  } catch { return { iceServers: STUN_ONLY, relay: false }; }
}

/** Connection servers for one person joining one event's call, within the monthly relay allowance */
export async function iceServersForEvent(env: TurnEnv, ledger: RelayLedger, eventId: string, now: number, doFetch: typeof fetch = fetch): Promise<{ iceServers: IceServer[]; relay: boolean; capped: boolean }> {
  if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN) return { iceServers: STUN_ONLY, relay: false, capped: false };
  const month = monthKey(now);
  const verdict = relayDecision(await ledger.reserved(month), await ledger.roomHasRelay(month, eventId));
  if (verdict === 'deny') return { iceServers: STUN_ONLY, relay: false, capped: true };
  // One event cannot ask again and again: after its own cap it is on direct connections only, which still work for most networks
  if (await ledger.roomReserved(month, eventId) >= RELAY.roomCapMb) return { iceServers: STUN_ONLY, relay: false, capped: true };
  await ledger.reserve(month, eventId, RELAY.reserveMb); // reserve first: if the request below fails we have only been careful
  return { ...(await iceServersFor(env, doFetch)), capped: false };
}
