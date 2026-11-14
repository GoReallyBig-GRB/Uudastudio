/** One job, laid out as a workspace: the script you edit on the left, the conversations on the right. Links live behind two menus. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Copy, Link2, MoreHorizontal, Pencil, Send, Share2, Trash2 } from 'lucide-react';
import { Button, Menu, type MenuItem } from '../components/ui';
import { ScriptEditor } from '../components/ui/ScriptEditor';
import { FormattedScript } from '../guest/FormattedScript';
import { ApiError, audioUrl, createClientLink, deleteJob, getScriptVersion, getThread, postMessage, revokeTalentLink, saveScript, sendAudio, shareScript, type Attachment, type JobInfo, type ThreadResponse } from './api';
import { STATUS_TEXT, statusOf, type JobStatus, type StoredJob } from './jobsStore';
import { clientInviteText, clientLink, inviteText, nudgeText, talentLink } from './links';
import { ThreadView } from './ThreadView';
import { ClientFiles } from './ClientReview';
import { usePolling } from './usePolling';
import { useLive } from './live';
import { ago } from './time';

const base = () => window.location.origin + window.location.pathname;
const copyText = async (t: string): Promise<boolean> => { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } };

const CARD = 'rounded-2xl border border-line bg-surface-1';
const LABEL = 'text-[11px] font-semibold uppercase tracking-wider text-ink-dim';

interface DetailProps {
  job: StoredJob;
  onSeen: (lastId: number, status: JobStatus) => void;
  /** The client thread was looked at up to this message */
  onClientSeen?: (lastId: number) => void;
  onRemoved: () => void;
  onImportFile: (f: File) => Promise<void> | void;
  onBack?: () => void;
}

type Pill = { text: string; tone: 'ok' | 'warn' | 'dim' | 'accent' };
const PILL: Record<Pill['tone'], string> = { ok: 'border-ok/40 bg-ok/10 text-ok', warn: 'border-warn/40 bg-warn/10 text-warn', dim: 'border-line bg-surface-2 text-ink-dim', accent: 'border-accent/40 bg-accent/10 text-accent' };

export const JobDetail: React.FC<DetailProps> = ({ job, onSeen, onClientSeen, onRemoved, onImportFile, onBack }) => {
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [messages, setMessages] = useState<ThreadResponse['messages']>([]);
  const [error, setError] = useState('');
  const [talentKey, setTalentKey] = useState('');
  const [clientKey, setClientKey] = useState('');
  const [clientMessages, setClientMessages] = useState<ThreadResponse['messages']>([]);
  const [which, setWhich] = useState<'talent' | 'client'>('talent');
  const [copied, setCopied] = useState('');
  const [importing, setImporting] = useState('');
  const [armed, setArmed] = useState<'' | 'talent' | 'client' | 'delete'>('');
  /** The script is only editable after the pencil is pressed */
  const [editing, setEditing] = useState(false);

  // ---- loading and live updates ----
  const sigRef = useRef('');
  const load = useCallback(async () => {
    const after = messages.length ? messages[messages.length - 1].id : 0;
    try {
      const t = await getThread(job.id, job.producerKey, after);
      setThread(t); setError('');
      if (t.keys?.talent) setTalentKey(t.keys.talent);
      setClientKey(t.keys?.client ?? '');
      if (t.messages.length) setMessages((all) => [...all, ...t.messages.filter((m) => !all.some((x) => x.id === m.id))]);
      onSeen(t.lastId, statusOf([...messages, ...t.messages]));
      const sig = JSON.stringify([t.job, t.keys]);
      const unchanged = sig === sigRef.current && !t.messages.length;
      sigRef.current = sig;
      return !unchanged;
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load this job.'); }
  }, [job.id, job.producerKey, messages, onSeen]);
  const loadClient = useCallback(async () => {
    const after = clientMessages.length ? clientMessages[clientMessages.length - 1].id : 0;
    try {
      const t = await getThread(job.id, job.producerKey, after, 'client');
      if (t.messages.length) setClientMessages((all) => [...all, ...t.messages.filter((m) => !all.some((x) => x.id === m.id))]);
      return t.messages.length > 0;
    } catch { /* the talent thread already shows connection problems */ }
  }, [job.id, job.producerKey, clientMessages]);
  const live = useLive(job.id, job.producerKey, (c) => { if (c !== 'client') void load(); if (c !== 'talent') void loadClient(); });
  usePolling(load, 6000, true, live);
  usePolling(loadClient, 6000, !!clientKey, live);
  const lastClientId = clientMessages.length ? clientMessages[clientMessages.length - 1].id : 0;
  useEffect(() => { if (which === 'client' && lastClientId) onClientSeen?.(lastClientId); }, [which, lastClientId, onClientSeen]);
  const clientUnread = which === 'client' ? 0 : clientMessages.filter((m) => m.id > (job.lastReadClient ?? 0) && m.role !== 'producer' && !m.event).length;

  const j = thread?.job;
  const tLink = useMemo(() => (talentKey ? talentLink(base(), job.id, talentKey) : ''), [talentKey, job.id]);
  const cLink = useMemo(() => (clientKey ? clientLink(base(), job.id, clientKey) : ''), [clientKey, job.id]);
  const flash = (what: string) => { setCopied(what); window.setTimeout(() => setCopied(''), 2200); };
  useEffect(() => { if (!armed) return; const t = window.setTimeout(() => setArmed(''), 4000); return () => window.clearTimeout(t); }, [armed]);
  const fail = (e: unknown, fallback: string) => setError(e instanceof Error ? e.message : fallback);

  // ---- the script: a draft you edit, saved as a new version ----
  const [draft, setDraft] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState('');
  const loaded = useRef('');
  useEffect(() => {
    if (!j) return;
    const fromServer = JSON.stringify([j.script, j.notes]);
    // Take the server's text unless the person has unsaved changes of their own
    if (loaded.current === '' || (draft === JSON.parse(loaded.current)[0] && notes === JSON.parse(loaded.current)[1])) { setDraft(j.script); setNotes(j.notes); }
    loaded.current = fromServer;
  }, [j?.script, j?.notes]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!j && (draft !== j.script || notes !== j.notes);
  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    setSaving('Saving...'); setError('');
    try { await saveScript(job.id, job.producerKey, { script: draft, notes }); await load(); setEditing(false); return true; } catch (e) { fail(e, 'The script was not saved.'); return false; } finally { setSaving(''); }
  };
  const share = async () => {
    setError('');
    if (!(await save())) return;
    try {
      if (!clientKey) { const r = await createClientLink(job.id, job.producerKey); setClientKey(r.clientKey); }
      await shareScript(job.id, job.producerKey);
      await load(); await loadClient(); setWhich('client');
    } catch (e) { fail(e, 'The script could not be shared.'); }
  };
  const restore = async (n: number) => {
    try { const v = await getScriptVersion(job.id, job.producerKey, n); setDraft(v.script); } catch (e) { fail(e, 'That version could not be opened.'); }
  };

  // ---- links and actions ----
  const copyItem = (id: string, label: string, hint: string, text: string, icon: React.ReactNode, divider = false): MenuItem => ({
    id, label: copied === id ? 'Copied' : label, hint, icon: copied === id ? <Check className="h-4 w-4 text-ok" /> : icon, divider, disabled: !text,
    onSelect: () => { void copyText(text).then((ok) => { if (ok) flash(id); }); },
  });
  /** The client link is made the first time it is wanted; making it again would replace the old one */
  const copyClient = async (what: 'link' | 'invite') => {
    try {
      let key = clientKey;
      if (!key) { key = (await createClientLink(job.id, job.producerKey)).clientKey; setClientKey(key); }
      const link = clientLink(base(), job.id, key);
      if (await copyText(what === 'link' ? link : clientInviteText(job.title, j?.producer ?? '', link))) flash(what === 'link' ? 'c-link' : 'c-invite');
    } catch (e) { fail(e, 'Could not make the link.'); }
  };
  const inviteItems: MenuItem[] = [
    copyItem('t-link', 'Copy talent link', 'For the voice talent to record', tLink, <Link2 className="h-4 w-4" />),
    { id: 'c-link', label: copied === 'c-link' ? 'Copied' : 'Copy client link', hint: cLink ? 'For someone who reviews' : 'Made when you copy it. Optional.', icon: copied === 'c-link' ? <Check className="h-4 w-4 text-ok" /> : <Link2 className="h-4 w-4" />, onSelect: () => { void copyClient('link'); } },
    copyItem('t-invite', 'Talent: copy invitation message', 'Their link in a message ready to send', inviteText(job.title, j?.producer ?? '', tLink), <Send className="h-4 w-4" />, true),
    { id: 'c-invite', label: copied === 'c-invite' ? 'Copied' : 'Client: copy invitation message', icon: copied === 'c-invite' ? <Check className="h-4 w-4 text-ok" /> : <Send className="h-4 w-4" />, onSelect: () => { void copyClient('invite'); } },
    copyItem('t-nudge', 'Talent: copy a nudge', 'After you reply, send this by email or WhatsApp', nudgeText(job.title, tLink), <Copy className="h-4 w-4" />),
  ];
  const moreItems: MenuItem[] = [
    { id: 'new-t', label: armed === 'talent' ? 'Tap again: the old talent link stops' : copied === 'new-t' ? 'New talent link made' : 'New talent link', hint: 'Replaces the link if it got into the wrong hands', icon: <Link2 className="h-4 w-4" />,
      onSelect: () => { if (armed !== 'talent') { setArmed('talent'); return; } setArmed(''); void revokeTalentLink(job.id, job.producerKey).then((r) => { setTalentKey(r.talentKey); flash('new-t'); }).catch((e) => fail(e, 'Could not change the link.')); } },
    ...(cLink ? [{ id: 'new-c', label: armed === 'client' ? 'Tap again: the old client link stops' : copied === 'new-c' ? 'New client link made' : 'New client link', icon: <Link2 className="h-4 w-4" />,
      onSelect: () => { if (armed !== 'client') { setArmed('client'); return; } setArmed(''); void createClientLink(job.id, job.producerKey).then((r) => { setClientKey(r.clientKey); flash('new-c'); }).catch((e) => fail(e, 'Could not change the link.')); } }] : []),
    { id: 'delete', label: armed === 'delete' ? 'Tap again: delete job and audio' : 'Delete job', danger: true, divider: true, icon: <Trash2 className="h-4 w-4" />,
      onSelect: () => { if (armed !== 'delete') { setArmed('delete'); return; } setArmed(''); void deleteJob(job.id, job.producerKey).then(onRemoved).catch((e) => { if (e instanceof ApiError && e.status === 404) onRemoved(); else fail(e, 'Could not delete the job.'); }); } },
  ];
  const doImport = async (a: Attachment) => {
    setImporting(a.name);
    try {
      const r = await fetch(audioUrl(job.id, a.id, job.producerKey));
      if (!r.ok) throw new Error('The file could not be downloaded.');
      await onImportFile(new File([await r.blob()], a.name, { type: a.mime }));
    } catch (e) { fail(e, 'Could not add the file.'); } finally { setImporting(''); }
  };

  // ---- what to say about the job ----
  const status = statusOf(messages);
  const share_ = j?.share ?? null;
  const lastEvent = [...clientMessages].reverse().find((m) => m.event);
  const clientPill: Pill | null = share_
    ? share_.approved ? { text: `Client approved v${share_.n}`, tone: 'ok' }
      : lastEvent?.event?.type === 'changes' && lastEvent.event.n === share_.n ? { text: `Client wants changes to v${share_.n}`, tone: 'warn' }
      : { text: `Waiting for client approval of v${share_.n}`, tone: 'accent' }
    : null;
  const versions = [...(j?.versions ?? [])].reverse();
  const shareLabel = !share_ ? (dirty ? 'Save and share with client' : 'Share with client') : share_.current && !dirty ? 'Shared with client' : dirty ? 'Save and share update' : `Share update (v${j?.scriptN})`;

  const historyItems: MenuItem[] = versions.map((v) => ({
    id: String(v.n),
    label: `Version ${v.n}${v.n === j?.scriptN ? ' · current' : ''}${share_?.n === v.n ? ' · shared' : ''}`,
    hint: `${ago(v.ts)} · ${v.words} word${v.words === 1 ? '' : 's'}${v.n === j?.scriptN ? '' : ' · open in the editor'}`,
    disabled: v.n === j?.scriptN && !dirty,
    onSelect: () => { setEditing(true); void restore(v.n); },
  }));

  /** Version history and the optional step of sending the script to the client for approval */
  const scriptItems: MenuItem[] = [
    { id: 'share', label: shareLabel, hint: share_?.approved ? `Approved v${share_.n}` : 'Optional. Only if the client must approve it.', icon: <Share2 className="h-4 w-4" />, disabled: !j || (!!share_?.current && !dirty) || !!saving, onSelect: () => { void share(); } },
    ...(historyItems.length > 1 ? historyItems.map((h, i) => ({ ...h, divider: i === 0 })) : []),
  ];

  const sharedHeader = which === 'client' && j ? <SharedHeader job={job} info={j} pill={clientPill} /> : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-line px-6 py-4">
        {onBack && <button type="button" onClick={onBack} className="mb-1 flex items-center gap-1 text-xs text-ink-dim hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" />Jobs</button>}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-tight text-ink">{job.title}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${status === 'take' ? PILL.ok : PILL.dim}`}>{STATUS_TEXT[status]}</span>
              {clientPill && <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${PILL[clientPill.tone]}`}>{clientPill.text}</span>}
              {j?.producer && <span className="text-[11px] text-ink-faint">from {j.producer}</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Menu label="Invite" align="end" keepOpen items={inviteItems} trigger={(p) => <Button {...p} size="sm" variant="secondary" leftIcon={<Share2 className="h-3.5 w-3.5" />} rightIcon={<ChevronDown className="h-3.5 w-3.5" />}>Invite</Button>} />
            <Menu label="More" align="end" keepOpen items={moreItems} trigger={(p) => <button {...p} aria-label="More" className="grid h-9 w-9 place-items-center rounded-full border border-line text-ink-dim hover:bg-surface-3 hover:text-ink"><MoreHorizontal className="h-4 w-4" /></button>} />
          </div>
        </div>
      </header>
      {error && <div role="alert" className="mx-6 mt-3 rounded-card border border-danger/40 bg-danger/10 p-2 text-xs text-ink">{error}</div>}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
        <div className="min-h-0 space-y-4 overflow-y-auto border-r border-line p-5">
          <section className={`${CARD} p-4`} aria-label="Script">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-ink">Script</h3>
              {j?.scriptN ? <span className="rounded-full bg-surface-3 px-2 py-0.5 font-num text-[11px] text-ink-dim">v{j.scriptN}</span> : null}
              <span className="flex-1" />
              {!editing && <button type="button" onClick={() => setEditing(true)} disabled={!j} aria-label="Edit script" title="Edit script" className="grid h-8 w-8 place-items-center rounded-full border border-line text-ink-dim hover:bg-surface-3 hover:text-ink disabled:opacity-40"><Pencil className="h-3.5 w-3.5" /></button>}
              <Menu label="Script options" align="end" keepOpen items={scriptItems} trigger={(p) => <button {...p} aria-label="Script options" title="Version history and client approval" className="grid h-8 w-8 place-items-center rounded-full border border-line text-ink-dim hover:bg-surface-3 hover:text-ink"><MoreHorizontal className="h-3.5 w-3.5" /></button>} />
            </div>
            {editing ? (
              <>
                <ScriptEditor id="job-script" rows={9} value={draft} onChange={setDraft} maxLength={20000} placeholder="What the talent reads." />
                <label className="mt-3 block text-xs font-medium text-ink-dim" htmlFor="job-notes">Director notes</label>
                <textarea id="job-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={6000} placeholder="Tone, pace, pronunciation. Shown to the talent apart from the script." className="mt-1 w-full resize-y rounded-card border border-line-strong bg-surface-1 p-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none" />
                <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
                  <p role="status" className="min-w-0 flex-1 truncate text-xs text-ink-dim">{saving || (dirty ? 'Unsaved changes' : 'No changes yet')}</p>
                  <Button size="sm" variant="ghost" disabled={!!saving} onClick={() => { setDraft(j?.script ?? ''); setNotes(j?.notes ?? ''); setEditing(false); }}>Cancel</Button>
                  <Button size="sm" variant="primary" disabled={!dirty || !!saving} onClick={() => void save()}>Save changes</Button>
                </div>
              </>
            ) : (
              <>
                <div className="max-h-[46dvh] overflow-y-auto text-[15px]">{j?.script?.trim() ? <FormattedScript script={j.script} /> : <p className="text-xs text-ink-faint">No script yet. Press the pencil to write one.</p>}</div>
                {j?.notes?.trim() ? <div className="mt-3 border-t border-line pt-3"><div className={`mb-1 ${LABEL}`}>Director notes</div><p className="whitespace-pre-wrap text-sm text-ink-dim">{j.notes}</p></div> : null}
              </>
            )}
          </section>

          <section className={`${CARD} p-4`} aria-label="Files">
            <h3 className="mb-1 text-sm font-semibold text-ink">Files</h3>
            {j?.reference && (
              <div className="border-b border-line py-2.5">
                <div className={`mb-1.5 ${LABEL}`}>Reference for the talent</div>
                <audio controls preload="none" src={audioUrl(job.id, j.reference.id, job.producerKey)} className="h-10 w-full" />
              </div>
            )}
            <ClientFiles jobId={job.id} producerKey={job.producerKey} info={j} reload={load} />
          </section>
        </div>

        <div className="flex min-h-0 flex-col p-5">
          <div role="tablist" aria-label="Conversations" className="mb-3 inline-flex self-start rounded-full border border-line bg-surface-1 p-0.5">
            {(['talent', 'client'] as const).map((w) => (
              <button key={w} type="button" role="tab" aria-selected={which === w} disabled={w === 'client' && !clientKey} onClick={() => setWhich(w)} className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${which === w ? 'bg-accent text-accent-ink' : 'text-ink-dim hover:text-ink'}`}>
                {w === 'talent' ? 'Talent' : 'Client'}{w === 'client' && clientUnread > 0 && <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-ink">{clientUnread}</span>}
              </button>
            ))}
          </div>
          {importing && <div className="mb-2 text-xs text-ink-dim">Adding {importing} to the project...</div>}
          <div className={`${CARD} min-h-0 flex-1 overflow-hidden`}>
            <ThreadView
              key={which}
              fill
              header={sharedHeader}
              messages={which === 'talent' ? messages : clientMessages}
              self="producer"
              folder={['Jobs', job.title]}
              audioSrc={(a) => audioUrl(job.id, a.id, job.producerKey)}
              onImport={which === 'talent' ? (a) => void doImport(a) : undefined}
              onSend={async (text) => { await postMessage(job.id, job.producerKey, j?.producer || 'Producer', text, which); await (which === 'talent' ? load() : loadClient()); }}
              onAttach={which === 'client' ? async (file, text) => { await sendAudio(job.id, job.producerKey, file, { name: file.name, who: j?.producer || 'Producer', text, thread: 'client' }); await loadClient(); } : undefined}
              placeholder={which === 'talent' ? 'Reply to the talent' : 'Reply to the client'}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

/** At the top of the client conversation: what the client was shown (the shared script) and hears (the preview), as they see it */
const SharedHeader: React.FC<{ job: StoredJob; info: JobInfo; pill: Pill | null }> = ({ job, info, pill }) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const n = info.share?.n;
  useEffect(() => { setText(null); }, [n]);
  useEffect(() => {
    if (!open || !n || text !== null) return;
    void getScriptVersion(job.id, job.producerKey, n).then((v) => setText(v.script)).catch(() => setText(''));
  }, [open, n, text, job.id, job.producerKey]);
  if (!info.share) return null;
  return (
    <div className="space-y-2 px-3 pt-3">
      {info.share && (
        <div className="overflow-hidden rounded-card border border-line bg-surface-2">
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-3">
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-ink">Shared script · version {info.share.n}</span><span className="block text-[11px] text-ink-dim">Shared {ago(info.share.at)}{pill ? ` · ${pill.text.replace(/ v\d+$/, '')}` : ''}</span></span>
            <ChevronDown className={`h-4 w-4 text-ink-dim transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {open && <div className="max-h-[40dvh] overflow-y-auto border-t border-line px-4 py-3 text-[15px]">{text === null ? <span className="text-xs text-ink-dim">Loading...</span> : <FormattedScript script={text} />}</div>}
        </div>
      )}
    </div>
  );
};
