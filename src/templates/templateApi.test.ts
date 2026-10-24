import { describe, it, expect } from 'vitest';
import { listCloudTemplates, saveCloudTemplate, deleteCloudTemplate, TemplateSyncError, TemplateApiDeps } from './templateApi';
import { BUILT_IN_TEMPLATES } from './builtIn';
import { serializeTemplate } from './template';

const file = () => JSON.parse(serializeTemplate(BUILT_IN_TEMPLATES[1]));

function deps(handler: (url: string, init: RequestInit) => { status: number; body?: unknown } | 'network', token: string | null = 'uuda_sess_abc'): TemplateApiDeps & { calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  return {
    calls,
    getToken: () => token,
    fetchFn: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = handler(url, init);
      if (r === 'network') throw new TypeError('failed to fetch');
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body } as Response;
    }) as unknown as typeof fetch,
  };
}

describe('template sync client', () => {
  it('lists templates, re-checks each one, and skips damaged entries', async () => {
    const d = deps(() => ({
      status: 200,
      body: { items: [
        { id: 'a', updatedAt: '2026-01-01', template: { ...file(), id: 'a', name: 'Good' } },
        { id: 'b', template: { format: 'nope' } },
        { template: file() },
        null,
      ] },
    }));
    const list = await listCloudTemplates(d);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('a');
    expect(list[0].name).toBe('Good');
    expect(d.calls[0].url).toBe('/api/templates');
    expect((d.calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer uuda_sess_abc');
  });

  it('never sends the Gemini key header, only the sign-in token', async () => {
    const d = deps(() => ({ status: 200, body: { items: [] } }));
    await listCloudTemplates(d);
    const headers = d.calls[0].init.headers as Record<string, string>;
    expect(Object.keys(headers).some((k) => k.toLowerCase().includes('gemini'))).toBe(false);
  });

  it('saves with POST, drops the builtIn flag, and returns the stored copy', async () => {
    const d = deps((_u, init) => ({ status: 200, body: { item: { id: 'tpl-9', updatedAt: 'now', template: JSON.parse(String(init.body)).template } } }));
    const saved = await saveCloudTemplate({ ...BUILT_IN_TEMPLATES[1], id: 'tpl-9' }, d);
    expect(d.calls[0].init.method).toBe('POST');
    expect(String(d.calls[0].init.body)).not.toContain('builtIn');
    expect(saved.id).toBe('tpl-9');
    expect(saved.template.tracks.length).toBe(BUILT_IN_TEMPLATES[1].tracks.length);
  });

  it('deletes with an encoded id', async () => {
    const d = deps(() => ({ status: 200, body: { ok: true } }));
    await deleteCloudTemplate('a b/c', d);
    expect(d.calls[0].url).toBe('/api/templates/a%20b%2Fc');
    expect(d.calls[0].init.method).toBe('DELETE');
  });

  it('turns failures into plain messages', async () => {
    await expect(listCloudTemplates(deps(() => ({ status: 401, body: { error: 'x' } })))).rejects.toThrow(/Sign in/);
    await expect(listCloudTemplates(deps(() => 'network'))).rejects.toThrow(/Could not reach the server/);
    await expect(saveCloudTemplate(BUILT_IN_TEMPLATES[0], deps(() => ({ status: 409, body: { error: 'You can keep up to 50 templates.' } })))).rejects.toThrow(/up to 50/);
    await expect(saveCloudTemplate(BUILT_IN_TEMPLATES[0], deps(() => ({ status: 500 })))).rejects.toThrow(/Something went wrong/);
    await expect(saveCloudTemplate(BUILT_IN_TEMPLATES[0], deps(() => ({ status: 200, body: { item: { id: 'x', template: {} } } })))).rejects.toThrow(/unexpected/);
  });

  it('errors carry their status so the screen can react', async () => {
    try {
      await listCloudTemplates(deps(() => ({ status: 401 })));
      expect(false).toBe(true);
    } catch (e) {
      expect(e instanceof TemplateSyncError).toBe(true);
      expect((e as TemplateSyncError).status).toBe(401);
    }
  });
});
