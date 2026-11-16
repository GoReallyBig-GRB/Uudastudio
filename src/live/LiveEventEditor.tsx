/** The form for scheduling a live event: title, description, time, participants, notes with links, and files. */
import React, { useEffect, useRef, useState } from 'react';
import { FileText, Music, Paperclip, Plus, X } from 'lucide-react';
import { Button, Input, ModalShell } from '../components/ui';
import { FILE_CAP_BYTES, FILE_CAP_COUNT, linksIn, type LiveEvent, type LiveFile, type LiveParticipant } from './events';
import type { EventDraft } from './api';

const AREA = 'w-full resize-y rounded-card border border-line-strong bg-surface-1 p-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';
const FILE_ACCEPT = '.pdf,.doc,.docx,.txt,.rtf,.md,.odt,.ppt,.pptx,.xls,.xlsx,.csv,.mp3,.wav,.m4a,.ogg,.aac,.flac';

/** "2026-11-16T14:00" in the person's own time zone */
const toLocalInput = (ms: number): string => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000); return d.toISOString().slice(0, 16); };
const nextHour = (): number => { const d = new Date(); d.setMinutes(0, 0, 0); return d.getTime() + 3600_000; };
const kb = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

interface Props {
  open: boolean;
  event: LiveEvent | null;
  onClose: () => void;
  onSave: (draft: EventDraft, add: File[], removeIds: string[]) => Promise<void>;
}

export const LiveEventEditor: React.FC<Props> = ({ open, event, onClose, onSave }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [when, setWhen] = useState('');
  const [people, setPeople] = useState<LiveParticipant[]>([]);
  const [existing, setExisting] = useState<LiveFile[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [added, setAdded] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(event?.title ?? ''); setDescription(event?.description ?? ''); setNotes(event?.notes ?? '');
    setWhen(toLocalInput(event?.startsAt ?? nextHour())); setPeople(event?.participants ?? []);
    setExisting(event?.files ?? []); setRemoved([]); setAdded([]); setError(''); setBusy(false);
  }, [open, event]);

  const fileCount = existing.length + added.length;
  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...added]; let msg = '';
    for (const f of Array.from(list)) {
      if (existing.length + next.length >= FILE_CAP_COUNT) { msg = `An event can carry ${FILE_CAP_COUNT} files.`; break; }
      if (f.size > FILE_CAP_BYTES) { msg = `${f.name} is ${kb(f.size)}. A file can be up to ${kb(FILE_CAP_BYTES)}.`; continue; }
      next.push(f);
    }
    setAdded(next); setError(msg);
  };

  const save = async () => {
    const startsAt = new Date(when).getTime();
    if (!title.trim()) { setError('Give the event a title.'); return; }
    if (!Number.isFinite(startsAt)) { setError('Pick a date and time.'); return; }
    setBusy(true); setError('');
    try { await onSave({ kind: 'scheduled', title, description, notes, startsAt, participants: people.filter((p) => p.name.trim()) }, added, removed); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save the event.'); setBusy(false); }
  };

  const links = linksIn(notes);

  return (
    <ModalShell
      open={open} onClose={onClose} size="lg" dismissible={!busy} blockShortcuts
      title={event ? 'Edit live event' : 'Schedule a live event'}
      description="The link works from the start time, or whenever you open it yourself"
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving...' : event ? 'Save changes' : 'Schedule event'}</Button></>}
    >
      <div className="flex flex-col gap-4">
        <Input label="Title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Friday panel with the guests" />
        <div>
          <label htmlFor="live-desc" className="mb-1.5 block text-xs font-medium text-ink-dim">Description</label>
          <textarea id="live-desc" rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the session is about" className={AREA} />
        </div>
        <Input label="Date and time" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />

        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-dim">Participants</p>
          <div className="flex flex-col gap-2">
            {people.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <input aria-label="Participant name" value={p.name} maxLength={120} placeholder="Name" onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="h-9 min-w-0 flex-1 rounded-control border border-line-strong bg-surface-3 px-3 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" />
                <input aria-label="WhatsApp number or email" value={p.contact} maxLength={120} placeholder="WhatsApp number or email" onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, contact: e.target.value } : x)))} className="h-9 min-w-0 flex-1 rounded-control border border-line-strong bg-surface-3 px-3 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" />
                <button type="button" aria-label={`Remove ${p.name || 'participant'}`} onClick={() => setPeople(people.filter((_, j) => j !== i))} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-faint hover:bg-white/5 hover:text-ink"><X className="h-4 w-4" /></button>
              </div>
            ))}
            {people.length < 20 && <Button variant="ghost" size="sm" className="self-start" onClick={() => setPeople([...people, { name: '', contact: '' }])} leftIcon={<Plus className="h-4 w-4" />}>Add participant</Button>}
          </div>
        </div>

        <div>
          <label htmlFor="live-notes" className="mb-1.5 block text-xs font-medium text-ink-dim">Event notes</label>
          <textarea id="live-notes" rows={5} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Discussion points and links to read before the session" className={AREA} />
          {links.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1" aria-label="Links in the notes">
              {links.map((u) => <li key={u} className="truncate text-xs"><a href={u} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">{u}</a></li>)}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-dim">Files for the guests</p>
          <ul className="flex flex-col gap-1.5">
            {existing.map((f) => <FileRow key={f.id} name={f.name} size={f.size} audio={f.kind === 'audio'} onRemove={() => { setExisting(existing.filter((x) => x.id !== f.id)); setRemoved([...removed, f.id]); }} />)}
            {added.map((f, i) => <FileRow key={`${f.name}-${i}`} name={f.name} size={f.size} audio={/\.(mp3|wav|m4a|ogg|aac|flac)$/i.test(f.name)} onRemove={() => setAdded(added.filter((_, j) => j !== i))} />)}
          </ul>
          <input ref={picker} type="file" multiple accept={FILE_ACCEPT} className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          <Button variant="secondary" size="sm" className="mt-2" disabled={fileCount >= FILE_CAP_COUNT} onClick={() => picker.current?.click()} leftIcon={<Paperclip className="h-4 w-4" />}>Attach a document or audio</Button>
          <p className="mt-1.5 text-[11px] text-ink-faint">Up to {FILE_CAP_COUNT} files, {kb(FILE_CAP_BYTES)} each: a document, or an audio clip of about a minute.</p>
        </div>

        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </ModalShell>
  );
};

const FileRow: React.FC<{ name: string; size: number; audio: boolean; onRemove: () => void }> = ({ name, size, audio, onRemove }) => (
  <li className="flex items-center gap-2 rounded-control border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink">
    {audio ? <Music className="h-4 w-4 shrink-0 text-ink-dim" /> : <FileText className="h-4 w-4 shrink-0 text-ink-dim" />}
    <span className="min-w-0 flex-1 truncate">{name}</span>
    <span className="shrink-0 text-ink-faint">{kb(size)}</span>
    <button type="button" aria-label={`Remove ${name}`} onClick={onRemove} className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-ink-faint hover:bg-white/5 hover:text-ink"><X className="h-3.5 w-3.5" /></button>
  </li>
);
