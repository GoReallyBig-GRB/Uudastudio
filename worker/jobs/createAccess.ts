/**
 * Who may create a job: a signed-in, unblocked account. If sign-in is not set up on this server, nobody may,
 * so a half-configured deployment never leaves job creation open to strangers. Host-neutral so it can be tested without Cloudflare.
 */
import { userFor, type AuthEnv } from '../auth/handler';

export type CreateAccess = { ok: true; owner: string } | { ok: false; status: number; error: string };

export const authorizeCreate = async (req: Request, auth: AuthEnv | null): Promise<CreateAccess> => {
  if (!auth) return { ok: false, status: 503, error: 'Creating jobs needs sign-in, which is not set up on this server.' };
  const me = await userFor(req, auth);
  return me ? { ok: true, owner: me.user.id } : { ok: false, status: 401, error: 'Sign in to create a job.' };
};
