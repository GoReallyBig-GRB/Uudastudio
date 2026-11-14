/**
 * Our own session tokens, so the browser does not have to send a Firebase ID token (which lives an hour) on every call.
 * A token is `uuda_sess_<payload>.<signature>`; the signature is HMAC-SHA256 with a Worker secret.
 * Signing out sets the user's `validAfter`, which makes every older token fail without keeping a list of sessions.
 */
export const SESSION_PREFIX = 'uuda_sess_';
export const SESSION_DAYS = 5;

const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array): string => { let s = ''; for (const x of new Uint8Array(b)) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s: string): Uint8Array => { const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };
const hmac = (secret: string) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

/** Times are in milliseconds, so signing out and straight back in is never confused with the old session */
export interface SessionClaims { uid: string; iat: number; exp: number }

export const issueSession = async (secret: string, uid: string, nowMs: number): Promise<{ token: string; expires: number }> => {
  const iat = nowMs;
  const exp = iat + SESSION_DAYS * 86400_000;
  const body = b64u(enc.encode(JSON.stringify({ uid, iat, exp })));
  const sig = await crypto.subtle.sign('HMAC', await hmac(secret), enc.encode(body));
  return { token: `${SESSION_PREFIX}${body}.${b64u(sig)}`, expires: exp };
};

/** The claims of a genuine, unexpired token, or null. The caller must still check `validAfter` and `blocked`. */
export const readSession = async (secret: string, token: string, nowMs: number): Promise<SessionClaims | null> => {
  if (!secret || !token.startsWith(SESSION_PREFIX) || token.length > 2048) return null;
  const [body, sig] = token.slice(SESSION_PREFIX.length).split('.');
  if (!body || !sig) return null;
  try {
    // verify() compares in constant time
    if (!(await crypto.subtle.verify('HMAC', await hmac(secret), unb64u(sig), enc.encode(body)))) return null;
    const c = JSON.parse(new TextDecoder().decode(unb64u(body))) as SessionClaims;
    if (typeof c.uid !== 'string' || !c.uid || typeof c.exp !== 'number' || typeof c.iat !== 'number' || c.exp <= nowMs) return null;
    return c;
  } catch { return null; }
};
