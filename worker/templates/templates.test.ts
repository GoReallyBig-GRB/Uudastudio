import { describe, expect, it } from 'vitest';
import { handleTemplates, type TemplateEnv } from './handler';
import { D1TemplateStore, MemoryTemplateStore, type D1Full } from './store';
import { MemoryUserStore } from '../auth/users';
import { issueSession } from '../auth/session';
import { makeLimiter } from '../auth/rateLimit';
import { BUILT_IN_TEMPLATES } from '../../src/templates/builtIn';
import { serializeTemplate } from '../../src/templates/template';

const SECRET = 'test-secret-test-secret-test-secret-0123456789';
const good = () => JSON.parse(serializeTemplate(BUILT_IN_TEMPLATES[0]));
const ORIGIN = 'https://uuda.test';

const setup = async (extra: Partial<TemplateEnv> = {}) => {
  let t = 1_800_000_000_000;
  const users = new MemoryUserStore();
  const mk = async (id: string) => {
    await users.signIn({ id, email: `${id}@x.test`, name: id, photo: '', role: 'user', now: t });
    return (await issueSession(SECRET, id, t)).token;
  };
  const env: TemplateEnv = { auth: { store: users, projectId: 'p', sessionSecret: SECRET, keys: { find: async () => undefined }, now: () => t }, templates: new MemoryTemplateStore(() => t), ...extra };
  const call = (method: string, path: string, o: { token?: string; body?: unknown; origin?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (o.token) headers.cookie = `__session=${o.token}`;
    if (o.origin) headers.origin = o.origin;
    const rest = path.split('/').filter(Boolean);
    return handleTemplates(new Request(`${ORIGIN}/api/templates${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }), rest, env);
  };
  return { env, mk, call, tick: (ms: number) => { t += ms; } };
};

describe('templates on the Worker', () => {
  it('needs sign-in', async () => {
    const m = await setup();
    expect((await m.call('GET', '')).status).toBe(401);
    expect((await m.call('POST', '', { body: { template: good() } })).status).toBe(401);
    expect((await m.call('GET', '', { token: 'uuda_sess_junk.junk' })).status).toBe(401);
  });

  it('saves, lists newest first, updates in place and deletes', async () => {
    const m = await setup();
    const tok = await m.mk('u1');
    const a = { ...good(), id: 'tpl-a', name: 'A' };
    const b = { ...good(), id: 'tpl-b', name: 'B' };
    expect((await m.call('POST', '', { token: tok, body: { template: a } })).status).toBe(200);
    m.tick(1000);
    expect((await m.call('POST', '', { token: tok, body: { template: b } })).status).toBe(200);
    expect(((await (await m.call('GET', '', { token: tok })).json()) as any).items.map((i: any) => i.id)).toEqual(['tpl-b', 'tpl-a']);
    m.tick(1000);
    await m.call('POST', '', { token: tok, body: { template: { ...a, name: 'A renamed' } } });
    const list = (await (await m.call('GET', '', { token: tok })).json()) as any;
    expect(list.items.length).toBe(2);
    expect(list.items[0].id).toBe('tpl-a');
    expect(list.items[0].name).toBe('A renamed');
    expect((await m.call('DELETE', '/tpl-a', { token: tok })).status).toBe(200);
    expect(((await (await m.call('GET', '', { token: tok })).json()) as any).items.length).toBe(1);
    expect((await m.call('DELETE', '/tpl-a', { token: tok })).status).toBe(404);
  });

  it("never shows one person another's templates, and cannot delete them", async () => {
    const m = await setup();
    const t1 = await m.mk('u1'); const t2 = await m.mk('u2');
    await m.call('POST', '', { token: t1, body: { template: { ...good(), id: 'tpl-x', name: 'Mine' } } });
    expect(((await (await m.call('GET', '', { token: t2 })).json()) as any).items).toEqual([]);
    expect((await m.call('DELETE', '/tpl-x', { token: t2 })).status).toBe(404);
    expect(((await (await m.call('GET', '', { token: t1 })).json()) as any).items.length).toBe(1);
  });

  it('refuses a bad body, a cross-site write, and a bad id', async () => {
    const m = await setup();
    const tok = await m.mk('u1');
    expect((await m.call('POST', '', { token: tok, body: { template: { nope: true } } })).status).toBe(400);
    expect((await m.call('POST', '', { token: tok, body: { template: good() }, origin: 'https://evil.example' })).status).toBe(403);
    expect((await m.call('DELETE', '/tpl-a', { token: tok, origin: 'https://evil.example' })).status).toBe(403);
    expect((await m.call('DELETE', '/%E0%A4%A', { token: tok })).status).toBe(400);
    expect((await m.call('PATCH', '', { token: tok })).status).toBe(404);
  });

  it('applies the shared size and count rules', async () => {
    const m = await setup();
    const tok = await m.mk('u1');
    for (let i = 0; i < 50; i++) expect((await m.call('POST', '', { token: tok, body: { template: { ...good(), id: `tpl-${i}`, name: `T${i}` } } })).status).toBe(200);
    expect((await m.call('POST', '', { token: tok, body: { template: { ...good(), id: 'tpl-extra', name: 'Extra' } } })).status).toBe(409);
  });

  it('limits how fast one person can write', async () => {
    const m = await setup({ limits: { list: makeLimiter(100, 60_000), write: makeLimiter(2, 60_000, () => 0) } });
    const tok = await m.mk('u1');
    expect((await m.call('POST', '', { token: tok, body: { template: { ...good(), id: 'tpl-1', name: 'A' } } })).status).toBe(200);
    expect((await m.call('POST', '', { token: tok, body: { template: { ...good(), id: 'tpl-2', name: 'B' } } })).status).toBe(200);
    const r = await m.call('POST', '', { token: tok, body: { template: { ...good(), id: 'tpl-3', name: 'C' } } });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

// A tiny stand-in for D1 that understands exactly the four statements the store sends
const fakeD1 = () => {
  const rows = new Map<string, Record<string, unknown>>();
  const stats = { statements: 0 };
  const db: D1Full = {
    exec: async () => undefined,
    prepare(q: string) {
      return {
        bind(...v: unknown[]) {
          const run = () => { stats.statements++; };
          return {
            first: async <T,>() => {
              run();
              if (q.startsWith('INSERT')) {
                const [user_id, id, name, size_bytes, data, created, updated] = v as [string, string, string, number, string, number, number];
                const old = rows.get(`${user_id}/${id}`);
                const row = { user_id, id, name, size_bytes, data, created_at: old ? old.created_at : created, updated_at: updated };
                rows.set(`${user_id}/${id}`, row);
                return row as T;
              }
              if (q.startsWith('DELETE')) return (rows.delete(`${v[0]}/${v[1]}`) ? { id: v[1] } : null) as T | null;
              return null;
            },
            run: async () => { run(); },
            all: async <T,>() => { run(); return { results: [...rows.values()].filter((r) => r.user_id === v[0]).sort((a, b) => Number(b.updated_at) - Number(a.updated_at)) as T[] }; },
          };
        },
      };
    },
  };
  return { db, rows, stats };
};

describe('D1 template store', () => {
  it('saves one row per write, keeps the creation time on update, scopes by user', async () => {
    const { db, rows, stats } = fakeD1();
    let t = 1000;
    const s = new D1TemplateStore(db, () => t);
    const a = await s.saveTemplate('u1', 'tpl-a', 'A', { x: 1 });
    expect(a.data).toEqual({ x: 1 });
    t = 5000;
    const a2 = await s.saveTemplate('u1', 'tpl-a', 'A2', { x: 2 });
    expect(a2.created_at).toBe(a.created_at);
    expect(a2.updated_at).not.toBe(a.created_at);
    expect(rows.size).toBe(1);
    await s.saveTemplate('u2', 'tpl-a', 'Other', { y: 1 });
    expect((await s.getTemplatesForUser('u1')).map((x) => x.name)).toEqual(['A2']);
    expect(await s.deleteTemplate('u1', 'tpl-a')).toBe(true);
    expect(await s.deleteTemplate('u1', 'tpl-a')).toBe(false);
    expect(await s.deleteTemplate('u2', 'tpl-zzz')).toBe(false);
    // Free-plan budget: 3 saves + 1 list + 3 deletes = 7 statements, nothing extra
    expect(stats.statements).toBe(7);
  });
});
