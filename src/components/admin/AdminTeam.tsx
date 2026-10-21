/**
 * Uuda Studio - Admin team and activity log.
 * Every administrator can see the team and the log. Only the super admin can add or remove administrators.
 */

import React, { useEffect, useState } from 'react';
import { UserPlus, Trash2, Crown, History } from 'lucide-react';
import { authService } from '../../services/authService';

interface TeamAdmin {
  email: string;
  source: 'configured' | 'added';
  super: boolean;
  added_by: string;
  added_at: string;
}
interface AuditRow {
  id: string;
  at: string;
  actor_email: string;
  action: string;
  target: string;
  detail?: string;
}

export const AdminTeam: React.FC = () => {
  const [admins, setAdmins] = useState<TeamAdmin[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [a, l] = await Promise.all([
        fetch('/api/admin/admins', { headers: authService.getAuthHeaders(), credentials: 'same-origin' }),
        fetch('/api/admin/audit', { headers: authService.getAuthHeaders(), credentials: 'same-origin' }),
      ]);
      if (a.ok) {
        const data = await a.json();
        setAdmins(data.admins || []);
        setCanManage(!!data.canManage);
      }
      if (l.ok) setAudit((await l.json()).entries || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/admin/admins', {
        method: 'POST',
        headers: authService.getAuthHeaders(),
        credentials: 'same-origin',
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not add the administrator.');
      setEmail('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (target: string) => {
    if (!window.confirm(`Remove admin access for ${target}?`)) return;
    setError(null);
    const res = await fetch(`/api/admin/admins/${encodeURIComponent(target)}`, {
      method: 'DELETE',
      headers: authService.getAuthHeaders(),
      credentials: 'same-origin',
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || 'Could not remove the administrator.');
    await load();
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-lg font-bold text-white">Admin team</h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          Administrators must confirm each sign-in with an emailed code. Only the super admin can change this list.
        </p>
      </div>

      {error && <div className="p-2.5 rounded-lg bg-rose-950/60 border border-rose-800 text-xs text-rose-200">{error}</div>}

      <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800">
        {admins.map((a) => (
          <div key={a.email} className="flex items-center justify-between px-4 py-2.5 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              {a.super && <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
              <span className="text-zinc-200 truncate">{a.email}</span>
              <span className="text-[10px] text-zinc-500">
                {a.super ? 'super admin' : a.source === 'configured' ? 'set in server settings' : `added by ${a.added_by}`}
              </span>
            </div>
            {canManage && a.source === 'added' && (
              <button
                type="button"
                onClick={() => remove(a.email)}
                className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-rose-300 cursor-pointer"
                title="Remove admin access"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
        {admins.length === 0 && <div className="px-4 py-3 text-xs text-zinc-500">No administrators found.</div>}
      </div>

      {canManage && (
        <form onSubmit={add} className="flex items-center gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Google account email to make an administrator"
            className="flex-1 bg-[#09090D] border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
          />
          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Add admin</span>
          </button>
        </form>
      )}

      <div>
        <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-zinc-200">
          <History className="w-4 h-4 text-zinc-400" />
          <span>Recent admin activity</span>
        </div>
        <div className="rounded-xl border border-zinc-800 max-h-80 overflow-y-auto divide-y divide-zinc-800/70">
          {audit.map((r) => (
            <div key={r.id} className="px-4 py-2 text-[11px] text-zinc-400 flex flex-wrap gap-x-2">
              <span className="text-zinc-500">{new Date(r.at).toLocaleString()}</span>
              <span className="text-zinc-200">{r.actor_email}</span>
              <span className="text-amber-300">{r.action}</span>
              <span>{r.target}</span>
              {r.detail && <span className="text-zinc-500">({r.detail})</span>}
            </div>
          ))}
          {audit.length === 0 && <div className="px-4 py-3 text-xs text-zinc-500">Nothing recorded yet.</div>}
        </div>
      </div>
    </div>
  );
};
