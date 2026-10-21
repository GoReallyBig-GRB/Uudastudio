/**
 * Uuda Studio - Messages panel (sidebar)
 * Support conversations with an unread marker. Opening one takes the user to the Support page of their dashboard.
 */

import React, { useEffect, useState } from 'react';
import { MessageSquare, X, Loader2, LifeBuoy } from 'lucide-react';
import { authService } from '../services/authService';
import { SupportTicket } from '../types';

interface MessagesPanelProps {
  signedIn: boolean;
  onOpenSupport: () => void;
  onClose: () => void;
}

export const MessagesPanel: React.FC<MessagesPanelProps> = ({ signedIn, onOpenSupport, onClose }) => {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/tickets/my', { headers: authService.getAuthHeaders(), credentials: 'same-origin' });
        if (res.ok && !cancelled) setTickets((await res.json()).tickets || []);
      } catch {
        /* keep what is shown */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [signedIn]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="h-11 px-3 flex items-center justify-between border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
          <MessageSquare className="w-4 h-4 text-cyan-400" />
          <span>Messages</span>
          {loading && <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />}
        </div>
        <button type="button" onClick={onClose} className="text-zinc-500 hover:text-white cursor-pointer" title="Collapse">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {!signedIn && <p className="p-3 text-xs text-zinc-500">Sign in to see replies from support.</p>}
        {signedIn && tickets.length === 0 && !loading && (
          <p className="p-3 text-xs text-zinc-500">No conversations yet. Use Support in your dashboard to contact us.</p>
        )}
        {tickets.map((t) => {
          const last = t.messages[t.messages.length - 1];
          return (
            <button
              key={t.id}
              type="button"
              onClick={onOpenSupport}
              className="w-full text-left p-2.5 rounded-lg bg-[#16161C] hover:bg-[#1B1B23] border border-zinc-800 cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-zinc-100 truncate">{t.title}</span>
                {t.has_unread_admin_reply && <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0" title="New reply" />}
              </div>
              <div className="text-[10px] text-zinc-500 mt-0.5">
                {t.status} - {new Date(t.updated_at).toLocaleDateString()}
              </div>
              {last && <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2">{last.content}</p>}
            </button>
          );
        })}
      </div>

      <div className="p-2 border-t border-zinc-800 shrink-0">
        <button
          type="button"
          onClick={onOpenSupport}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold cursor-pointer"
        >
          <LifeBuoy className="w-3.5 h-3.5" />
          <span>Open Support</span>
        </button>
      </div>
    </div>
  );
};
