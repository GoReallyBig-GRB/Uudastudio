/** Header cluster: Live (upcoming live events), Voice (voice-talent jobs), Client (jobs where a client has taken part). */
import React, { useEffect, useRef, useState } from 'react';
import { CalendarPlus, Mic, Radio, Users, Zap } from 'lucide-react';
import { countdown, formatWhen, upcomingEvents } from './events';
import type { LiveState } from './useLiveEvents';

interface Props {
  live: LiveState;
  onVoice: () => void;
  onClient: () => void;
  /** Opens the Live events panel; with an id, on that event's invite window */
  onManage: (eventId?: string) => void;
  onQuick: () => void;
}

const BTN = 'flex h-9 items-center gap-1.5 px-3 text-xs font-medium text-ink-dim transition-colors hover:bg-white/5 hover:text-ink cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 max-[1450px]:px-2.5';

export const GuestCluster: React.FC<Props> = ({ live, onVoice, onClient, onManage, onQuick }) => {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  useEffect(() => { const c = () => setOpen(false); window.addEventListener('xpro:close-popups', c); return () => window.removeEventListener('xpro:close-popups', c); }, []);

  const upcoming = upcomingEvents(live.events);
  const liveNow = upcoming.some((e) => e.state === 'open');

  return (
    <div ref={box} className="relative flex shrink-0 items-center divide-x divide-line overflow-visible rounded-full border border-line-strong bg-surface-2" role="group" aria-label="Guests">
      <button type="button" onClick={() => { window.dispatchEvent(new CustomEvent('xpro:close-popups')); setOpen((o) => !o); if (!open) void live.refresh(); }} aria-expanded={open} aria-haspopup="menu" title="Live guests: upcoming live events" className={`${BTN} rounded-l-full`}>
        <span className="relative"><Radio className="h-3.5 w-3.5" />{liveNow && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-ok" aria-hidden />}</span>
        <span className="max-[1450px]:hidden">Live</span>
      </button>
      <button type="button" onClick={() => { setOpen(false); onVoice(); }} title="Voice guests: open the jobs panel" className={BTN}>
        <Mic className="h-3.5 w-3.5" /><span className="max-[1450px]:hidden">Voice</span>
      </button>
      <button type="button" onClick={() => { setOpen(false); onClient(); }} title="Client guests: jobs where a client has taken part" className={`${BTN} rounded-r-full`}>
        <Users className="h-3.5 w-3.5" /><span className="max-[1450px]:hidden">Client</span>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-11 z-50 w-80 rounded-card border border-line-strong bg-surface-1 p-2 shadow-float">
          <div className="mb-1 flex gap-2 p-1">
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onQuick(); }} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-control bg-accent text-xs font-semibold text-accent-ink hover:brightness-110 cursor-pointer"><Zap className="h-3.5 w-3.5" />Quick event</button>
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onManage(); }} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-control border border-line-strong bg-surface-2 text-xs font-medium text-ink hover:bg-surface-3 cursor-pointer"><CalendarPlus className="h-3.5 w-3.5" />Schedule</button>
          </div>
          {live.service === 'signin' && <p className="px-3 py-4 text-center text-xs text-ink-dim">Sign in with Google to schedule live events.</p>}
          {live.service === 'none' && <p className="px-3 py-4 text-center text-xs text-ink-dim">Live events are not available on this server yet.</p>}
          {live.service === 'ok' && upcoming.length === 0 && <p className="px-3 py-4 text-center text-xs text-ink-faint">No upcoming live events.</p>}
          {upcoming.length > 0 && (
            <ul className="max-h-72 overflow-y-auto" aria-label="Upcoming live events">
              {upcoming.map((e, i) => (
                <li key={e.id}>
                  <button type="button" role="menuitem" onClick={() => { setOpen(false); onManage(e.id); }} className="flex w-full items-center gap-3 rounded-control px-3 py-2 text-left hover:bg-surface-3 cursor-pointer">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${e.state === 'open' ? 'bg-ok' : 'bg-line-strong'}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{e.title}</span>
                      <span className="block truncate text-[11px] text-ink-dim">{e.state === 'open' ? 'Live now' : e.startsAt ? `${formatWhen(e.startsAt)} · ${countdown(e.startsAt - live.now)}` : ''}</span>
                    </span>
                    {i === 0 && <span className="shrink-0 rounded border border-accent/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent">{e.state === 'open' ? 'Now' : 'Next'}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
