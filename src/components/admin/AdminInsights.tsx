/**
 * Admin account overview (read-only): every account with its name, nickname, email, dates and audio held,
 * plus usage metrics. Served by the Worker at /api/admin/insights, for the admin account only.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { authService } from '../../services/authService';

interface InsightUser {
  id: string; name: string; nickname: string; email: string; role: 'user' | 'admin'; blocked: boolean;
  createdAt: string; lastActiveAt: string; jobsHoldingAudio: number; audioBytes: number;
}
interface Insights {
  generatedAt: string;
  metrics: {
    users: number; newLast7Days: number; activeLast7Days: number; activeLast30Days: number; blocked: number; admins: number;
    jobsCreatedToday: number | null; jobsHoldingAudio: number; audioBytes: number; unownedJobs: number; unownedBytes: number;
  };
  limits: { accountAudioBytes: number | null; jobsPerAccountPerDay: number | null; jobsPerAddressPerDay: number | null; jobsPerDay: number | null };
  storage: { totalBytes?: number; limitBytes?: number; mode?: string; overflow?: { routing: string; b2Bytes: number; b2LimitBytes: number } } | null;
  topAccounts: { id: string; name: string; email: string; audioBytes: number; jobs: number }[];
  users: InsightUser[];
  note: string;
}

const mb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`);
const when = (iso: string) => { const t = Date.parse(iso); return t ? new Date(t).toLocaleString() : ''; };

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="bg-surface-2 border border-line rounded-card p-3">
    <div className="text-[11px] text-ink-dim">{label}</div>
    <div className="text-lg font-bold text-ink">{value}</div>
  </div>
);

export const AdminInsights: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  const load = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/admin/insights', { headers: authService.getAuthHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || 'Could not load the overview.');
      setData(body as Insights);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.users ?? []).filter((u) => !s || `${u.name} ${u.nickname} ${u.email}`.toLowerCase().includes(s));
  }, [data, q]);

  return (
    <div className="fixed inset-0 z-50 bg-surface-0 overflow-y-auto antialiased">
      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <button onClick={onBack} className="flex items-center gap-2 text-xs font-semibold text-ink-dim hover:text-ink"><ArrowLeft className="w-4 h-4" /> Back</button>
          <button onClick={() => void load()} disabled={busy} className="flex items-center gap-2 px-3 py-1.5 rounded-control bg-surface-2 hover:bg-surface-3 text-xs font-semibold text-ink disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> Refresh</button>
        </div>
        <h1 className="text-lg font-bold text-ink mb-4">Accounts and usage</h1>
        {error && <div role="alert" className="mb-4 p-3 rounded-control border border-warn/40 bg-warn/10 text-xs text-warn">{error}</div>}
        {data && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <Stat label="Accounts" value={data.metrics.users} />
              <Stat label="New in 7 days" value={data.metrics.newLast7Days} />
              <Stat label="Active in 7 days" value={data.metrics.activeLast7Days} />
              <Stat label="Active in 30 days" value={data.metrics.activeLast30Days} />
              <Stat label="Jobs created today" value={data.metrics.jobsCreatedToday ?? 'n/a'} />
              <Stat label="Jobs holding audio" value={data.metrics.jobsHoldingAudio} />
              <Stat label="Audio held" value={mb(data.metrics.audioBytes)} />
              <Stat label="Blocked accounts" value={data.metrics.blocked} />
            </div>
            <div className="text-xs text-ink-dim mb-4 leading-relaxed">
              {data.storage?.limitBytes ? <>Main storage {mb(data.storage.totalBytes ?? 0)} of {mb(data.storage.limitBytes)}. </> : null}
              {data.storage?.overflow ? <>Overflow storage {mb(data.storage.overflow.b2Bytes)} of {mb(data.storage.overflow.b2LimitBytes)}, new files going to {data.storage.overflow.routing === 'b2' ? 'overflow' : 'main'} storage. </> : null}
              {data.limits.accountAudioBytes ? <>Each account may hold {mb(data.limits.accountAudioBytes)}. </> : null}
              {data.limits.jobsPerAccountPerDay ? <>Jobs per day: {data.limits.jobsPerAccountPerDay} per account, {data.limits.jobsPerAddressPerDay} per network, {data.limits.jobsPerDay} in total. </> : null}
              {data.metrics.unownedJobs > 0 ? <>{data.metrics.unownedJobs} jobs ({mb(data.metrics.unownedBytes)}) have no listed account.</> : null}
            </div>
            {data.topAccounts.length > 0 && (
              <div className="mb-4">
                <h2 className="text-xs font-bold text-ink mb-2">Largest accounts by audio</h2>
                <ul className="text-xs text-ink-dim space-y-1">
                  {data.topAccounts.map((a) => <li key={a.id}><span className="text-ink font-semibold">{a.name}</span> ({a.email}): {mb(a.audioBytes)} in {a.jobs} jobs</li>)}
                </ul>
              </div>
            )}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, nickname or email" aria-label="Search accounts" className="w-full mb-3 px-3 py-2 bg-surface-1 border border-line-strong rounded-control text-xs text-ink focus:outline-hidden focus:border-accent" />
            <div className="overflow-x-auto border border-line rounded-card">
              <table className="w-full text-xs text-left">
                <thead className="bg-surface-2 text-ink-dim">
                  <tr>{['Name', 'Nickname', 'Email', 'Created', 'Last active', 'Jobs', 'Audio', 'Status'].map((h) => <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((u) => (
                    <tr key={u.id} className="border-t border-line text-ink">
                      <td className="px-3 py-2 whitespace-nowrap">{u.name}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{u.nickname || <span className="text-ink-faint">none</span>}</td>
                      <td className="px-3 py-2 font-mono">{u.email}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{when(u.createdAt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{when(u.lastActiveAt)}</td>
                      <td className="px-3 py-2">{u.jobsHoldingAudio}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{mb(u.audioBytes)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{u.blocked ? 'Blocked' : u.role === 'admin' ? 'Admin' : 'Active'}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-ink-dim">No accounts match.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-ink-faint mt-3">{data.note}</p>
          </>
        )}
      </div>
    </div>
  );
};
