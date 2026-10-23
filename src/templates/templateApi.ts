/**
 * Uuda Studio - the app's side of template sync (GET/POST/DELETE /api/templates).
 *
 * Everything the server sends back is parsed again with the same checks used for template files, so an unexpected
 * or damaged entry is skipped instead of reaching the interface. Requests carry only the sign-in token; the user's
 * own Gemini key (which other routes need) is never sent here.
 */

import { authService } from '../services/authService';
import { parseTemplate, UudaTemplate } from './template';

export interface CloudTemplate {
  id: string;
  name: string;
  updatedAt: string;
  template: UudaTemplate;
}

export class TemplateSyncError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'TemplateSyncError';
    this.status = status;
  }
}

export interface TemplateApiDeps {
  fetchFn: typeof fetch;
  getToken: () => string | null;
}

const defaultDeps = (): TemplateApiDeps => ({
  fetchFn: (input, init) => fetch(input, init),
  getToken: () => authService.getToken(),
});

async function call(deps: TemplateApiDeps, method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = deps.getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await deps.fetchFn(url, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new TemplateSyncError('Could not reach the server. Check your connection and try again.', 0);
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    if (res.status === 401) throw new TemplateSyncError('Sign in to use templates saved to your account.', 401);
    const message = payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
      ? (payload as { error: string }).error
      : 'Something went wrong. Please try again.';
    throw new TemplateSyncError(message, res.status);
  }
  return payload;
}

function toCloud(item: unknown): CloudTemplate | null {
  if (!item || typeof item !== 'object') return null;
  const r = item as Record<string, unknown>;
  const parsed = parseTemplate(r.template);
  if (!parsed.ok || typeof r.id !== 'string') return null;
  // The server's id is the key for this copy; the name shown is the template's own
  return {
    id: r.id,
    name: parsed.template.name,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : '',
    template: { ...parsed.template, id: r.id },
  };
}

export async function listCloudTemplates(deps: TemplateApiDeps = defaultDeps()): Promise<CloudTemplate[]> {
  const payload = (await call(deps, 'GET', '/api/templates')) as { items?: unknown } | null;
  const items = payload && Array.isArray(payload.items) ? payload.items : [];
  return items.map(toCloud).filter((x): x is CloudTemplate => x !== null);
}

export async function saveCloudTemplate(template: UudaTemplate, deps: TemplateApiDeps = defaultDeps()): Promise<CloudTemplate> {
  const { builtIn: _drop, ...file } = template;
  const payload = (await call(deps, 'POST', '/api/templates', { template: file })) as { item?: unknown } | null;
  const saved = toCloud(payload?.item);
  if (!saved) throw new TemplateSyncError('The server sent back something unexpected. Please try again.', 502);
  return saved;
}

export async function deleteCloudTemplate(id: string, deps: TemplateApiDeps = defaultDeps()): Promise<void> {
  await call(deps, 'DELETE', `/api/templates/${encodeURIComponent(id)}`);
}
