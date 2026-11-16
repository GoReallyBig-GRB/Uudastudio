/** The producer's live-event workspace: every event on the left, the scheduler and details on the right. It stays mounted, so closing it or clicking away never loses what was typed. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarPlus, Check, Copy, FileText, Mail, MessageCircle, Music, Paperclip, Play, Plus, Radio, Square, Trash2, X, Zap } from 'lucide-react';
import { DateTimePicker } from '../components/ui/DateTimePicker';
import { ScriptEditor } from '../components/ui/ScriptEditor';
import { COUNTRIES, defaultCountry, isValidWhatsapp, joinNumber, splitNumber } from './phone';
import { FILE_CAP_BYTES, FILE_CAP_COUNT, countdown, durationLabel, formatWhen, inviteMessage, joinLink, looksLikeEmail, mailtoUrl, orderEvents, whatsappUrl, type LiveEvent, type LiveFile } from './events';
import type { EventDraft } from './api';
import type { LiveState } from './useLiveEvents';

interface Props { open: boolean; onClose: () => void; live: LiveState; hostName: string; focusId?: string | null }

interface PersonForm { name: string; iso: string; national: string; email: string }
interface Form { title: string; description: string; notes: string; startsAt: number | null; duration: string; people: PersonForm[]; files: LiveFile[]; removed: string[]; added: File[] }

const DRAFT_KEY = 'uuda_live_new_draft';
const FILE_ACCEPT = '.pdf,.doc,.docx,.txt,.rtf,.md,.odt,.ppt,.pptx,.xls,.xlsx,.csv,.mp3,.wav,.m4a,.ogg,.aac,.flac';
const DURATIONS = [15, 30, 45, 60, 90, 120, 180];
const kb = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);
const FIELD = 'h-10 w-full rounded-control border border-line-strong bg-surface-3 px-3 text-sm text-ink placeholder:text-ink-faint hover:border-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50';
const LABEL = 'mb-1.5 block text-xs font-medium text-ink-dim';
const PRIMARY = 'inline-flex h-10 items-center justify-center gap-2 rounded-control bg-ink px-5 text-sm font-semibold text-surface-0 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60';
const SECONDARY = 'inline-flex h-10 items-center justify-center gap-2 rounded-control border border-line-strong bg-surface-2 px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60';
const LIVEBTN = 'inline-flex h-10 items-center justify-center gap-2 rounded-control bg-ok px-5 text-sm font-semibold text-surface-0 transition-[filter] hover:brightness-110 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ok/60';

const emptyForm = (): Form => ({ title: '', description: '', notes: '', startsAt: null, duration: '', people: [], files: [], removed: [], added: [] });
const formOf = (e: LiveEvent): Form => {
  const fb = defaultCountry();
  return { title: e.title, description: e.description, notes: e.notes, startsAt: e.startsAt, duration: e.durationMin ? String(e.durationMin) : '', files: e.files, removed: [], added: [],
    people: e.participants.map((p) => ({ name: p.name, email: p.email, ...splitNumber(p.whatsapp, fb) })) };
};
const draftOf = (f: Form, kind: 'scheduled' | 'quick'): EventDraft => ({
  kind, title: f.title.trim() || (kind === 'quick' ? 'Quick event' : ''), description: f.description, notes: f.notes, startsAt: kind === 'quick' ? null : f.startsAt,
  durationMin: f.duration ? Number(f.duration) : null,
  participants: f.people.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), whatsapp: joinNumber(p.iso, p.national), email: p.email.trim() })),
});

const badge = (e: LiveEvent, now: number) =>
  e.state === 'open' ? { text: 'Live now', cls: 'bg-ok/15 text-ok border-ok/40' }
    : e.state === 'ended' ? { text: 'Ended', cls: 'text-ink-faint border-line' }
      : { text: e.startsAt ? `Starts ${countdown(e.startsAt - now)}` : 'Not open', cls: 'text-ink-dim border-line-strong' };

const loadNewDraft = (): Form | null => { try { const r = localStorage.getItem(DRAFT_KEY); return r ? { ...emptyForm(), ...(JSON.parse(r) as Partial<Form>), files: [], removed: [], added: [] } : null; } catch { return null; } };
const saveNewDraft = (f: Form | null) => { try { if (f) localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...f, added: [], files: [], removed: [] })); else localStorage.removeItem(DRAFT_KEY); } catch { /* storage may be blocked; the draft still lives in memory */ } };

export const LiveWorkspace: React.FC<Props> = ({ open, onClose, live, hostName, focusId }) => {
  const [sel, setSel] = useState<string>('');
  const [drafts, setDrafts] = useState<Record<string, Form>>(() => { const out: Record<string, Form> = {}; const d = loadNewDraft(); if (d) out.new = d; return out; });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const sorted = useMemo(() => orderEvents(live.events), [live.events]);
  const ready = live.service === 'ok';

  // Arriving from the toolbar with an event in mind
  useEffect(() => { if (focusId) { const id = focusId.split('#')[0]; setSel(id); setSharing(id); } }, [focusId]);
  // Nothing selected yet: show the next event, or the new-event form
  useEffect(() => { if (open && !sel) setSel(sorted[0]?.id ?? 'new'); }, [open, sel, sorted]);
  // Escape closes the window (the work stays); clicking outside does nothing at all
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k);
  }, [open, onClose]);

  const event = sel === 'new' ? null : live.events.find((e) => e.id === sel) ?? null;
  const form: Form = drafts[sel] ?? (event ? formOf(event) : emptyForm());
  const dirty = Boolean(drafts[sel]);
  const edit = useCallback((patch: Partial<Form>) => {
    setDrafts((d) => { const base = d[sel] ?? (event ? formOf(event) : emptyForm()); const next = { ...base, ...patch }; if (sel === 'new') saveNewDraft(next); return { ...d, [sel]: next }; });
  }, [sel, event]);
  const clearDraft = (id: string) => { setDrafts((d) => { const rest = { ...d }; delete rest[id]; return rest; }); if (id === 'new') saveNewDraft(null); };
  const act = async (fn: () => Promise<unknown>) => { setError(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'That did not work. Try again.'); } };

  const quick = () => act(async () => { setBusy(true); try { const e = await live.create({ kind: 'quick', title: 'Quick event', description: '', notes: '', startsAt: null, durationMin: null, participants: [] }); setSel(e.id); setSharing(e.id); } finally { setBusy(false); } });

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...form.added]; let msg = '';
    for (const f of Array.from(list)) {
      if (form.files.length + next.length >= FILE_CAP_COUNT) { msg = `An event can carry ${FILE_CAP_COUNT} files.`; break; }
      if (f.size > FILE_CAP_BYTES) { msg = `${f.name} is ${kb(f.size)}. A file can be up to ${kb(FILE_CAP_BYTES)}.`; continue; }
      next.push(f);
    }
    edit({ added: next }); setError(msg);
  };

  const save = () => act(async () => {
    const kind = event?.kind ?? 'scheduled';
    if (!form.title.trim() && kind === 'scheduled') throw new Error('Give the event a title.');
    if (kind === 'scheduled' && form.startsAt === null) throw new Error('Pick a date and time.');
    for (const p of form.people) {
      if (p.email.trim() && !looksLikeEmail(p.email)) throw new Error(`${p.name || 'A guest'} has an email address that does not look right.`);
      if (!isValidWhatsapp(joinNumber(p.iso, p.national))) throw new Error(`${p.name || 'A guest'} has a WhatsApp number that does not look right.`);
    }
    setBusy(true);
    try {
      const d = draftOf(form, kind);
      if (event) await live.update(event.id, d, form.added, form.removed);
      else { const e = await live.create(d, form.added); clearDraft('new'); setSel(e.id); setSharing(e.id); return; }
      clearDraft(sel);
    } finally { setBusy(false); }
  });

  const shareEvent = live.events.find((e) => e.id === sharing) ?? null;
  const fb = defaultCountry();

  return (
    <div className={open ? 'fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6' : 'hidden'} aria-hidden={!open}>
      <section role="dialog" aria-label="Live events" aria-modal="true" className="relative flex h-[min(820px,94vh)] w-[min(1180px,96vw)] flex-col overflow-hidden rounded-card border border-line-strong bg-surface-1 shadow-float">
        <header className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-full border border-line-strong bg-surface-2"><Radio className="h-4 w-4 text-ink" /></span>
            <div><h2 className="text-base font-semibold text-ink">Live events</h2><p className="text-xs text-ink-dim">Schedule sessions, share the invite, open the link when you are ready</p></div></div>
          <button type="button" onClick={onClose} aria-label="Close live events" title="Close (your changes stay)" className="grid h-9 w-9 place-items-center rounded-full text-ink-dim hover:bg-white/5 hover:text-ink cursor-pointer"><X className="h-4 w-4" /></button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="flex max-h-[34%] shrink-0 flex-col gap-3 overflow-y-auto border-b border-line p-4 md:max-h-none md:w-[300px] md:border-b-0 md:border-r" aria-label="Events">
            <div className="flex gap-2">
              <button type="button" disabled={!ready} onClick={() => { setSel('new'); setError(''); }} className={`${PRIMARY} flex-1 px-3`}><CalendarPlus className="h-4 w-4" />New event</button>
              <button type="button" disabled={!ready || busy} onClick={quick} title="Start an event now and share its link right away" className={`${SECONDARY} flex-1 px-3`}><Zap className="h-4 w-4" />Quick</button>
            </div>
            {live.service === 'signin' && <p className="rounded-card border border-line-strong bg-surface-2 p-3 text-xs text-ink-dim">Sign in with Google to schedule live events and keep them on your account.</p>}
            {live.service === 'none' && <p role="alert" className="rounded-card border border-warn/40 bg-warn/10 p-3 text-xs text-ink">Live events are not available on this server yet.</p>}
            {drafts.new && sel !== 'new' && <button type="button" onClick={() => setSel('new')} className="rounded-control border border-dashed border-line-strong px-3 py-2 text-left text-xs text-ink-dim hover:text-ink cursor-pointer">Unsaved new event · {drafts.new.title || 'Untitled'}</button>}
            {ready && sorted.length === 0 && <p className="rounded-card border border-dashed border-line px-3 py-6 text-center text-xs text-ink-faint">No events yet. Create one with notes and files for your guests, or start a quick event.</p>}
            <ul className="flex flex-col gap-1.5">
              {sorted.map((e) => { const b = badge(e, live.now); const on = e.id === sel; return (
                <li key={e.id}>
                  <button type="button" onClick={() => { setSel(e.id); setError(''); }} aria-current={on} className={`w-full rounded-card border p-3 text-left transition-colors cursor-pointer ${on ? 'border-ink-faint bg-surface-3' : 'border-line bg-surface-2 hover:bg-surface-3'}`}>
                    <span className="flex items-start justify-between gap-2"><span className="min-w-0 truncate text-sm font-semibold text-ink">{e.title}</span>{drafts[e.id] && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-warn" title="Unsaved changes" />}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-dim">{e.startsAt ? formatWhen(e.startsAt) : 'Quick event'}{e.durationMin ? ` · ${durationLabel(e.durationMin)}` : ''}</span>
                    <span className={`mt-2 inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${b.cls}`}>{b.text}</span>
                  </button>
                </li>); })}
            </ul>
          </aside>

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            {!ready ? <p className="p-8 text-sm text-ink-dim">{live.service === 'signin' ? 'Sign in to use live events.' : live.service === 'none' ? 'Live events are not available here yet.' : 'Loading...'}</p> : (
              <div className="mx-auto flex max-w-3xl flex-col gap-6 p-5 md:p-7">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="mr-auto min-w-0 truncate text-lg font-semibold text-ink">{event ? event.title : 'New live event'}</h3>
                  {event && event.state !== 'ended' && (event.state === 'open'
                    ? <button type="button" className={SECONDARY} onClick={() => act(() => live.setOpen(event.id, false))}><Square className="h-4 w-4" />End session</button>
                    : <button type="button" className={LIVEBTN} onClick={() => act(() => live.setOpen(event.id, true))} title="Open the link now, before the scheduled time"><Play className="h-4 w-4" />Go live now</button>)}
                  {event && event.state !== 'ended' && <button type="button" className={SECONDARY} onClick={() => setSharing(event.id)}><MessageCircle className="h-4 w-4" />Invite</button>}
                  {event && <button type="button" aria-label={`Delete ${event.title}`} title="Delete" onClick={() => { if (window.confirm(`Delete "${event.title}"? Its link stops working.`)) void act(async () => { await live.remove(event.id); clearDraft(event.id); setSel(''); }); }} className="grid h-10 w-10 place-items-center rounded-control text-ink-faint hover:bg-danger/10 hover:text-danger cursor-pointer"><Trash2 className="h-4 w-4" /></button>}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="md:col-span-2"><label htmlFor="lw-title" className={LABEL}>Title</label><input id="lw-title" className={FIELD} value={form.title} maxLength={120} onChange={(e) => edit({ title: e.target.value })} placeholder="Friday panel with the guests" /></div>
                  <div className="md:col-span-2"><label htmlFor="lw-desc" className={LABEL}>Description</label><textarea id="lw-desc" rows={3} maxLength={1000} value={form.description} onChange={(e) => edit({ description: e.target.value })} placeholder="What the session is about" className="w-full resize-y rounded-control border border-line-strong bg-surface-3 p-3 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" /></div>
                  {(event?.kind ?? 'scheduled') === 'scheduled' && <DateTimePicker id="lw-when" label="Date and time" value={form.startsAt} onChange={(ms) => edit({ startsAt: ms })} />}
                  <div><label htmlFor="lw-dur" className={LABEL}>Session length (optional)</label>
                    <select id="lw-dur" className={FIELD} value={form.duration} onChange={(e) => edit({ duration: e.target.value })}>
                      <option value="">Not set</option>{DURATIONS.map((m) => <option key={m} value={m}>{durationLabel(m)}</option>)}
                      {form.duration && !DURATIONS.includes(Number(form.duration)) && <option value={form.duration}>{durationLabel(Number(form.duration))}</option>}
                    </select></div>
                </div>

                <div>
                  <p className={LABEL}>Participants</p>
                  <div className="flex flex-col gap-3">
                    {form.people.map((p, i) => { const set = (patch: Partial<PersonForm>) => edit({ people: form.people.map((x, j) => (j === i ? { ...x, ...patch } : x)) }); return (
                      <div key={i} className="grid gap-2 rounded-card border border-line bg-surface-2 p-3 md:grid-cols-[1fr_1.4fr_1.2fr_auto] md:items-end">
                        <div><label className="mb-1 block text-[11px] text-ink-faint" htmlFor={`lw-pn-${i}`}>Name</label><input id={`lw-pn-${i}`} className={FIELD} value={p.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} placeholder="Guest name" /></div>
                        <div><label className="mb-1 block text-[11px] text-ink-faint" htmlFor={`lw-pw-${i}`}>WhatsApp</label>
                          <div className="flex gap-1.5">
                            <select aria-label="Country code" className="h-10 w-[104px] shrink-0 rounded-control border border-line-strong bg-surface-3 px-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" value={p.iso} onChange={(e) => set({ iso: e.target.value })}>
                              {COUNTRIES.map((c) => <option key={c.iso} value={c.iso}>{c.iso} +{c.dial}</option>)}
                            </select>
                            <input id={`lw-pw-${i}`} className={FIELD} type="tel" inputMode="tel" autoComplete="off" value={p.national} maxLength={20} onChange={(e) => set({ national: e.target.value.replace(/[^\d\s()-]/g, '') })} placeholder="803 123 4567" />
                          </div></div>
                        <div><label className="mb-1 block text-[11px] text-ink-faint" htmlFor={`lw-pe-${i}`}>Email</label><input id={`lw-pe-${i}`} className={FIELD} type="email" autoComplete="off" value={p.email} maxLength={120} onChange={(e) => set({ email: e.target.value })} placeholder="name@example.com" /></div>
                        <button type="button" aria-label={`Remove ${p.name || 'guest'}`} onClick={() => edit({ people: form.people.filter((_, j) => j !== i) })} className="grid h-10 w-10 place-items-center rounded-control text-ink-faint hover:bg-white/5 hover:text-ink cursor-pointer"><X className="h-4 w-4" /></button>
                      </div>); })}
                    {form.people.length < 20 && <button type="button" className={`${SECONDARY} self-start`} onClick={() => edit({ people: [...form.people, { name: '', iso: fb, national: '', email: '' }] })}><Plus className="h-4 w-4" />Add participant</button>}
                  </div>
                </div>

                <div><p className={LABEL}>Event notes</p>
                  <ScriptEditor id="lw-notes" rows={9} value={form.notes} onChange={(v) => edit({ notes: v })} maxLength={8000} placeholder="Discussion points, talking order and links to read before the session." />
                  <p className="mt-1.5 text-[11px] text-ink-faint">Links you paste are clickable for your guests.</p></div>

                <div>
                  <p className={LABEL}>Files for the guests</p>
                  <ul className="flex flex-col gap-1.5">
                    {form.files.map((f) => <FileRow key={f.id} name={f.name} size={f.size} audio={f.kind === 'audio'} onRemove={() => edit({ files: form.files.filter((x) => x.id !== f.id), removed: [...form.removed, f.id] })} />)}
                    {form.added.map((f, i) => <FileRow key={`${f.name}-${i}`} name={f.name} size={f.size} audio={/\.(mp3|wav|m4a|ogg|aac|flac)$/i.test(f.name)} onRemove={() => edit({ added: form.added.filter((_, j) => j !== i) })} />)}
                  </ul>
                  <input ref={picker} type="file" multiple accept={FILE_ACCEPT} className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
                  <button type="button" className={`${SECONDARY} mt-2`} disabled={form.files.length + form.added.length >= FILE_CAP_COUNT} onClick={() => picker.current?.click()}><Paperclip className="h-4 w-4" />Attach a document or audio</button>
                  <p className="mt-1.5 text-[11px] text-ink-faint">Up to {FILE_CAP_COUNT} files, {kb(FILE_CAP_BYTES)} each: a document, or an audio clip of about a minute.</p>
                </div>

                {error && <p role="alert" className="text-sm text-danger">{error}</p>}
                <div className="sticky bottom-0 -mx-5 flex items-center gap-3 border-t border-line bg-surface-1/95 px-5 py-3 backdrop-blur md:-mx-7 md:px-7">
                  <button type="button" className={PRIMARY} disabled={busy || (Boolean(event) && !dirty)} onClick={save}><Check className="h-4 w-4" />{busy ? 'Saving...' : event ? 'Save changes' : 'Create event'}</button>
                  {dirty && <button type="button" className={SECONDARY} disabled={busy} onClick={() => { clearDraft(sel); setError(''); }}>Discard changes</button>}
                  {dirty && <span className="text-xs text-ink-dim">Unsaved changes are kept while this window is closed.</span>}
                </div>
              </div>
            )}
          </div>
        </div>

        {shareEvent && <InvitePanel event={shareEvent} host={hostName} onClose={() => setSharing(null)} />}
      </section>
    </div>
  );
};

const FileRow: React.FC<{ name: string; size: number; audio: boolean; onRemove: () => void }> = ({ name, size, audio, onRemove }) => (
  <li className="flex items-center gap-2 rounded-control border border-line bg-surface-2 px-3 py-2 text-xs text-ink">
    {audio ? <Music className="h-4 w-4 shrink-0 text-ink-dim" /> : <FileText className="h-4 w-4 shrink-0 text-ink-dim" />}
    <span className="min-w-0 flex-1 truncate">{name}</span><span className="shrink-0 text-ink-faint">{kb(size)}</span>
    <button type="button" aria-label={`Remove ${name}`} onClick={onRemove} className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-ink-faint hover:bg-white/5 hover:text-ink cursor-pointer"><X className="h-3.5 w-3.5" /></button>
  </li>
);

const InvitePanel: React.FC<{ event: LiveEvent; host: string; onClose: () => void }> = ({ event, host, onClose }) => {
  const [copied, setCopied] = useState(false);
  const link = joinLink(window.location.origin, event.token);
  const text = inviteMessage(event, link, host);
  const subject = `Live session: ${event.title}`;
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the text is shown to copy by hand */ } };
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 p-4">
      <div role="dialog" aria-label="Invite guests" className="flex max-h-full w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-card border border-line-strong bg-surface-1 p-5 shadow-float">
        <div className="flex items-start justify-between gap-3">
          <div><h3 className="text-base font-semibold text-ink">{event.kind === 'quick' && event.state === 'open' ? 'Your quick event is live' : 'Invite guests'}</h3>
            <p className="text-xs text-ink-dim">{event.state === 'open' ? 'The link is active now' : 'The link activates at the scheduled time, or when you go live'}</p></div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-ink-dim hover:bg-white/5 hover:text-ink cursor-pointer"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={whatsappUrl(text)} target="_blank" rel="noopener noreferrer" className={PRIMARY}><MessageCircle className="h-4 w-4" />Share on WhatsApp</a>
          <a href={mailtoUrl(subject, text)} className={SECONDARY}><Mail className="h-4 w-4" />Email</a>
          <button type="button" onClick={copy} className={SECONDARY}><Copy className="h-4 w-4" />{copied ? 'Copied' : 'Copy invite'}</button>
        </div>
        {event.participants.length > 0 && (
          <div><p className={LABEL}>Send to each guest</p>
            <ul className="flex flex-col gap-1.5">
              {event.participants.map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-2 rounded-control border border-line bg-surface-2 px-3 py-2 text-xs text-ink">
                  <span className="min-w-0 truncate">{p.name}</span>
                  <span className="flex shrink-0 gap-3">
                    {p.whatsapp && <a href={whatsappUrl(text, p.whatsapp)} target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline-offset-2 hover:underline">WhatsApp</a>}
                    {p.email && <a href={mailtoUrl(subject, text, p.email)} className="font-medium text-ink underline-offset-2 hover:underline">Email</a>}
                    {!p.whatsapp && !p.email && <span className="text-ink-faint">No contact added</span>}
                  </span>
                </li>))}
            </ul></div>)}
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-card border border-line bg-surface-0 p-3 text-xs text-ink-dim">{text}</pre>
      </div>
    </div>
  );
};
