/** Sidebar panel under Jobs: create and schedule live events, open or end them, and send the invite. */
import React, { useEffect, useState } from 'react';
import { CalendarPlus, Copy, MessageCircle, Mail, Pencil, Play, Radio, Square, Trash2, X, Zap } from 'lucide-react';
import { Button, ModalShell } from '../components/ui';
import { LiveEventEditor } from './LiveEventEditor';
import { countdown, formatWhen, inviteMessage, joinLink, mailtoUrl, orderEvents, whatsappUrl, type LiveEvent } from './events';
import type { LiveState } from './useLiveEvents';

interface Props {
  live: LiveState;
  hostName: string;
  onClose: () => void;
  /** Set by the Live button in the header: show this event's share window on arrival */
  focusId?: string | null;
}

const badge = (e: LiveEvent, now: number) =>
  e.state === 'open' ? { text: 'Live now', cls: 'bg-ok text-surface-0 border-ok' }
    : e.state === 'ended' ? { text: 'Ended', cls: 'text-ink-faint border-line' }
      : { text: e.startsAt ? `Starts ${countdown(e.startsAt - now)}` : 'Not open', cls: 'text-accent border-accent/40' };

export const LiveEventsPanel: React.FC<Props> = ({ live, hostName, onClose, focusId }) => {
  const [editing, setEditing] = useState<LiveEvent | null | 'new'>(null);
  const [sharing, setSharing] = useState<string | null>(focusId ? focusId.split('#')[0] : null);
  useEffect(() => { if (focusId) setSharing(focusId.split('#')[0]); }, [focusId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sorted = orderEvents(live.events);
  const shareEvent = live.events.find((e) => e.id === sharing) ?? null;

  const quick = async () => {
    setBusy(true); setError('');
    try { const e = await live.create({ kind: 'quick', title: 'Quick event', description: '', notes: '', startsAt: null, participants: [] }); setSharing(e.id); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start the event.'); }
    setBusy(false);
  };
  const act = async (fn: () => Promise<unknown>) => { setError(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'That did not work. Try again.'); } };
  const ready = live.service === 'ok';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink"><Radio className="h-4 w-4 text-accent" />Live events</div>
        <button type="button" onClick={onClose} aria-label="Close panel" className="rounded-full p-1.5 text-ink-faint hover:bg-white/5 hover:text-ink"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div className="flex gap-2">
          <Button variant="primary" size="sm" className="flex-1" disabled={!ready} onClick={() => setEditing('new')} leftIcon={<CalendarPlus className="h-4 w-4" />}>Schedule</Button>
          <Button variant="secondary" size="sm" className="flex-1" disabled={!ready || busy} onClick={quick} leftIcon={<Zap className="h-4 w-4" />} title="Start an event now and share its link right away">Quick event</Button>
        </div>
        {live.service === 'signin' && <p className="rounded-card border border-line-strong bg-surface-2 p-3 text-xs text-ink-dim">Sign in with Google to schedule live events and keep them on your account.</p>}
        {live.service === 'none' && <div role="alert" className="rounded-card border border-warn/40 bg-warn/10 p-3 text-xs text-ink">Live events are not available on this server yet.</div>}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        {ready && sorted.length === 0 && <p className="rounded-card border border-dashed border-line px-3 py-6 text-center text-xs text-ink-faint">No live events yet. Schedule one with notes and files for your guests, or start a quick event and share its link on WhatsApp.</p>}
        <ul className="flex flex-col gap-2" aria-label="Live events">
          {sorted.map((e) => {
            const b = badge(e, live.now);
            return (
              <li key={e.id} className="rounded-card border border-line bg-surface-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{e.title}</p>
                    <p className="text-[11px] text-ink-dim">{e.startsAt ? formatWhen(e.startsAt) : e.kind === 'quick' ? 'Quick event' : ''}{e.participants.length ? ` · ${e.participants.length} guest${e.participants.length === 1 ? '' : 's'}` : ''}</p>
                  </div>
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${b.cls}`}>{b.text}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {e.state !== 'ended' && (e.state === 'open'
                    ? <Button size="sm" variant="secondary" onClick={() => act(() => live.setOpen(e.id, false))} leftIcon={<Square className="h-3.5 w-3.5" />}>End</Button>
                    : <Button size="sm" variant="primary" onClick={() => act(() => live.setOpen(e.id, true))} leftIcon={<Play className="h-3.5 w-3.5" />} title="Open the link now, before the scheduled time">Open now</Button>)}
                  {e.state !== 'ended' && <Button size="sm" variant="secondary" onClick={() => setSharing(e.id)} leftIcon={<MessageCircle className="h-3.5 w-3.5" />}>Invite</Button>}
                  {e.kind === 'scheduled' && <button type="button" aria-label={`Edit ${e.title}`} title="Edit" onClick={() => setEditing(e)} className="grid h-8 w-8 place-items-center rounded-full text-ink-dim hover:bg-white/5 hover:text-ink"><Pencil className="h-3.5 w-3.5" /></button>}
                  <button type="button" aria-label={`Delete ${e.title}`} title="Delete" onClick={() => { if (window.confirm(`Delete "${e.title}"? Its link stops working.`)) void act(() => live.remove(e.id)); }} className="ml-auto grid h-8 w-8 place-items-center rounded-full text-ink-faint hover:bg-danger/10 hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <LiveEventEditor
        open={editing !== null}
        event={editing && editing !== 'new' ? editing : null}
        onClose={() => setEditing(null)}
        onSave={async (d, add, rm) => {
          if (editing && editing !== 'new') await live.update(editing.id, d, add, rm);
          else { const e = await live.create(d, add); setSharing(e.id); }
        }}
      />
      <ShareDialog event={shareEvent} host={hostName} onClose={() => setSharing(null)} />
    </div>
  );
};

const ShareDialog: React.FC<{ event: LiveEvent | null; host: string; onClose: () => void }> = ({ event, host, onClose }) => {
  const [copied, setCopied] = useState(false);
  if (!event) return null;
  const link = joinLink(window.location.origin, event.token);
  const text = inviteMessage(event, link, host);
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the text is shown below to copy by hand */ } };
  return (
    <ModalShell open onClose={onClose} title={event.kind === 'quick' && event.state === 'open' ? 'Your quick event is live' : 'Invite guests'} description={event.state === 'open' ? 'The link is active now' : 'The link activates at the scheduled time, or when you open it'} size="md"
      footer={<Button variant="ghost" onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <a href={whatsappUrl(text)} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-control bg-accent px-4 text-sm font-semibold text-accent-ink hover:brightness-110"><MessageCircle className="h-4 w-4" />Share on WhatsApp</a>
          <a href={mailtoUrl(`Live session: ${event.title}`, text)} className="inline-flex h-10 items-center gap-2 rounded-control border border-line-strong bg-surface-2 px-4 text-sm font-medium text-ink hover:bg-surface-3"><Mail className="h-4 w-4" />Email</a>
          <Button variant="secondary" onClick={copy} leftIcon={<Copy className="h-4 w-4" />}>{copied ? 'Copied' : 'Copy invite'}</Button>
        </div>
        {event.participants.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-dim">Send to each guest</p>
            <ul className="flex flex-col gap-1.5">
              {event.participants.map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-2 rounded-control border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink">
                  <span className="min-w-0 truncate">{p.name}{p.contact ? <span className="text-ink-faint"> · {p.contact}</span> : null}</span>
                  <span className="flex shrink-0 gap-2">
                    <a href={whatsappUrl(text, p.contact)} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">WhatsApp</a>
                    {p.contact.includes('@') && <a href={mailtoUrl(`Live session: ${event.title}`, text, p.contact)} className="text-accent hover:underline">Email</a>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-card border border-line bg-surface-1 p-3 text-xs text-ink-dim">{text}</pre>
      </div>
    </ModalShell>
  );
};
