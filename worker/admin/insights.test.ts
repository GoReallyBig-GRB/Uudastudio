import { describe, expect, it } from 'vitest';
import { buildInsights } from './insights';
import type { UserRow } from '../auth/users';

const now = Date.parse('2026-11-21T00:00:00Z');
const u = (id: string, email: string, created: string, active: string, extra: Partial<UserRow> = {}): UserRow => ({ id, email, display_name: 'Name ' + id, photo_url: '', role: 'user', created_at: created, last_active_at: active, blocked: false, preferences: { defaultVoice: '', defaultModel: '', defaultDelivery: '', autoRefresh: true }, validAfter: 0, nickname: '', ...extra });

describe('admin insights', () => {
  const users = [
    u('a', 'mike@gmail.com', '2026-11-20T10:00:00Z', '2026-11-20T23:00:00Z', { nickname: 'mikemonster', display_name: 'michael opara' }),
    u('b', 'old@gmail.com', '2026-09-01T10:00:00Z', '2026-10-25T00:00:00Z'),
    u('c', 'adm@gmail.com', '2026-08-01T10:00:00Z', '2026-11-18T00:00:00Z', { role: 'admin', blocked: true }),
  ];
  const r = buildInsights({ users, accounts: [{ owner: 'a', jobs: 3, doBytes: 100, b2Bytes: 50 }, { owner: 'zzz', jobs: 1, doBytes: 10, b2Bytes: 0 }, { owner: '', jobs: 2, doBytes: 5, b2Bytes: 0 }], now, creation: { day: '2026-11-21', created: 7, perAddress: 100, perAccount: 50, perDay: 500 }, accountLimitBytes: 1000 });

  it('lists each account with real name, nickname, email, dates and usage', () => {
    const a = r.users.find((x) => x.id === 'a')!;
    expect(a).toMatchObject({ name: 'michael opara', nickname: 'mikemonster', email: 'mike@gmail.com', createdAt: '2026-11-20T10:00:00Z', jobsHoldingAudio: 3, audioBytes: 150 });
    expect(r.users.find((x) => x.id === 'b')!.audioBytes).toBe(0);
  });

  it('counts users, recent signups, active users and blocked accounts', () => {
    expect(r.metrics).toMatchObject({ users: 3, newLast7Days: 1, activeLast7Days: 2, activeLast30Days: 3, blocked: 1, admins: 1, jobsCreatedToday: 7, jobsHoldingAudio: 6, audioBytes: 165 });
  });

  it('keeps jobs without a listed owner separate, and ranks accounts by storage', () => {
    expect(r.metrics).toMatchObject({ unownedJobs: 3, unownedBytes: 15 });
    expect(r.topAccounts.map((x) => x.id)).toEqual(['a']);
    expect(r.topAccounts[0].name).toBe('mikemonster');
  });
});
