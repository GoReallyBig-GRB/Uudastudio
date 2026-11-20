/**
 * Who may create a job. With accounts available, a signed-in, unblocked account is required and the shared code is not used.
 * Without accounts, the older optional shared code applies. Host-neutral so it can be tested without Cloudflare.
 */
import { userFor, type AuthEnv } from '../auth/handler';

export type CreateAccess = { ok: true; owner: string } | { ok: false; status: number; error: string };

export const authorizeCreate = async (req: Request, auth: AuthEnv | null, sharedCode?: string): Promise<CreateAccess> => {
  if (auth) {
    const me = await userFor(req, auth);
    return me ? { ok: true, owner: me.user.id } : { ok: false, status: 401, error: 'Sign in to create a job.' };
  }
  if (sharedCode && req.headers.get('x-jobs-create-code') !== sharedCode) return { ok: false, status: 403, error: 'A code is needed to create jobs.' };
  return { ok: true, owner: '' };
};
