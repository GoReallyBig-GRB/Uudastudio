/**
 * Sign-in routes for the Worker: /api/auth/google (and /session), /me, /signout, /profile.
 * The browser signs in with Firebase, sends the ID token once, and gets our own session token back (cookie and body).
 * Host-neutral (Web Request/Response) so it is tested without Cloudflare.
 */
import { issueSession, readSession, SESSION_DAYS } from './session';
import { publicUser, type UserRow, type UserStore } from './users';
import { TokenError, verifyIdToken, type Jwk } from './verifyIdToken';

export interface AuthEnv {
  store: UserStore;
  projectId: string;
  sessionSecret: string;
  /** This address is the admin account. Admin pages also need an emailed code, which this host does not offer yet, so they stay closed. */
  superAdminEmail?: string;
  keys: { find(kid: string): Promise<Jwk | undefined> };
  now: () => number;
}

const H = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
const send = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...H, ...extra } });
const fail = (status: number, error: string, extra: Record<string, string> = {}) => send({ error }, status, extra);

const COOKIE = '__session';
const setCookie = (token: string, maxAgeS: number) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeS}`;
const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

const cookieOf = (req: Request, name: string): string => {
  for (const part of (req.headers.get('cookie') || '').split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return v.join('='); }
  return '';
};
const tokenOf = (req: Request): string => {
  const a = req.headers.get('authorization') || '';
  return a.startsWith('Bearer ') ? a.slice(7).trim() : cookieOf(req, COOKIE);
};

/** A state-changing request must come from this site. SameSite=Lax already blocks most cross-site posts; this closes the rest. */
const sameSite = (req: Request): boolean => {
  const o = req.headers.get('origin');
  return !o || o === new URL(req.url).origin;
};

/** Who is signed in: a genuine, unexpired, unrevoked session of an unblocked user */
export const userFor = async (req: Request, env: AuthEnv): Promise<{ user: UserRow; token: string } | null> => {
  const token = tokenOf(req);
  const claims = await readSession(env.sessionSecret, token, env.now());
  if (!claims) return null;
  const user = await env.store.get(claims.uid);
  if (!user || user.blocked || claims.iat < user.validAfter) return null;
  return { user, token };
};

const REASONS: Record<string, string> = {
  malformed: 'That sign-in was not valid. Try again.', 'bad-algorithm': 'That sign-in was not valid. Try again.', 'unknown-key': 'That sign-in could not be checked. Try again.',
  'bad-signature': 'That sign-in was not valid. Try again.', expired: 'Your sign-in expired. Try again.', 'from-the-future': 'Your device clock looks wrong. Fix it and try again.',
  'wrong-audience': 'That sign-in was not valid. Try again.', 'wrong-issuer': 'That sign-in was not valid. Try again.', 'no-subject': 'That sign-in was not valid. Try again.',
  'no-email': 'Your Google account has no email address to use.', 'email-not-verified': 'Verify the email on your Google account first.', 'keys-unavailable': 'Sign-in is unavailable right now. Try again shortly.',
};

export const handleAuth = async (req: Request, rest: string[], env: AuthEnv): Promise<Response> => {
  const route = rest[0] ?? '';
  const post = req.method === 'POST';

  if ((route === 'google' || route === 'session') && post) {
    if (!sameSite(req)) return fail(403, 'Not allowed.');
    let idToken = '';
    try { const b = (await req.json()) as { idToken?: unknown }; idToken = typeof b.idToken === 'string' ? b.idToken : ''; } catch { /* empty */ }
    if (!idToken) idToken = (req.headers.get('authorization') || '').replace(/^Bearer\s+/, '');
    if (!idToken) return fail(400, 'A Google sign-in token is required.');
    let who;
    try { who = await verifyIdToken(idToken, { projectId: env.projectId, keys: env.keys, now: env.now }); }
    catch (e) {
      const reason = e instanceof TokenError ? e.reason : 'malformed';
      return fail(reason === 'keys-unavailable' ? 503 : 401, REASONS[reason] ?? 'That sign-in was not valid. Try again.');
    }
    const admin = !!env.superAdminEmail && who.email === env.superAdminEmail.trim().toLowerCase();
    const { user, isNew } = await env.store.signIn({ id: who.uid, email: who.email, name: who.name, photo: who.picture, role: admin ? 'admin' : 'user', now: env.now() });
    if (user.blocked) return fail(403, 'This account has been blocked.');
    const s = await issueSession(env.sessionSecret, user.id, env.now());
    return send({ user: publicUser(user), isNew, sessionToken: s.token, adminCodeSent: false }, 200, { 'set-cookie': setCookie(s.token, SESSION_DAYS * 86400) });
  }

  if (route === 'me' && req.method === 'GET') {
    const me = await userFor(req, env);
    return me ? send({ user: publicUser(me.user), unreadTicketsCount: 0, isAdminVerified: false }) : send({ user: null }, 200);
  }

  if (route === 'signout' && post) {
    if (!sameSite(req)) return fail(403, 'Not allowed.');
    const me = await userFor(req, env);
    if (me) await env.store.revokeBefore(me.user.id, env.now());
    return send({ success: true, message: 'Signed out successfully.' }, 200, { 'set-cookie': clearCookie() });
  }

  if (route === 'profile' && req.method === 'PUT') {
    if (!sameSite(req)) return fail(403, 'Not allowed.');
    const me = await userFor(req, env);
    if (!me) return fail(401, 'Sign in first.');
    let b: Record<string, unknown>;
    try { b = (await req.json()) as Record<string, unknown>; } catch { return fail(400, 'Bad request.'); }
    // The email is the account's identity and never changes
    if ('email' in b) return fail(400, 'Your Google account email is permanent for this account and cannot be modified.');
    const updated = await env.store.update(me.user.id, { display_name: typeof b.display_name === 'string' ? b.display_name : undefined, preferences: b.preferences && typeof b.preferences === 'object' ? (b.preferences as Record<string, never>) : undefined });
    return updated ? send({ user: publicUser(updated), message: 'Profile updated successfully.' }) : fail(404, 'Account not found.');
  }

  return fail(404, 'Not found.');
};
