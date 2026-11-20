import { describe, expect, it } from 'vitest';
import { authorizeCreate } from './createAccess';
import { issueSession } from '../auth/session';
import { MemoryUserStore } from '../auth/users';
import type { AuthEnv } from '../auth/handler';

const NOW = Date.parse('2026-11-21T10:00:00Z');
const setup = async () => {
  const store = new MemoryUserStore();
  const { user } = await store.signIn({ id: 'u1', email: 'a@b.c', name: 'A', photo: '', role: 'user', now: NOW });
  const auth = { store, projectId: 'p', sessionSecret: 'secret-secret-secret-secret-1234', keys: { find: async () => undefined }, now: () => NOW } as AuthEnv;
  const { token } = await issueSession(auth.sessionSecret, user.id, NOW);
  return { auth, store, token };
};
const req = (headers: Record<string, string> = {}) => new Request('https://x.test/api/jobs', { method: 'POST', headers });

describe('who may create a job', () => {
  it('refuses a stranger, accepts a signed-in account and names it as owner', async () => {
    const { auth, token } = await setup();
    expect(await authorizeCreate(req(), auth)).toEqual({ ok: false, status: 401, error: 'Sign in to create a job.' });
    expect(await authorizeCreate(req({ cookie: '__session=garbage' }), auth)).toMatchObject({ ok: false, status: 401 });
    expect(await authorizeCreate(req({ cookie: `__session=${token}` }), auth)).toEqual({ ok: true, owner: 'u1' });
  });

  it('a shared code header does not let a stranger in', async () => {
    const { auth } = await setup();
    expect(await authorizeCreate(req({ 'x-jobs-create-code': 'letmein' }), auth)).toMatchObject({ ok: false, status: 401 });
  });

  it('a blocked account is refused', async () => {
    const { auth, store, token } = await setup();
    store.users.set('u1', { ...store.users.get('u1')!, blocked: true });
    expect(await authorizeCreate(req({ cookie: `__session=${token}` }), auth)).toMatchObject({ ok: false, status: 401 });
  });

  it('a session issued before sign-out is refused', async () => {
    const { auth, store, token } = await setup();
    await store.revokeBefore('u1', NOW + 1000);
    expect(await authorizeCreate(req({ cookie: `__session=${token}` }), auth)).toMatchObject({ ok: false, status: 401 });
  });

  it('without sign-in set up on the server, nobody may create a job', async () => {
    expect(await authorizeCreate(req(), null)).toMatchObject({ ok: false, status: 503 });
    expect(await authorizeCreate(req({ 'x-jobs-create-code': 'letmein' }), null)).toMatchObject({ ok: false, status: 503 });
  });
});
