/**
 * /api/templates on the Worker: list, save, delete. Sign-in comes from the same session as /api/auth.
 * The rules (validation, size, count) are shared with the Express host in server/templateService.ts.
 */
import { userFor, type AuthEnv } from '../auth/handler';
import type { Limiter } from '../auth/rateLimit';
import { listUserTemplates, removeUserTemplate, upsertUserTemplate, type TemplateStore } from '../../server/templateService';

export interface TemplateEnv {
  auth: AuthEnv;
  templates: TemplateStore;
  /** Optional per-user caps, one limiter per kind */
  limits?: { list: Limiter; write: Limiter };
}

const H = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
const send = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...H, ...extra } });
const fail = (status: number, error: string, extra: Record<string, string> = {}) => send({ error }, status, extra);
const sameSite = (req: Request) => { const o = req.headers.get('origin'); return !o || o === new URL(req.url).origin; };

/** `rest` is the path after /api/templates (empty, or the template id) */
export const handleTemplates = async (req: Request, rest: string[], env: TemplateEnv): Promise<Response> => {
  const me = await userFor(req, env.auth);
  if (!me) return fail(401, 'Sign in to use templates saved to your account.');
  const uid = me.user.id;
  const m = req.method;
  const wait = env.limits?.[m === 'GET' ? 'list' : 'write'].take(uid) ?? 0;
  if (wait) return fail(429, `Too many requests. Try again in ${wait} seconds.`, { 'retry-after': String(wait) });
  try {
    if (rest.length === 0 && m === 'GET') { const o = await listUserTemplates(env.templates, uid); return send(o.body, o.status); }
    if (rest.length === 0 && m === 'POST') {
      if (!sameSite(req)) return fail(403, 'Not allowed.');
      let body: unknown; try { body = await req.json(); } catch { return fail(400, 'A template is required.'); }
      const o = await upsertUserTemplate(env.templates, uid, body); return send(o.body, o.status);
    }
    if (rest.length === 1 && m === 'DELETE') {
      if (!sameSite(req)) return fail(403, 'Not allowed.');
      let id = ''; try { id = decodeURIComponent(rest[0]); } catch { return fail(400, 'Invalid template id.'); }
      const o = await removeUserTemplate(env.templates, uid, id); return send(o.body, o.status);
    }
  } catch { return fail(500, m === 'GET' ? 'Could not load your templates.' : m === 'POST' ? 'Could not save the template.' : 'Could not delete the template.'); }
  return fail(404, 'Not found.');
};
