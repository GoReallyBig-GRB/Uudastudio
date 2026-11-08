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
        <h2 className="text-lg font-bold text-ink">Admin team</h2>
        <p className="text-xs text-ink-faint mt-0.5">
          Administrators must confirm each sign-in with an emailed code. Only the super admin can change this list.
        </p>
      </div>

      {error && <div className="p-2.5 rounded-control bg-danger/60 border border-danger text-xs text-danger">{error}</div>}

      <div className="rounded-card border border-line divide-y divide-line">
        {admins.map((a) => (
          <div key={a.email} className="flex items-center justify-between px-4 py-2.5 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              {a.super && <Crown className="w-3.5 h-3.5 text-warn shrink-0" />}
              <span className="text-ink truncate">{a.email}</span>
              <span className="text-[10px] text-ink-faint">
                {a.super ? 'super admin' : a.source === 'configured' ? 'set in server settings' : `added by ${a.added_by}`}
              </span>
            </div>
            {canManage && a.source === 'added' && (
              <button
                type="button"
                onClick={() => remove(a.email)}
                className="p-1.5 rounded hover:bg-surface-2 text-ink-dim hover:text-danger cursor-pointer"
                title="Remove admin access"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
        {admins.length === 0 && <div className="px-4 py-3 text-xs text-ink-faint">No administrators found.</div>}
      </div>

      {canManage && (
        <form onSubmit={add} className="flex items-center gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Google account email to make an administrator"
            className="flex-1 bg-surface-2 border border-line-strong rounded-control px-3 py-2 text-xs text-ink focus:outline-none focus:border-warn"
          />
          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-control bg-warn hover:bg-warn text-ink text-xs font-bold disabled:opacity-50 cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Add admin</span>
          </button>
        </form>
      )}

      <div>
        <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-ink">
          <History className="w-4 h-4 text-ink-dim" />
          <span>Recent admin activity</span>
        </div>
        <div className="rounded-card border border-line max-h-80 overflow-y-auto divide-y divide-line/70">
          {audit.map((r) => (
            <div key={r.id} className="px-4 py-2 text-[11px] text-ink-dim flex flex-wrap gap-x-2">
              <span className="text-ink-faint">{new Date(r.at).toLocaleString()}</span>
              <span className="text-ink">{r.actor_email}</span>
              <span className="text-warn">{r.action}</span>
              <span>{r.target}</span>
              {r.detail && <span className="text-ink-faint">({r.detail})</span>}
            </div>
          ))}
          {audit.length === 0 && <div className="px-4 py-3 text-xs text-ink-faint">Nothing recorded yet.</div>}
        </div>
      </div>
    </div>
  );
};
