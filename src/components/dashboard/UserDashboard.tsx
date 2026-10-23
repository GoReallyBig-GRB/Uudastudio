/**
 * Uuda Pro - User Dashboard
 * 7 Dedicated Sections:
 * 1. Account (Permanent Email Lock, Display Name, Member-since, Sign out)
 * 2. Preferences (Default Voice, Model, Delivery Instruction, Auto-Refresh)
 * 3. Connections (Freesound flag-dependent, Own Gemini Key with browser-only storage)
 * 4. Usage (Informational metrics: Generations & Characters, No Limits)
 * 5. Projects (List, Size, Open, Duplicate, Rename, Delete)
 * 6. Support (Create ticket, status filters, message threads, read-only when closed)
 * 7. Data & Privacy (Download My Data, Delete My Account with 'DELETE' typing confirmation)
 */

import React, { useState, useEffect } from 'react';
import {
  User,
  Sliders,
  Link as LinkIcon,
  BarChart3,
  FolderKanban,
  HelpCircle,
  ShieldAlert,
  Lock,
  ArrowLeft,
  LogOut,
  Save,
  Check,
  AlertTriangle,
  Download,
  Trash2,
  Copy,
  Plus,
  Send,
  MessageSquare,
  Key,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { authService } from '../../services/authService';
import { SupportTicket, UserProjectItem, UsageSummary } from '../../types';

interface UserDashboardProps {
  onBackToStudio: () => void;
  onOpenProject?: (projectId: string) => void;
}

type TabType = 'account' | 'preferences' | 'connections' | 'usage' | 'projects' | 'support' | 'privacy';

export const UserDashboard: React.FC<UserDashboardProps> = ({ onBackToStudio, onOpenProject }) => {
  const { user, signOut, updateProfile, deleteAccount, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('account');

  // Account State
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [accountSuccessMsg, setAccountSuccessMsg] = useState<string | null>(null);
  const [accountErrorMsg, setAccountErrorMsg] = useState<string | null>(null);

  // Preferences State
  const [defaultVoice, setDefaultVoice] = useState(user?.preferences?.defaultVoice || 'Zephyr');
  const [defaultModel, setDefaultModel] = useState(user?.preferences?.defaultModel || 'gemini-3.8-flash-tts');
  const [defaultDelivery, setDefaultDelivery] = useState(user?.preferences?.defaultDelivery || 'Radio commercial style');
  const [autoRefresh, setAutoRefresh] = useState(user?.preferences?.autoRefresh ?? true);
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);
  const [prefsSuccessMsg, setPrefsSuccessMsg] = useState<string | null>(null);

  // Connections State
  const [ownKey, setOwnKey] = useState(authService.getOwnGeminiKey() || '');
  const [freesoundEnabled, setFreesoundEnabled] = useState(false);
  const [keySavedMsg, setKeySavedMsg] = useState<string | null>(null);

  // Usage State
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);

  // Projects State
  const [projects, setProjects] = useState<UserProjectItem[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState('');

  // Support Tickets State
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);
  const [activeTicket, setActiveTicket] = useState<SupportTicket | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [isReplying, setIsReplying] = useState(false);

  // New Ticket Modal
  const [isNewTicketOpen, setIsNewTicketOpen] = useState(false);
  const [newTicketTitle, setNewTicketTitle] = useState('');
  const [newTicketType, setNewTicketType] = useState<SupportTicket['type']>('AI generation issue');
  const [newTicketMessage, setNewTicketMessage] = useState('');
  const [isCreatingTicket, setIsCreatingTicket] = useState(false);

  // Privacy & Deletion State
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteErrorMsg, setDeleteErrorMsg] = useState<string | null>(null);

  // Update initial form values when user changes
  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name);
      setDefaultVoice(user.preferences?.defaultVoice || 'Zephyr');
      setDefaultModel(user.preferences?.defaultModel || 'gemini-3.8-flash-tts');
      setDefaultDelivery(user.preferences?.defaultDelivery || 'Radio commercial style');
      setAutoRefresh(user.preferences?.autoRefresh ?? true);
    }
  }, [user]);

  // Load Freesound status
  useEffect(() => {
    fetch('/api/freesound/config')
      .then((res) => res.json())
      .then((data) => setFreesoundEnabled(Boolean(data.enabled)))
      .catch(() => setFreesoundEnabled(false));
  }, []);

  // Load Tab-specific data
  useEffect(() => {
    if (!user) return;

    if (activeTab === 'usage') {
      setIsLoadingUsage(true);
      fetch('/api/usage/my', { headers: authService.getAuthHeaders() })
        .then((res) => res.json())
        .then((data) => setUsage(data))
        .catch(console.error)
        .finally(() => setIsLoadingUsage(false));
    }

    if (activeTab === 'projects') {
      loadProjects();
    }

    if (activeTab === 'support') {
      loadTickets();
    }
  }, [activeTab, user]);

  const loadProjects = () => {
    setIsLoadingProjects(true);
    fetch('/api/projects', { headers: authService.getAuthHeaders() })
      .then((res) => res.json())
      .then((data) => setProjects(data.projects || []))
      .catch(console.error)
      .finally(() => setIsLoadingProjects(false));
  };

  const loadTickets = () => {
    setIsLoadingTickets(true);
    fetch('/api/tickets/my', { headers: authService.getAuthHeaders() })
      .then((res) => res.json())
      .then((data) => {
        setTickets(data.tickets || []);
        if (activeTicket) {
          const updated = data.tickets.find((t: SupportTicket) => t.id === activeTicket.id);
          if (updated) setActiveTicket(updated);
        }
      })
      .catch(console.error)
      .finally(() => setIsLoadingTickets(false));
  };

  // 1. Account Save
  const handleSaveAccount = async () => {
    setIsSavingAccount(true);
    setAccountErrorMsg(null);
    setAccountSuccessMsg(null);
    try {
      await updateProfile({ display_name: displayName });
      setAccountSuccessMsg('Display name updated successfully.');
      setTimeout(() => setAccountSuccessMsg(null), 3000);
    } catch (err: unknown) {
      setAccountErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingAccount(false);
    }
  };

  // 2. Preferences Save
  const handleSavePreferences = async () => {
    setIsSavingPrefs(true);
    setPrefsSuccessMsg(null);
    try {
      await updateProfile({
        preferences: {
          defaultVoice,
          defaultModel,
          defaultDelivery,
          autoRefresh,
        },
      });
      setPrefsSuccessMsg('Preferences saved across devices.');
      setTimeout(() => setPrefsSuccessMsg(null), 3000);
    } catch (err: unknown) {
      console.error(err);
    } finally {
      setIsSavingPrefs(false);
    }
  };

  // 3. Own Gemini Key Save
  const handleSaveOwnKey = () => {
    authService.setOwnGeminiKey(ownKey);
    setKeySavedMsg('Key saved strictly in this browser.');
    setTimeout(() => setKeySavedMsg(null), 3000);
  };

  const handleRemoveOwnKey = () => {
    authService.setOwnGeminiKey(null);
    setOwnKey('');
    setKeySavedMsg('Key removed. Using standard shared free quota.');
    setTimeout(() => setKeySavedMsg(null), 3000);
  };

  // 5. Projects actions
  const handleDeleteProject = async (id: string) => {
    if (!confirm('Are you sure you want to delete this project?')) return;
    try {
      await fetch(`/api/projects/${id}`, {
        method: 'DELETE',
        headers: authService.getAuthHeaders(),
      });
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const handleDuplicateProject = async (id: string) => {
    try {
      const res = await fetch(`/api/projects/${id}/duplicate`, {
        method: 'POST',
        headers: authService.getAuthHeaders(),
      });
      const data = await res.json();
      if (data.project) {
        setProjects((prev) => [data.project, ...prev]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveRename = async (id: string) => {
    if (!renamingTitle.trim()) return;
    try {
      const target = projects.find((p) => p.id === id);
      if (!target) return;
      await fetch('/api/projects', {
        method: 'POST',
        headers: authService.getAuthHeaders(),
        body: JSON.stringify({
          id,
          name: renamingTitle.trim(),
          data: {},
        }),
      });
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, name: renamingTitle.trim() } : p))
      );
      setRenamingId(null);
    } catch (err) {
      console.error(err);
    }
  };

  // 6. Support Tickets actions
  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTicketTitle.trim() || !newTicketMessage.trim()) return;

    setIsCreatingTicket(true);
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: authService.getAuthHeaders(),
        body: JSON.stringify({
          title: newTicketTitle,
          type: newTicketType,
          initialMessage: newTicketMessage,
        }),
      });
      const data = await res.json();
      if (data.ticket) {
        setTickets((prev) => [data.ticket, ...prev]);
        setIsNewTicketOpen(false);
        setNewTicketTitle('');
        setNewTicketMessage('');
        setActiveTicket(data.ticket);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsCreatingTicket(false);
    }
  };

  const handleSendReply = async () => {
    if (!activeTicket || !replyContent.trim()) return;

    setIsReplying(true);
    try {
      const res = await fetch(`/api/tickets/${activeTicket.id}/reply`, {
        method: 'POST',
        headers: authService.getAuthHeaders(),
        body: JSON.stringify({ content: replyContent }),
      });
      const data = await res.json();
      if (data.ticket) {
        setActiveTicket(data.ticket);
        setTickets((prev) => prev.map((t) => (t.id === data.ticket.id ? data.ticket : t)));
        setReplyContent('');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsReplying(false);
    }
  };

  const handleOpenTicketThread = async (ticket: SupportTicket) => {
    setActiveTicket(ticket);
    if (ticket.has_unread_admin_reply) {
      try {
        await fetch(`/api/tickets/${ticket.id}/mark-read`, {
          method: 'POST',
          headers: authService.getAuthHeaders(),
        });
        refreshUser();
      } catch {
        // ignore
      }
    }
  };

  // 7. Privacy & Deletion actions
  const handleDownloadData = () => {
    window.location.href = '/api/auth/download-data';
  };

  const handleDeleteAccountConfirm = async () => {
    if (deleteConfirmInput !== 'DELETE') {
      setDeleteErrorMsg('Please type DELETE in capital letters to confirm.');
      return;
    }

    setIsDeletingAccount(true);
    setDeleteErrorMsg(null);
    try {
      await deleteAccount('DELETE');
      onBackToStudio();
    } catch (err: unknown) {
      setDeleteErrorMsg(err instanceof Error ? err.message : String(err));
      setIsDeletingAccount(false);
    }
  };

  if (!user) {
    return (
      <div className="fixed inset-0 z-50 bg-[#08080A] flex flex-col items-center justify-center p-6 text-center">
        <h2 className="text-xl font-bold text-white mb-2">Not Signed In</h2>
        <p className="text-sm text-zinc-400 mb-6">Please sign in with Google to access your User Dashboard.</p>
        <button
          onClick={onBackToStudio}
          className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold"
        >
          Back to Studio
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#09090C] text-zinc-100 flex flex-col antialiased select-none font-sans overflow-hidden">
      {/* Top Header */}
      <header className="h-16 px-6 border-b border-zinc-800 bg-[#0E0E12] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={onBackToStudio}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Studio</span>
          </button>
          <div className="h-4 w-px bg-zinc-700/80" />
          <div className="flex items-center gap-2">
            <span className="font-bold text-white text-base">User Dashboard</span>
            <span className="text-[11px] text-zinc-500 font-mono">({user.email})</span>
          </div>
        </div>

        <button
          onClick={signOut}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800/60 hover:bg-rose-950/40 text-zinc-400 hover:text-rose-300 border border-zinc-700/60 text-xs font-medium transition-colors cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Navigation Tabs Sidebar */}
        <nav className="w-60 border-r border-zinc-800 bg-[#0C0C10] p-4 flex flex-col gap-1 shrink-0 overflow-y-auto">
          <div className="px-2.5 py-1 text-[10px] uppercase font-bold tracking-widest text-zinc-500">Settings</div>

          <button
            onClick={() => setActiveTab('account')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
              activeTab === 'account' ? 'bg-cyan-500/15 text-cyan-300 font-semibold border border-cyan-500/30' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <User className="w-4 h-4 shrink-0" />
            <span>Account</span>
          </button>

          <button
            onClick={() => setActiveTab('preferences')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
              activeTab === 'preferences' ? 'bg-cyan-500/15 text-cyan-300 font-semibold border border-cyan-500/30' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <Sliders className="w-4 h-4 shrink-0" />
            <span>Preferences</span>
          </button>

          <button
            onClick={() => setActiveTab('connections')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
              activeTab === 'connections' ? 'bg-cyan-500/15 text-cyan-300 font-semibold border border-cyan-500/30' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <LinkIcon className="w-4 h-4 shrink-0" />
            <span>Connections</span>
          </button>

          <button
            onClick={() => setActiveTab('usage')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
              activeTab === 'usage' ? 'bg-cyan-500/15 text-cyan-300 font-semibold border border-cyan-500/30' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <BarChart3 className="w-4 h-4 shrink-0" />
            <span>Usage</span>
          </button>

          <button
            onClick={() => setActiveTab('projects')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
              activeTab === 'projects' ? 'bg-cyan-500/15 text-cyan-300 font-semibold border border-cyan-500/30' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <FolderKanban className="w-4 h-4 shrink-0" />
            <span>Projects</span>
          </button>

          <button
            onClick={() => setActiveTab('support')}
            className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
              activeTab === 'support' ? 'bg-cyan-500/15 text-cyan-300 font-semibold border border-cyan-500/30' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <HelpCircle className="w-4 h-4 shrink-0" />
              <span>Support</span>
            </div>
            {tickets.some((t) => t.has_unread_admin_reply) && (
              <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(0,240,255,0.8)]" />
            )}
          </button>

          <div className="pt-4 mt-auto border-t border-zinc-800/80">
            <button
              onClick={() => setActiveTab('privacy')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
                activeTab === 'privacy' ? 'bg-rose-500/15 text-rose-300 font-semibold border border-rose-500/30' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>Data & Privacy</span>
            </button>
          </div>
        </nav>

        {/* Viewport Detail Content */}
        <main className="flex-1 bg-[#101014] p-8 overflow-y-auto">
          {/* TAB 1: Account */}
          {activeTab === 'account' && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Account Details</h2>
                <p className="text-xs text-zinc-400 mt-1">Manage your identity and profile within UUDA PRO.</p>
              </div>

              {accountSuccessMsg && (
                <div className="p-3 bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs rounded-lg flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  <span>{accountSuccessMsg}</span>
                </div>
              )}
              {accountErrorMsg && (
                <div className="p-3 bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs rounded-lg flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  <span>{accountErrorMsg}</span>
                </div>
              )}

              <div className="bg-[#15151B] border border-zinc-800 rounded-xl p-6 space-y-5">
                {/* Photo & Basic Info */}
                <div className="flex items-center gap-4 pb-5 border-b border-zinc-800/80">
                  <img
                    src={user.photo_url || `https://api.dicebear.com/7.x/identicon/svg?seed=${user.email}`}
                    alt={user.display_name}
                    className="w-16 h-16 rounded-full object-cover border-2 border-zinc-700 shrink-0"
                  />
                  <div>
                    <h3 className="text-sm font-bold text-white">{user.display_name}</h3>
                    <p className="text-xs text-zinc-400 font-mono">{user.email}</p>
                    <span className="inline-block mt-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-zinc-800 text-cyan-400 border border-zinc-700">
                      {user.role}
                    </span>
                  </div>
                </div>

                {/* Editable Display Name */}
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Display Name</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    minLength={2}
                    maxLength={50}
                    className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-white focus:outline-hidden focus:border-cyan-500"
                  />
                  <p className="text-[11px] text-zinc-500 mt-1">2 to 50 characters.</p>
                </div>

                {/* Permanent Email (Read-Only with Lock Icon) */}
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Google Email (Permanent)</label>
                  <div className="relative">
                    <input
                      type="text"
                      readOnly
                      value={user.email}
                      className="w-full px-3.5 py-2.5 bg-[#0C0C10] border border-zinc-800 rounded-lg text-xs text-zinc-400 font-mono cursor-not-allowed pr-10"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500">
                      <Lock className="w-4 h-4 text-zinc-500" />
                    </div>
                  </div>
                  <p className="text-[11px] text-cyan-400/80 mt-1.5 flex items-center gap-1.5">
                    <Lock className="w-3 h-3" />
                    <span>Your Google account email is permanent for this account.</span>
                  </p>
                </div>

                {/* Member Since Date */}
                <div className="text-xs text-zinc-500 pt-2 border-t border-zinc-800/80 flex items-center justify-between">
                  <span>Member Since:</span>
                  <span className="font-mono text-zinc-400">{new Date(user.created_at).toLocaleDateString()}</span>
                </div>

                {/* Action Save */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleSaveAccount}
                    disabled={isSavingAccount || displayName.trim().length < 2}
                    className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSavingAccount ? 'Saving...' : 'Save Account Changes'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Preferences */}
          {activeTab === 'preferences' && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Studio Preferences</h2>
                <p className="text-xs text-zinc-400 mt-1">Configure your default voiceover synthesis and editor behavior.</p>
              </div>

              {prefsSuccessMsg && (
                <div className="p-3 bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs rounded-lg flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  <span>{prefsSuccessMsg}</span>
                </div>
              )}

              <div className="bg-[#15151B] border border-zinc-800 rounded-xl p-6 space-y-5">
                {/* Default Voice */}
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Default Prebuilt Voice</label>
                  <select
                    value={defaultVoice}
                    onChange={(e) => setDefaultVoice(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-white focus:outline-hidden focus:border-cyan-500"
                  >
                    <optgroup label="Female Voices">
                      <option value="Zephyr">Zephyr (Bright, upbeat & clear)</option>
                      <option value="Kore">Kore (Calm, balanced & articulate)</option>
                      <option value="Vindemiatrix">Vindemiatrix (Polished & broadcast-ready)</option>
                      <option value="Callirrhoe">Callirrhoe (Warm & welcoming)</option>
                      <option value="Despina">Despina (Crisp & professional)</option>
                    </optgroup>
                    <optgroup label="Male Voices">
                      <option value="Puck">Puck (Playful, engaging & dynamic)</option>
                      <option value="Fenrir">Fenrir (Authoritative & resonant)</option>
                      <option value="Charon">Charon (Informative broadcaster)</option>
                      <option value="Iapetus">Iapetus (Classic radio announcer)</option>
                      <option value="Algieba">Algieba (Bright & charismatic)</option>
                    </optgroup>
                  </select>
                </div>

                {/* Default Model */}
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Default Synthesis Model</label>
                  <select
                    value={defaultModel}
                    onChange={(e) => setDefaultModel(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-white focus:outline-hidden focus:border-cyan-500"
                  >
                    <option value="gemini-3.8-flash-tts">Flagship (gemini-3.8-flash-tts)</option>
                    <option value="gemini-3.8-flash-lite-tts">Fast Low-Latency (gemini-3.8-flash-lite-tts)</option>
                  </select>
                </div>

                {/* Default Delivery Instruction */}
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Default Delivery & Style Directive</label>
                  <input
                    type="text"
                    value={defaultDelivery}
                    onChange={(e) => setDefaultDelivery(e.target.value)}
                    placeholder="e.g. Confident commercial reading, energetic punch"
                    className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-white focus:outline-hidden focus:border-cyan-500"
                  />
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Pre-populates new scripts with this delivery direction.
                  </p>
                </div>

                {/* Auto Refresh Toggle */}
                <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-zinc-300 block">Immediate Timeline Repaint</span>
                    <span className="text-[11px] text-zinc-500">Repaint canvas immediately on every trim, cut, or move.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                    className="w-4 h-4 rounded-sm bg-zinc-900 border-zinc-700 text-cyan-500 focus:ring-0 cursor-pointer"
                  />
                </div>

                <div className="pt-3">
                  <button
                    type="button"
                    onClick={handleSavePreferences}
                    disabled={isSavingPrefs}
                    className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSavingPrefs ? 'Saving...' : 'Save Preferences'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Connections */}
          {activeTab === 'connections' && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">API & Service Connections</h2>
                <p className="text-xs text-zinc-400 mt-1">Manage external provider keys and sound libraries.</p>
              </div>

              {keySavedMsg && (
                <div className="p-3 bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs rounded-lg flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  <span>{keySavedMsg}</span>
                </div>
              )}

              {/* Own Gemini API Key */}
              <div className="bg-[#15151B] border border-zinc-800 rounded-xl p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-bold text-white">Own Gemini API Key (Optional)</h3>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  By default, signed-in users share Google's standard free-tier quotas. You can optionally paste your own Google Gemini API key to use your own personal quota.
                </p>

                <div className="p-3 rounded-lg bg-[#0C0C10] border border-zinc-800/80 text-[11px] text-zinc-400">
                  <strong className="text-zinc-300 font-semibold">Security Policy: </strong>
                  Your personal API key is stored <span className="text-cyan-300 font-medium">strictly in this browser</span>. It is sent per request over HTTPS and is never logged or stored on the server.
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Gemini API Key</label>
                  <input
                    type="password"
                    placeholder="AIzaSy..."
                    value={ownKey}
                    onChange={(e) => setOwnKey(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-white font-mono focus:outline-hidden focus:border-cyan-500"
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleSaveOwnKey}
                    disabled={!ownKey.trim()}
                    className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Save Key to Browser
                  </button>
                  {authService.getOwnGeminiKey() && (
                    <button
                      type="button"
                      onClick={handleRemoveOwnKey}
                      className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-rose-950/40 text-zinc-300 hover:text-rose-300 text-xs font-medium transition-colors cursor-pointer"
                    >
                      Remove Key
                    </button>
                  )}
                </div>
              </div>

              {/* Freesound Connection (Shown only when flag is ON) */}
              {freesoundEnabled && (
                <div className="bg-[#15151B] border border-zinc-800 rounded-xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-white">Freesound CC0 Library</h3>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Access over 600,000 Creative Commons sound effects and music loops.
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-950 text-emerald-400 border border-emerald-800">
                      Active
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: Usage (Informational, No Limits) */}
          {activeTab === 'usage' && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Voiceover Usage</h2>
                <p className="text-xs text-zinc-400 mt-1">
                  Track your speech synthesis activity. Usage metrics are purely informational.
                </p>
              </div>

              {isLoadingUsage ? (
                <div className="p-8 text-center text-xs text-zinc-500 font-mono">Loading usage statistics...</div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-[#15151B] border border-zinc-800 rounded-xl p-5">
                    <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">This Month</span>
                    <div className="mt-2 text-2xl font-black text-cyan-400 font-mono">
                      {usage?.thisMonthGenerations ?? 0}
                    </div>
                    <span className="text-xs text-zinc-400 mt-1 block">Voice generations</span>
                    <span className="text-[11px] text-zinc-500 font-mono">
                      {usage?.thisMonthCharacters?.toLocaleString() ?? 0} characters
                    </span>
                  </div>

                  <div className="bg-[#15151B] border border-zinc-800 rounded-xl p-5">
                    <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">All-Time Total</span>
                    <div className="mt-2 text-2xl font-black text-white font-mono">
                      {usage?.totalGenerations ?? 0}
                    </div>
                    <span className="text-xs text-zinc-400 mt-1 block">Total productions</span>
                    <span className="text-[11px] text-zinc-500 font-mono">
                      {usage?.totalCharacters?.toLocaleString() ?? 0} characters
                    </span>
                  </div>
                </div>
              )}

              <div className="p-4 rounded-xl bg-[#15151B] border border-zinc-800/80 text-xs text-zinc-400 leading-relaxed">
                <strong className="text-white">Fair Use Policy: </strong>
                All signed-in accounts receive access to Google's standard free tier for Gemini speech synthesis. A gentle anti-abuse burst limit (10 requests per minute) prevents server flooding.
              </div>
            </div>
          )}

          {/* TAB 5: Projects */}
          {activeTab === 'projects' && (
            <div className="max-w-3xl space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">Your Projects</h2>
                  <p className="text-xs text-zinc-400 mt-1">Multi-track sessions and productions saved to the cloud.</p>
                </div>
              </div>

              {isLoadingProjects ? (
                <div className="p-8 text-center text-xs text-zinc-500 font-mono">Loading projects...</div>
              ) : projects.length === 0 ? (
                <div className="bg-[#15151B] border border-zinc-800 rounded-xl p-8 text-center">
                  <FolderKanban className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                  <h3 className="text-sm font-semibold text-zinc-300">No cloud projects yet</h3>
                  <p className="text-xs text-zinc-500 mt-1">
                    Your local timeline sessions are autosaved in your browser. Save projects to the cloud from the studio.
                  </p>
                </div>
              ) : (
                <div className="bg-[#15151B] border border-zinc-800 rounded-xl divide-y divide-zinc-800/80 overflow-hidden">
                  {projects.map((proj) => (
                    <div key={proj.id} className="p-4 flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        {renamingId === proj.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={renamingTitle}
                              onChange={(e) => setRenamingTitle(e.target.value)}
                              className="px-2 py-1 text-xs bg-zinc-900 border border-zinc-700 rounded text-white"
                              autoFocus
                            />
                            <button
                              onClick={() => handleSaveRename(proj.id)}
                              className="px-2 py-1 bg-cyan-600 text-white text-[11px] rounded"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setRenamingId(null)}
                              className="px-2 py-1 bg-zinc-800 text-zinc-300 text-[11px] rounded"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <h4 className="text-xs font-bold text-white truncate">{proj.name}</h4>
                        )}
                        <div className="flex items-center gap-3 text-[11px] text-zinc-500 mt-1">
                          <span>Updated: {new Date(proj.updated_at).toLocaleDateString()}</span>
                          <span>•</span>
                          <span>{(proj.size_bytes / 1024).toFixed(1)} KB</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {onOpenProject && (
                          <button
                            onClick={() => {
                              onOpenProject(proj.id);
                              onBackToStudio();
                            }}
                            className="px-2.5 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors"
                          >
                            Open
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setRenamingId(proj.id);
                            setRenamingTitle(proj.name);
                          }}
                          className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
                          title="Rename"
                        >
                          <Sliders className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDuplicateProject(proj.id)}
                          className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
                          title="Duplicate"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteProject(proj.id)}
                          className="p-1.5 rounded hover:bg-rose-950/40 text-zinc-400 hover:text-rose-400 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 6: Support Tickets */}
          {activeTab === 'support' && (
            <div className="max-w-3xl space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">Support Desk</h2>
                  <p className="text-xs text-zinc-400 mt-1">Open support tickets and converse directly with studio admins.</p>
                </div>
                {!activeTicket && (
                  <button
                    onClick={() => setIsNewTicketOpen(true)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Create Ticket</span>
                  </button>
                )}
              </div>

              {/* Active Ticket Thread View */}
              {activeTicket ? (
                <div className="bg-[#15151B] border border-zinc-800 rounded-xl overflow-hidden flex flex-col h-[520px]">
                  {/* Thread Header */}
                  <div className="p-4 border-b border-zinc-800 bg-[#121216] flex items-center justify-between shrink-0">
                    <div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setActiveTicket(null)}
                          className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 mr-2"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                          <span>Back</span>
                        </button>
                        <h3 className="text-xs font-bold text-white truncate max-w-sm">{activeTicket.title}</h3>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                            activeTicket.status === 'Open'
                              ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                              : activeTicket.status === 'Resolved'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                          }`}
                        >
                          {activeTicket.status}
                        </span>
                      </div>
                      <span className="text-[11px] text-zinc-500 mt-0.5 block">Category: {activeTicket.type}</span>
                    </div>
                  </div>

                  {/* Thread Message Scroll */}
                  <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[#0E0E12]">
                    {activeTicket.messages.map((msg) => {
                      const isAdminMsg = msg.sender === 'admin';
                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col max-w-[85%] ${
                            isAdminMsg ? 'mr-auto items-start' : 'ml-auto items-end'
                          }`}
                        >
                          <span className="text-[10px] text-zinc-500 font-medium mb-1 px-1">
                            {isAdminMsg ? '🛡️ Admin Support' : 'You'} • {new Date(msg.created_at).toLocaleTimeString()}
                          </span>
                          <div
                            className={`p-3 rounded-xl text-xs leading-relaxed whitespace-pre-wrap ${
                              isAdminMsg
                                ? 'bg-zinc-800/90 text-zinc-100 border border-zinc-700'
                                : 'bg-cyan-600 text-white'
                            }`}
                          >
                            {msg.content}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Thread Reply Bar (Disabled if Closed) */}
                  <div className="p-3 border-t border-zinc-800 bg-[#121216] shrink-0">
                    {activeTicket.status === 'Closed' ? (
                      <div className="text-center text-xs text-zinc-500 py-1 flex items-center justify-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" />
                        <span>This ticket is closed and read-only.</span>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Type your reply..."
                          value={replyContent}
                          onChange={(e) => setReplyContent(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSendReply()}
                          className="flex-1 px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-white focus:outline-hidden focus:border-cyan-500"
                        />
                        <button
                          type="button"
                          onClick={handleSendReply}
                          disabled={isReplying || !replyContent.trim()}
                          className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>{isReplying ? 'Sending...' : 'Send'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Ticket List */
                <div className="bg-[#15151B] border border-zinc-800 rounded-xl divide-y divide-zinc-800/80 overflow-hidden">
                  {isLoadingTickets ? (
                    <div className="p-8 text-center text-xs text-zinc-500 font-mono">Loading support tickets...</div>
                  ) : tickets.length === 0 ? (
                    <div className="p-8 text-center">
                      <MessageSquare className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                      <h3 className="text-sm font-semibold text-zinc-300">No support tickets</h3>
                      <p className="text-xs text-zinc-500 mt-1">
                        Have a question or run into an issue? Create a support ticket above.
                      </p>
                    </div>
                  ) : (
                    tickets.map((t) => (
                      <div
                        key={t.id}
                        onClick={() => handleOpenTicketThread(t)}
                        className="p-4 flex items-center justify-between gap-4 hover:bg-zinc-800/40 cursor-pointer transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs font-bold text-white truncate">{t.title}</h4>
                            {t.has_unread_admin_reply && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-500 text-black uppercase tracking-wider">
                                New Reply
                              </span>
                            )}
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
                              ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
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

          {/* TAB 7: Data and Privacy */}
          {activeTab === 'privacy' && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Data & Privacy</h2>
                <p className="text-xs text-zinc-400 mt-1">Control your personal data, exports, and account deletion.</p>
              </div>

              {/* Download Data Section */}
              <div className="bg-[#15151B] border border-zinc-800 rounded-xl p-6 space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Download className="w-4 h-4 text-cyan-400" />
                  <span>Download My Data (JSON)</span>
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Export a comprehensive JSON package containing your account details, voice synthesis generation history, support tickets, and saved cloud project files.
                </p>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={handleDownloadData}
                    className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download JSON Archive</span>
                  </button>
                </div>
              </div>

              {/* Permanent Account Deletion */}
              <div className="bg-[#181113] border border-rose-900/60 rounded-xl p-6 space-y-4">
                <h3 className="text-sm font-bold text-rose-300 flex items-center gap-2">
                  <Trash2 className="w-4 h-4 text-rose-400" />
                  <span>Delete My Account</span>
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Permanently deletes your account record, cloud projects, audio assets, support tickets, and studio preferences from our servers.
                </p>

                <div className="p-3 bg-rose-950/30 border border-rose-900/50 rounded-lg text-[11px] text-rose-300">
                  <strong>Notice: </strong>
                  This action is irreversible. Signing in with this Google account again in the future will create a completely fresh, empty account.
                </div>

                {deleteErrorMsg && (
                  <div className="text-xs text-rose-400 font-semibold">{deleteErrorMsg}</div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    To confirm, please type <span className="text-rose-400 font-mono">DELETE</span> below:
                  </label>
                  <input
                    type="text"
                    value={deleteConfirmInput}
                    onChange={(e) => setDeleteConfirmInput(e.target.value)}
                    placeholder="DELETE"
                    className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-white font-mono focus:outline-hidden focus:border-rose-500"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleDeleteAccountConfirm}
                    disabled={isDeletingAccount || deleteConfirmInput !== 'DELETE'}
                    className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isDeletingAccount ? 'Deleting Account...' : 'Permanently Delete Account'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* New Support Ticket Modal */}
      {isNewTicketOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#14141A] border border-zinc-800 rounded-xl p-6 shadow-2xl animate-in zoom-in-95">
            <h3 className="text-base font-bold text-white mb-1">Create Support Ticket</h3>
            <p className="text-xs text-zinc-400 mb-4">Submit a technical inquiry or issue report to studio administrators.</p>

            <form onSubmit={handleCreateTicket} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Ticket Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Issue with voice synthesis pace"
                  value={newTicketTitle}
                  onChange={(e) => setNewTicketTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-white focus:outline-hidden focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Category Type</label>
                <select
                  value={newTicketType}
                  onChange={(e) => setNewTicketType(e.target.value as SupportTicket['type'])}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-white focus:outline-hidden focus:border-cyan-500"
                >
                  <option value="AI generation issue">AI generation issue</option>
                  <option value="Account issue">Account issue</option>
                  <option value="Workspace failure">Workspace failure</option>
                  <option value="Technical issue">Technical issue</option>
                  <option value="Performance issue">Performance issue</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Message Details</label>
                <textarea
                  required
                  rows={4}
                  placeholder="Describe what occurred, any error messages shown, and steps to reproduce..."
                  value={newTicketMessage}
                  onChange={(e) => setNewTicketMessage(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-white focus:outline-hidden focus:border-cyan-500 leading-relaxed"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsNewTicketOpen(false)}
                  className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-xs font-semibold hover:bg-zinc-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingTicket || !newTicketTitle.trim() || !newTicketMessage.trim()}
                  className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold disabled:opacity-50"
                >
                  {isCreatingTicket ? 'Submitting...' : 'Submit Ticket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
