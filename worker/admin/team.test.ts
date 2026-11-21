import { describe, expect, it } from 'vitest';
import type { AuthEnv } from '../auth/handler';
import { issueSession } from '../auth/session';
import { MemoryUserStore } from '../auth/users';
import { handleTeam, MAX_ADMINS, MemoryTeamStore } from './team';

const NOW = 1_800_000_000_000;
const SECRET = 'a-long-test-secret-for-sessions-0123456789';

const setup = async () => {
  const store = new MemoryUserStore();
  const team = new MemoryTeamStore();
  const env: AuthEnv = { store, projectId: 'p', sessionSecret: SECRET, superAdminEmail: 'Boss@Example.com', keys: { find: async () => undefined }, now: () => NOW, isGranted: (e) => team.has(e) };
  const make = async (id: string, email: string, role: 'user' | 'admin') => {
    await store.signIn({ id, email, name: id, photo: '', role, now: NOW });
    return `__session=${(await issueSession(SECRET, id, NOW)).token}`;
  };
  const call = (cookie: string | null, method: string, path: string, body?: unknown, origin?: string) =>
    handleTeam(new Request(`https://uuda.test/api/admin/${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), path.split('/').filter(Boolean), { auth: env, team });
  return { store, team, env, make, call };
};

describe('admin team', () => {
  it('is closed to people who are signed out or are not administrators', async () => {
    const t = await setup();
    const ada = await t.make('ada', 'ada@example.com', 'user');
    expect((await t.call(null, 'GET', 'admins')).status).toBe(401);
    expect((await t.call(ada, 'GET', 'admins')).status).toBe(403);
    expect((await t.call(ada, 'POST', 'admins', { email: 'x@y.co' })).status).toBe(403);
    expect((await t.call(ada, 'GET', 'audit')).status).toBe(403);
  });

  it('lets the super admin add an administrator who has not signed in yet, and logs it', async () => {
    const t = await setup();
    const boss = await t.make('boss', 'boss@example.com', 'admin');
    const r = await t.call(boss, 'POST', 'admins', { email: ' Chi@Example.com ' });
    expect(r.status).toBe(200);
    expect(await t.team.has('chi@example.com')).toBe(true);
    const list = (await (await t.call(boss, 'GET', 'admins')).json()) as any;
    expect(list.canManage).toBe(true);
    expect(list.admins.map((a: any) => [a.email, a.source, a.super])).toEqual([['boss@example.com', 'configured', true], ['chi@example.com', 'added', false]]);
    expect(((await (await t.call(boss, 'GET', 'audit')).json()) as any).entries[0]).toMatchObject({ actor_email: 'boss@example.com', action: 'admin.add', target: 'chi@example.com' });
  });

  it('makes an existing account an administrator at once, and takes the role away again on removal', async () => {
    const t = await setup();
    const boss = await t.make('boss', 'boss@example.com', 'admin');
    await t.make('chi', 'chi@example.com', 'user');
    await t.call(boss, 'POST', 'admins', { email: 'chi@example.com' });
    expect((await t.store.get('chi'))?.role).toBe('admin');
    expect((await t.call(boss, 'DELETE', 'admins/chi%40example.com')).status).toBe(200);
    expect((await t.store.get('chi'))?.role).toBe('user');
    expect(await t.team.has('chi@example.com')).toBe(false);
  });

  it('lets an added administrator see the team but not change it', async () => {
    const t = await setup();
    const boss = await t.make('boss', 'boss@example.com', 'admin');
    await t.make('chi', 'chi@example.com', 'user');
    await t.call(boss, 'POST', 'admins', { email: 'chi@example.com' });
    const chi = await t.make('chi', 'chi@example.com', 'admin');
    const list = (await (await t.call(chi, 'GET', 'admins')).json()) as any;
    expect(list.canManage).toBe(false);
    expect((await t.call(chi, 'POST', 'admins', { email: 'dee@example.com' })).status).toBe(403);
    expect((await t.call(chi, 'DELETE', 'admins/boss%40example.com')).status).toBe(403);
  });

  it('never removes the super admin, and refuses bad addresses, repeats of the super admin and cross-site writes', async () => {
    const t = await setup();
    const boss = await t.make('boss', 'boss@example.com', 'admin');
    expect((await t.call(boss, 'DELETE', 'admins/BOSS%40example.com')).status).toBe(400);
    expect((await t.call(boss, 'POST', 'admins', { email: 'not an email' })).status).toBe(400);
    expect((await t.call(boss, 'POST', 'admins', { email: 'boss@example.com' })).status).toBe(400);
    expect((await t.call(boss, 'POST', 'admins', { email: 'x@y.co' }, 'https://evil.test')).status).toBe(403);
    expect((await t.store.get('boss'))?.role).toBe('admin');
  });

  it('limits the size of the team', async () => {
    const t = await setup();
    const boss = await t.make('boss', 'boss@example.com', 'admin');
    for (let i = 0; i < MAX_ADMINS; i++) expect((await t.call(boss, 'POST', 'admins', { email: `a${i}@example.com` })).status).toBe(200);
    expect((await t.call(boss, 'POST', 'admins', { email: 'one-more@example.com' })).status).toBe(400);
    expect((await t.call(boss, 'POST', 'admins', { email: 'a0@example.com' })).status).toBe(200); // someone already on the list is not "one more"
  });

  it('does not let a blocked account be promoted', async () => {
    const t = await setup();
    const boss = await t.make('boss', 'boss@example.com', 'admin');
    await t.make('bad', 'bad@example.com', 'user');
    t.store.users.set('bad', { ...t.store.users.get('bad')!, blocked: true });
    await t.call(boss, 'POST', 'admins', { email: 'bad@example.com' });
    expect((await t.store.get('bad'))?.role).toBe('user');
  });
});
