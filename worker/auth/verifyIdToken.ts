/**
 * Verifies a Firebase ID token inside a Worker, with Web Crypto and Google's published signing keys.
 * Nothing in the token is believed until the signature, issuer, audience and times have all checked out.
 * Host-neutral: the key fetch and the clock are passed in, so it is tested without a network.
 */

export const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string; use?: string }
export interface KeySet { keys: Jwk[]; /** seconds Google says the keys may be reused */ maxAge: number }
export type FetchKeys = () => Promise<KeySet>;

export interface Identity { uid: string; email: string; emailVerified: boolean; name: string; picture: string; provider: string; issuedAt: number }

export class TokenError extends Error {
  constructor(public reason: string) { super(reason); }
}

const b64 = (s: string): Uint8Array => {
  const p = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(p);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const json = (s: string): Record<string, unknown> => {
  try { const o = JSON.parse(new TextDecoder().decode(b64(s))); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch { /* fall through */ }
  throw new TokenError('malformed');
};

/** Allowed difference between our clock and Google's, in seconds */
const SKEW = 300;
/** At most one key refresh this often when a token names a key we do not have (key rotation) */
const REFRESH_FLOOR_MS = 60_000;

/** Keeps Google's keys for as long as Google allows, and fetches again at once only when a token names an unknown key */
export const keyCache = (fetchKeys: FetchKeys, now: () => number = Date.now) => {
  let set: KeySet | null = null;
  let at = 0;
  const load = async () => { set = await fetchKeys(); at = now(); };
  return {
    async find(kid: string): Promise<Jwk | undefined> {
      if (!set || now() - at > Math.max(60, set.maxAge) * 1000) await load();
      let k = set!.keys.find((x) => x.kid === kid);
      if (!k && now() - at > REFRESH_FLOOR_MS) { await load(); k = set!.keys.find((x) => x.kid === kid); }
      return k;
    },
  };
};

/** Reads Google's keys over the network. The Cache-Control max-age says how long they may be kept. */
export const fetchGoogleKeys: FetchKeys = async () => {
  const r = await fetch(JWKS_URL);
  if (!r.ok) throw new TokenError('keys-unavailable');
  const body = (await r.json()) as { keys?: Jwk[] };
  const m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
  return { keys: Array.isArray(body.keys) ? body.keys : [], maxAge: m ? Number(m[1]) : 3600 };
};

export interface VerifyOptions { projectId: string; keys: { find(kid: string): Promise<Jwk | undefined> }; now?: () => number; requireVerifiedEmail?: boolean }

export const verifyIdToken = async (token: string, o: VerifyOptions): Promise<Identity> => {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3 || parts.some((p) => !p) || token.length > 8192) throw new TokenError('malformed');
  const header = json(parts[0]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new TokenError('bad-algorithm');
  const jwk = await o.keys.find(header.kid);
  if (!jwk || jwk.kty !== 'RSA') throw new TokenError('unknown-key');

  const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new TokenError('bad-signature');

  const p = json(parts[1]);
  const nowS = Math.floor((o.now ?? Date.now)() / 1000);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  if (!(num(p.exp) > nowS)) throw new TokenError('expired');
  if (!(num(p.iat) <= nowS + SKEW)) throw new TokenError('from-the-future');
  if (!(num(p.auth_time) <= nowS + SKEW)) throw new TokenError('from-the-future');
  if (p.aud !== o.projectId) throw new TokenError('wrong-audience');
  if (p.iss !== `https://securetoken.google.com/${o.projectId}`) throw new TokenError('wrong-issuer');
  if (typeof p.sub !== 'string' || !p.sub || p.sub.length > 128) throw new TokenError('no-subject');
  if (typeof p.email !== 'string' || !p.email.includes('@')) throw new TokenError('no-email');
  const verified = p.email_verified === true;
  if ((o.requireVerifiedEmail ?? true) && !verified) throw new TokenError('email-not-verified');
  const fb = (p.firebase ?? {}) as { sign_in_provider?: unknown };
  return {
    uid: p.sub, email: p.email.toLowerCase(), emailVerified: verified,
    name: typeof p.name === 'string' ? p.name.slice(0, 120) : '', picture: typeof p.picture === 'string' ? p.picture.slice(0, 500) : '',
    provider: typeof fb.sign_in_provider === 'string' ? fb.sign_in_provider : '', issuedAt: num(p.iat),
  };
};
