import { describe, expect, it } from 'vitest';
import { CreateGate, MemoryGateStore } from './createGate';
import { ACCOUNT_FULL_MESSAGE, MemoryRegistryStore, Registry, localGuard } from './storage';
import { MemoryUserStore, cleanNick, shownName } from '../auth/users';

const MB = 1024 * 1024;

describe('per-account audio allowance', () => {
  it('refuses a new file when the account would pass its allowance, but not another account', () => {
    const reg = new Registry(new MemoryRegistryStore(), 1000 * MB, undefined, 10 * MB);
    reg.setOwner('j1', 'alice'); reg.setOwner('j2', 'alice'); reg.setOwner('j3', 'bob');
    reg.set('j1', 6 * MB);
    expect(reg.check(3 * MB, 'j2')).toBeNull(); // 9 of 10 MB
    expect(reg.check(5 * MB, 'j2')).toBe(ACCOUNT_FULL_MESSAGE); // 11 of 10 MB
    expect(reg.check(5 * MB, 'j3')).toBeNull(); // bob has nothing yet
    expect(reg.place(5 * MB, 'j2')).toEqual({ refusal: ACCOUNT_FULL_MESSAGE });
  });

  it('does not count a job whose owner is unknown, and still applies the account-wide limit', () => {
    const reg = new Registry(new MemoryRegistryStore(), 5 * MB, undefined, 1 * MB);
    expect(reg.check(4 * MB, 'old-job')).toBeNull();
    expect(reg.check(6 * MB, 'old-job')).not.toBeNull();
  });

  it('counts overflow storage toward the same account, and reports usage per account', () => {
    const b2 = new MemoryRegistryStore();
    const reg = new Registry(new MemoryRegistryStore(), 1000 * MB, { b2, b2Limit: 1000 * MB, lowWater: 1 * MB }, 10 * MB);
    reg.setOwner('j1', 'alice'); b2.setOwner('j1', 'alice');
    reg.setB2('j1', 8 * MB);
    expect(reg.check(3 * MB, 'j1')).toBe(ACCOUNT_FULL_MESSAGE);
    reg.set('j1', 1 * MB);
    expect(reg.accounts()).toEqual([{ owner: 'alice', jobs: 1, doBytes: 1 * MB, b2Bytes: 8 * MB }]);
  });

  it('the guard a job uses carries its own job id', () => {
    const reg = new Registry(new MemoryRegistryStore(), 1000 * MB, undefined, 2 * MB);
    reg.setOwner('J', 'alice');
    expect(localGuard(reg, 'J').check(3 * MB)).toBe(ACCOUNT_FULL_MESSAGE);
  });
});

describe('per-account creation limit', () => {
  it('limits each account separately from the network and from other accounts', async () => {
    const g = new CreateGate(new MemoryGateStore(), 100, 100, () => Date.parse('2026-11-21T10:00:00Z'), 3);
    for (let i = 0; i < 3; i++) expect((await g.take('1.1.1.1', 'alice')).ok).toBe(true);
    expect((await g.take('1.1.1.1', 'alice')).ok).toBe(false);
    expect((await g.take('1.1.1.1', 'bob')).ok).toBe(true);
    expect(g.today()).toMatchObject({ created: 4, perAccount: 3 });
  });
});

describe('nickname', () => {
  it('is separate from the Google name and is what others see', async () => {
    const s = new MemoryUserStore();
    const { user } = await s.signIn({ id: 'u1', email: 'mike@gmail.com', name: 'michael opara', photo: '', role: 'user', now: 1 });
    expect(shownName(user)).toBe('michael opara');
    const up = await s.update('u1', { nickname: '  mikemonster ' });
    expect(up?.nickname).toBe('mikemonster');
    expect(up?.display_name).toBe('michael opara'); // the Google name is kept for the admin
    expect(shownName(up!)).toBe('mikemonster');
    expect(shownName((await s.update('u1', { nickname: '' }))!)).toBe('michael opara'); // clearing goes back to the Google name
  });

  it('must be 2 to 40 characters with no control characters', () => {
    expect(cleanNick('a')).toBe('');
    expect(cleanNick('ab')).toBe('ab');
    expect(cleanNick('x'.repeat(60))).toHaveLength(40);
    expect(cleanNick('bad\u0000name\n')).toBe('badname');
  });
});
