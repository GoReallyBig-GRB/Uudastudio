/**
 * The admin overview: who has accounts, how recently they used the app, and what each holds on the service.
 * Host-neutral and read-only. The route that serves it checks that the caller is an admin.
 */
import type { UserRow } from '../auth/users';

export interface AccountUsage { owner: string; jobs: number; doBytes: number; b2Bytes: number }

export interface InsightsInput {
  users: UserRow[];
  accounts: AccountUsage[];
  now: number;
  /** From the registry: storage status, creation counts and limits (shape kept loose so this file needs no Cloudflare types) */
  status?: Record<string, unknown>;
  creation?: { day: string; created: number; perAddress: number; perAccount: number; perDay: number };
  accountLimitBytes?: number;
}

const DAY = 24 * 3600_000;

export const buildInsights = (i: InsightsInput) => {
  const byOwner = new Map(i.accounts.map((a) => [a.owner, a]));
  const t = (iso: string) => Date.parse(iso) || 0;
  const users = i.users.map((u) => {
    const a = byOwner.get(u.id);
    return {
      id: u.id, name: u.display_name, nickname: u.nickname, email: u.email, role: u.role, blocked: u.blocked,
      createdAt: u.created_at, lastActiveAt: u.last_active_at,
      jobsHoldingAudio: a?.jobs ?? 0, audioBytes: (a?.doBytes ?? 0) + (a?.b2Bytes ?? 0),
    };
  });
  const known = new Set(i.users.map((u) => u.id));
  // Jobs made before accounts existed, or by someone no longer listed
  const unowned = i.accounts.filter((a) => !known.has(a.owner)).reduce((n, a) => ({ jobs: n.jobs + a.jobs, bytes: n.bytes + a.doBytes + a.b2Bytes }), { jobs: 0, bytes: 0 });
  return {
    generatedAt: new Date(i.now).toISOString(),
    metrics: {
      users: i.users.length,
      newLast7Days: i.users.filter((u) => i.now - t(u.created_at) < 7 * DAY).length,
      activeLast7Days: i.users.filter((u) => i.now - t(u.last_active_at) < 7 * DAY).length,
      activeLast30Days: i.users.filter((u) => i.now - t(u.last_active_at) < 30 * DAY).length,
      blocked: i.users.filter((u) => u.blocked).length,
      admins: i.users.filter((u) => u.role === 'admin').length,
      jobsCreatedToday: i.creation?.created ?? null,
      jobsHoldingAudio: i.accounts.reduce((n, a) => n + a.jobs, 0),
      audioBytes: i.accounts.reduce((n, a) => n + a.doBytes + a.b2Bytes, 0),
      unownedJobs: unowned.jobs, unownedBytes: unowned.bytes,
    },
    limits: { accountAudioBytes: i.accountLimitBytes ?? null, jobsPerAccountPerDay: i.creation?.perAccount ?? null, jobsPerAddressPerDay: i.creation?.perAddress ?? null, jobsPerDay: i.creation?.perDay ?? null },
    storage: i.status ?? null,
    topAccounts: [...users].filter((u) => u.audioBytes > 0).sort((a, b) => b.audioBytes - a.audioBytes).slice(0, 10).map((u) => ({ id: u.id, name: u.nickname || u.name, email: u.email, audioBytes: u.audioBytes, jobs: u.jobsHoldingAudio })),
    users,
    note: 'Last active is recorded at most once an hour. Audio counts include only jobs that currently hold audio.',
  };
};
