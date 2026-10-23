/**
 * Uuda Pro - Admin Panel (Administrators Only)
 * Strictly separated from the User Dashboard with distinct route, layout, and visual identity.
 * Features:
 * - 6-Digit Connection Code Security Gate (for killdasmoke@gmail.com & server allowlist)
 * - Overview Analytics (Signups, DAU, Gens/Day, Chars/Day, 429 Quota Stress, Blocked)
 * - Users Management (Searchable, sortable, single write action: block / unblock)
 * - Support Inbox (All tickets across all users, status filters, reply, status transition)
 * - 'Back to studio' control
 */

import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Users,
  Inbox,
  BarChart,
  ArrowLeft,
  Search,
  Lock,
  Unlock,
  AlertOctagon,
  RefreshCw,
  Send,
  MessageSquare,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  UserCog,
} from 'lucide-react';
import { AdminTeam } from './AdminTeam';
import { useAuth } from '../../hooks/useAuth';
import { authService } from '../../services/authService';
import { AdminOverviewStats, AdminUserRow, SupportTicket } from '../../types';

interface AdminPanelProps {
  onBackToStudio: () => void;
}

type AdminTab = 'overview' | 'users' | 'support' | 'team';

export const AdminPanel: React.FC<AdminPanelProps> = ({ onBackToStudio }) => {
  const { user, isAdmin, isAdminVerified, verifyAdminCode, resendAdminCode } = useAuth();

  // Connection Code Verification State
  const [codeInputValue, setCodeInputValue] = useState('');
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeNotice, setCodeNotice] = useState<string | null>(null);

  // Active Admin Tab
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');

  // Overview Data
  const [overview, setOverview] = useState<AdminOverviewStats | null>(null);
  const [isLoadingOverview, setIsLoadingOverview] = useState(false);

  // Users Data
  const [usersList, setUsersList] = useState<AdminUserRow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<keyof AdminUserRow>('created_at');
  const [sortAsc, setSortAsc] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [blockingUserId, setBlockingUserId] = useState<string | null>(null);

  // Support Inbox Data
  const [ticketsList, setTicketsList] = useState<SupportTicket[]>([]);
  const [statusFilter, setStatusFilter] = useState<'All' | 'Open' | 'Resolved' | 'Closed' | 'Archived'>('All');
  const [activeTicket, setActiveTicket] = useState<SupportTicket | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [replyStatus, setReplyStatus] = useState<SupportTicket['status']>('Resolved');
  const [isReplying, setIsReplying] = useState(false);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);

  // Check for fallback connection code if email was undelivered
  useEffect(() => {
    if (!isAdminVerified && typeof window !== 'undefined') {
      const fallback = (window as any).__uuda_admin_fallback_code;
      if (fallback && typeof fallback === 'string') {
        setCodeNotice(`Email delivery unconfirmed by SMTP. Fallback verification code: ${fallback}`);
        setCodeInputValue(fallback);
      }
    }
  }, [isAdminVerified]);

  // Load Data once verified
  useEffect(() => {
    if (isAdmin && isAdminVerified) {
      if (activeTab === 'overview') loadOverview();
      if (activeTab === 'users') loadUsers();
      if (activeTab === 'support') loadTickets();
    }
  }, [isAdmin, isAdminVerified, activeTab]);

  const loadOverview = async () => {
    setIsLoadingOverview(true);
    try {
      const res = await fetch('/api/admin/overview', { headers: authService.getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setOverview(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingOverview(false);
    }
  };

  const loadUsers = async () => {
    setIsLoadingUsers(true);
    try {
      const res = await fetch('/api/admin/users', { headers: authService.getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setUsersList(data.users || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const loadTickets = async () => {
    setIsLoadingTickets(true);
    try {
      const url = statusFilter === 'All' ? '/api/admin/tickets' : `/api/admin/tickets?status=${statusFilter}`;
      const res = await fetch(url, { headers: authService.getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setTicketsList(data.tickets || []);
        if (activeTicket) {
          const updated = data.tickets.find((t: SupportTicket) => t.id === activeTicket.id);
          if (updated) setActiveTicket(updated);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingTickets(false);
    }
  };

  // Verify Code
  const handleVerifyConnectionCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeInputValue.trim()) return;

    setIsVerifyingCode(true);
    setCodeError(null);
    try {
      await verifyAdminCode(codeInputValue.trim());
    } catch (err: unknown) {
      setCodeError(err instanceof Error ? err.message : 'Invalid connection code.');
    } finally {
      setIsVerifyingCode(false);
    }
  };

  const handleResendCode = async () => {
    try {
      setCodeError(null);
      const message = await resendAdminCode();
      setCodeNotice(message);
      const codeMatch = message.match(/\b\d{6}\b/);
      if (codeMatch) {
        setCodeInputValue(codeMatch[0]);
      }
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : 'Could not send a new code.');
    }
  };

  // Block / Unblock User (Single write action permitted on users)
  const handleToggleBlockUser = async (targetUser: AdminUserRow) => {
    const actionName = targetUser.blocked ? 'unblock' : 'block';
    if (!confirm(`Are you sure you want to ${actionName} user ${targetUser.email}?`)) return;

    setBlockingUserId(targetUser.id);
    try {
      const res = await fetch(`/api/admin/users/${targetUser.id}/block`, {
        method: 'POST',
        headers: authService.getAuthHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setUsersList((prev) =>
          prev.map((u) => (u.id === targetUser.id ? { ...u, blocked: data.user.blocked } : u))
        );
      }
    } catch (err) {
      console.error(err);
    } finally {
      setBlockingUserId(null);
    }
  };

  // Reply to ticket
  const handleAdminReply = async () => {
    if (!activeTicket || !replyMessage.trim()) return;

    setIsReplying(true);
    try {
      const res = await fetch(`/api/admin/tickets/${activeTicket.id}/reply`, {
        method: 'POST',
        headers: authService.getAuthHeaders(),
        body: JSON.stringify({
          content: replyMessage.trim(),
          status: replyStatus,
        }),
      });
      const data = await res.json();
      if (data.ticket) {
        setActiveTicket(data.ticket);
        setTicketsList((prev) => prev.map((t) => (t.id === data.ticket.id ? data.ticket : t)));
        setReplyMessage('');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsReplying(false);
    }
  };

  // 1. Guard against non-admin
  if (!isAdmin) {
    return (
      <div className="fixed inset-0 z-50 bg-[#08080A] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-400 flex items-center justify-center mb-4">
          <AlertOctagon className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">403 Forbidden</h2>
        <p className="text-xs text-zinc-400 mb-6 max-w-sm">
          Access to the Admin Panel is restricted exclusively to authorized administrators.
        </p>
        <button
          onClick={onBackToStudio}
          className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold"
        >
          Back to Studio
        </button>
      </div>
    );
  }

  // 2. Connection Code Security Gate (if not yet verified)
  if (!isAdminVerified) {
    return (
      <div className="fixed inset-0 z-50 bg-[#08080A] flex flex-col items-center justify-center p-6 text-center antialiased">
        <div className="w-full max-w-md bg-[#131318] border border-amber-500/30 rounded-2xl p-8 shadow-2xl relative text-left">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-zinc-800">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Admin Security Verification</h2>
              <p className="text-xs text-zinc-400">Two-Factor Connection Code Required</p>
            </div>
          </div>

          <p className="text-xs text-zinc-300 leading-relaxed mb-4">
            A 6-digit connection code was sent to{' '}
            <strong className="text-amber-300 font-mono">{user?.email}</strong>. Check your inbox and enter the code below to unlock the Admin Panel. It expires in 10 minutes.
          </p>

          {codeNotice && (
            <div className="mb-4 p-3 bg-cyan-950/40 border border-cyan-800/60 rounded-lg text-xs text-cyan-300">
              {codeNotice}
            </div>
          )}

          {codeError && (
            <div className="mb-4 p-3 bg-rose-950/40 border border-rose-800/60 rounded-lg text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{codeError}</span>
            </div>
          )}

          <form onSubmit={handleVerifyConnectionCode} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">6-Digit Code</label>
              <input
                type="text"
                maxLength={6}
                autoFocus
                required
                placeholder="123456"
                value={codeInputValue}
                onChange={(e) => setCodeInputValue(e.target.value.replace(/[^0-9]/g, ''))}
                className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-xl text-center font-mono text-lg tracking-widest text-white focus:outline-hidden focus:border-amber-500"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={handleResendCode}
                className="px-3 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold transition-colors"
              >
                Resend Code
              </button>
              <button
                type="submit"
                disabled={isVerifyingCode || codeInputValue.trim().length !== 6}
                className="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition-all shadow-[0_0_12px_rgba(245,158,11,0.3)] disabled:opacity-50"
              >
                {isVerifyingCode ? 'Verifying...' : 'Unlock Admin Panel'}
              </button>
            </div>
          </form>

          <div className="mt-6 pt-4 border-t border-zinc-800/80 text-center">
            <button
              onClick={onBackToStudio}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Cancel and return to studio
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. Full Verified Admin Panel View
  const filteredUsers = usersList
    .filter(
      (u) =>
        u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.id.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (aVal < bVal) return sortAsc ? -1 : 1;
      if (aVal > bVal) return sortAsc ? 1 : -1;
      return 0;
    });

  return (
    <div className="fixed inset-0 z-50 bg-[#07070A] text-zinc-100 flex flex-col antialiased select-none font-sans overflow-hidden">
      {/* Distinct Admin Header Bar */}
      <header className="h-16 px-6 border-b border-amber-500/20 bg-[#0F0F14] flex items-center justify-between shrink-0 shadow-md">
        <div className="flex items-center gap-4">
          <button
            onClick={onBackToStudio}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Studio</span>
          </button>
          <div className="h-4 w-px bg-zinc-700/80" />
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-amber-400" />
            <h1 className="font-extrabold text-white text-base tracking-wide">Admin Panel</h1>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest bg-amber-500/20 text-amber-300 border border-amber-500/40">
              Verified
            </span>
          </div>
        </div>

        <div className="text-xs text-zinc-400 font-mono">
          Logged in: <span className="text-zinc-200">{user?.email}</span>
        </div>
      </header>

      {/* Main Admin Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Navigation Sidebar */}
        <nav className="w-60 border-r border-zinc-800 bg-[#0B0B0F] p-4 flex flex-col gap-1 shrink-0">
          <div className="px-2.5 py-1 text-[10px] uppercase font-bold tracking-widest text-zinc-500">Administration</div>

          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
              activeTab === 'overview'
                ? 'bg-amber-500/15 text-amber-300 font-semibold border border-amber-500/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <BarChart className="w-4 h-4 shrink-0" />
            <span>Overview & Spend</span>
          </button>

          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
              activeTab === 'users'
                ? 'bg-amber-500/15 text-amber-300 font-semibold border border-amber-500/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <Users className="w-4 h-4 shrink-0" />
            <span>Users & Access</span>
          </button>

          <button
            onClick={() => setActiveTab('support')}
            className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
              activeTab === 'support'
                ? 'bg-amber-500/15 text-amber-300 font-semibold border border-amber-500/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Inbox className="w-4 h-4 shrink-0" />
              <span>Support Inbox</span>
            </div>
            {ticketsList.some((t) => t.status === 'Open') && (
              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500 text-black">
                {ticketsList.filter((t) => t.status === 'Open').length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('team')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
              activeTab === 'team'
                ? 'bg-amber-500/15 text-amber-300 font-semibold border border-amber-500/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <UserCog className="w-4 h-4 shrink-0" />
            <span>Admin Team & Activity</span>
          </button>
        </nav>

        {/* Viewport Detail Content */}
        <main className="flex-1 bg-[#101015] p-8 overflow-y-auto">
          {/* TAB 1: Overview */}
          {activeTab === 'team' && <AdminTeam />}

          {activeTab === 'overview' && (
            <div className="max-w-4xl space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">Studio Metrics Overview</h2>
                  <p className="text-xs text-zinc-400 mt-1">Live counters for sign-ups, active users, speech synthesis volume, and quota stress.</p>
                </div>
                <button
                  onClick={loadOverview}
                  className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                  title="Refresh Metrics"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              {isLoadingOverview ? (
                <div className="p-8 text-center text-xs text-zinc-500 font-mono">Loading overview...</div>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  {/* Total Sign-Ups */}
                  <div className="bg-[#15151B] border border-zinc-800 rounded-xl p-5">
                    <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">Total Sign-Ups</span>
                    <div className="mt-2 text-2xl font-black text-white font-mono">{overview?.totalSignups ?? 0}</div>
                    <span className="text-xs text-zinc-400 mt-1 block">Registered accounts</span>
                  </div>

                  {/* Daily Active Users */}
                  <div className="bg-[#15151B] border border-zinc-800 rounded-xl p-5">
                    <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">Daily Active Users</span>
                    <div className="mt-2 text-2xl font-black text-amber-400 font-mono">
                      {overview?.dailyActiveUsers ?? 0}
                    </div>
                    <span className="text-xs text-zinc-400 mt-1 block">Active in last 24h</span>
                  </div>

                  {/* Blocked Accounts */}
                  <div className="bg-[#15151B] border border-zinc-800 rounded-xl p-5">
                    <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">Blocked Accounts</span>
                    <div className="mt-2 text-2xl font-black text-rose-400 font-mono">
                      {overview?.blockedUsersCount ?? 0}
                    </div>
                    <span className="text-xs text-zinc-400 mt-1 block">Deactivated users</span>
                  </div>

                  {/* Voice Generations Per Day */}
                  <div className="bg-[#15151B] border border-zinc-800 rounded-xl p-5">
                    <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">Voice Generations / Day</span>
                    <div className="mt-2 text-2xl font-black text-cyan-400 font-mono">
                      {overview?.voiceGenerationsPerDay ?? 0}
                    </div>
                    <span className="text-[11px] text-zinc-500 font-mono">
                      All-time: {overview?.totalVoiceGenerations ?? 0}
                    </span>
                  </div>

                  {/* Characters Per Day */}
                  <div className="bg-[#15151B] border border-zinc-800 rounded-xl p-5">
                    <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">Characters / Day</span>
                    <div className="mt-2 text-2xl font-black text-indigo-300 font-mono">
                      {overview?.charactersPerDay?.toLocaleString() ?? 0}
                    </div>
                    <span className="text-[11px] text-zinc-500 font-mono">
                      All-time: {overview?.totalCharacters?.toLocaleString() ?? 0}
                    </span>
                  </div>

                  {/* 429 Quota Stress Counter */}
                  <div className="bg-[#181113] border border-rose-900/40 rounded-xl p-5">
                    <span className="text-[10px] uppercase font-bold tracking-widest text-rose-400">
                      429 Quota Errors / Day
                    </span>
                    <div className="mt-2 text-2xl font-black text-rose-400 font-mono">
                      {overview?.quotaErrorsPerDay ?? 0}
                    </div>
                    <span className="text-[11px] text-rose-400/80">
                      Shared quota stress indicator (All-time: {overview?.totalQuotaErrors ?? 0})
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Users Management */}
          {activeTab === 'users' && (
            <div className="max-w-5xl space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">Users Management</h2>
                  <p className="text-xs text-zinc-400 mt-1">Review accounts, monitor production activity, and manage access.</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                      type="text"
                      placeholder="Search email, name or ID..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded-lg text-white w-64 focus:outline-hidden focus:border-amber-500"
                    />
                  </div>
                  <button
                    onClick={loadUsers}
                    className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                    title="Refresh"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {isLoadingUsers ? (
                <div className="p-8 text-center text-xs text-zinc-500 font-mono">Loading user directory...</div>
              ) : (
                <div className="bg-[#15151B] border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-[#121217] text-[10px] uppercase font-bold tracking-wider text-zinc-400">
                        <th className="py-3 px-4">User</th>
                        <th className="py-3 px-4">Role</th>
                        <th className="py-3 px-4">Signed Up</th>
                        <th className="py-3 px-4">Last Active</th>
                        <th className="py-3 px-4">Gens</th>
                        <th className="py-3 px-4">Projects</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/80">
                      {filteredUsers.map((u) => (
                        <tr key={u.id} className="hover:bg-zinc-800/30 transition-colors">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2.5">
                              <img
                                src={u.photo_url || `https://api.dicebear.com/7.x/identicon/svg?seed=${u.email}`}
                                alt={u.display_name}
                                className="w-7 h-7 rounded-full object-cover border border-zinc-700 shrink-0"
                              />
                              <div>
                                <div className="font-bold text-white flex items-center gap-1.5">
                                  <span>{u.display_name}</span>
                                  {u.blocked && (
                                    <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-rose-950 text-rose-300 border border-rose-800">
                                      Blocked
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-zinc-400 font-mono">{u.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                u.role === 'admin'
                                  ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                  : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                              }`}
                            >
                              {u.role}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-zinc-400 font-mono">
                            {new Date(u.created_at).toLocaleDateString()}
                          </td>
                          <td className="py-3 px-4 text-zinc-400 font-mono">
                            {new Date(u.last_active_at).toLocaleDateString()}
                          </td>
                          <td className="py-3 px-4 font-mono font-semibold text-cyan-300">
                            {u.voice_generations_count}
                          </td>
                          <td className="py-3 px-4 font-mono text-zinc-300">{u.projects_count}</td>
                          <td className="py-3 px-4 text-right">
                            {/* One write action: block or unblock */}
                            <button
                              onClick={() => handleToggleBlockUser(u)}
                              disabled={blockingUserId === u.id || u.role === 'admin'}
                              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                                u.blocked
                                  ? 'bg-emerald-950/60 hover:bg-emerald-900 text-emerald-300 border border-emerald-800'
                                  : 'bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800'
                              } disabled:opacity-40`}
                            >
                              {u.blocked ? 'Unblock' : 'Block'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Support Inbox */}
          {activeTab === 'support' && (
            <div className="max-w-4xl space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">Support Inbox</h2>
                  <p className="text-xs text-zinc-400 mt-1">Review inquiries, respond to tickets, and update resolution statuses.</p>
                </div>
                <div className="flex items-center gap-1.5 bg-[#14141A] p-1 rounded-lg border border-zinc-800 text-xs">
                  {(['All', 'Open', 'Resolved', 'Closed', 'Archived'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                        statusFilter === s ? 'bg-amber-600 text-white font-bold' : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Support Detail View or List */}
              {activeTicket ? (
                <div className="bg-[#15151B] border border-zinc-800 rounded-xl overflow-hidden flex flex-col h-[520px]">
                  {/* Header */}
                  <div className="p-4 border-b border-zinc-800 bg-[#121217] flex items-center justify-between shrink-0">
                    <div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setActiveTicket(null)}
                          className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 mr-2"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                          <span>Back to Inbox</span>
                        </button>
                        <h3 className="text-xs font-bold text-white truncate max-w-sm">{activeTicket.title}</h3>
                        <span className="text-[10px] font-mono text-zinc-400">({activeTicket.user_email})</span>
                      </div>
                      <span className="text-[11px] text-zinc-500 mt-0.5 block">Category: {activeTicket.type}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        value={replyStatus}
                        onChange={(e) => setReplyStatus(e.target.value as SupportTicket['status'])}
                        className="px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs text-white"
                      >
                        <option value="Open">Open</option>
                        <option value="Resolved">Resolved</option>
                        <option value="Closed">Closed</option>
                        <option value="Archived">Archived</option>
                      </select>
                    </div>
                  </div>

                  {/* Thread Scroll */}
                  <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[#0E0E12]">
                    {activeTicket.messages.map((msg) => {
                      const isAdminMsg = msg.sender === 'admin';
                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col max-w-[85%] ${
                            isAdminMsg ? 'ml-auto items-end' : 'mr-auto items-start'
                          }`}
                        >
                          <span className="text-[10px] text-zinc-500 font-medium mb-1 px-1">
                            {isAdminMsg ? '🛡️ You (Admin)' : `${activeTicket.user_name} (${activeTicket.user_email})`} •{' '}
                            {new Date(msg.created_at).toLocaleTimeString()}
                          </span>
                          <div
                            className={`p-3 rounded-xl text-xs leading-relaxed whitespace-pre-wrap ${
                              isAdminMsg
                                ? 'bg-amber-600 text-black font-medium'
                                : 'bg-zinc-800 text-zinc-100 border border-zinc-700'
                            }`}
                          >
                            {msg.content}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Admin Reply Bar */}
                  <div className="p-3 border-t border-zinc-800 bg-[#121217] shrink-0 flex gap-2">
                    <input
                      type="text"
                      placeholder="Type admin reply..."
                      value={replyMessage}
                      onChange={(e) => setReplyMessage(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAdminReply()}
                      className="flex-1 px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-white focus:outline-hidden focus:border-amber-500"
                    />
                    <button
                      type="button"
                      onClick={handleAdminReply}
                      disabled={isReplying || !replyMessage.trim()}
                      className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-black text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{isReplying ? 'Sending...' : 'Send Reply'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* Ticket List */
                <div className="bg-[#15151B] border border-zinc-800 rounded-xl divide-y divide-zinc-800/80 overflow-hidden">
                  {isLoadingTickets ? (
                    <div className="p-8 text-center text-xs text-zinc-500 font-mono">Loading tickets...</div>
                  ) : ticketsList.length === 0 ? (
                    <div className="p-8 text-center text-xs text-zinc-500">No support tickets found in this view.</div>
                  ) : (
                    ticketsList.map((t) => (
                      <div
                        key={t.id}
                        onClick={() => {
                          setActiveTicket(t);
                          setReplyStatus(t.status);
                        }}
                        className="p-4 flex items-center justify-between gap-4 hover:bg-zinc-800/40 cursor-pointer transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs font-bold text-white truncate">{t.title}</h4>
                            <span className="text-[11px] text-zinc-400 font-mono">from {t.user_email}</span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-zinc-500 mt-1">
                            <span>{t.type}</span>
                            <span>•</span>
                            <span>{t.messages.length} messages</span>
                            <span>•</span>
                            <span>Updated {new Date(t.updated_at).toLocaleDateString()}</span>
                          </div>
                        </div>

                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider shrink-0 ${
                            t.status === 'Open'
                              ? 'bg-amber-950 text-amber-300 border border-amber-800'
                              : t.status === 'Resolved'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                          }`}
                        >
                          {t.status}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
