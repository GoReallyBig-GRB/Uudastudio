import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, FileText, MessageSquareWarning, Paperclip, Send } from 'lucide-react';
import { AUDIO_ACCEPT, type Attachment, type ThreadMessage } from './api';
import { SaveMenu } from './SaveMenu';
import { expiryLine } from './saveFile';

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
const hm = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayKey = (ts: number) => new Date(ts).toDateString();
const dayLabel = (ts: number, now = Date.now()) => {
  const d = new Date(ts).toDateString();
  if (d === new Date(now).toDateString()) return 'Today';
  if (d === new Date(now - 86400000).toDateString()) return 'Yesterday';
  return new Date(ts).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
};
/** Messages from the same side within five minutes sit together as one group */
const GROUP_MS = 5 * 60 * 1000;

interface Props {
  messages: ThreadMessage[];
  self: 'producer' | 'talent' | 'client';
  audioSrc: (a: Attachment) => string;
  /** Where saved files belong inside the Uuda Studio folder, e.g. ["Jobs", "Intro spot"] */
  folder?: string[];
  /** Producer only: bring a received take into the project */
  onImport?: (a: Attachment) => void;
  onSend: (text: string) => Promise<void>;
  /** Producer only: send an audio file into this thread, with the text (if any) as its caption */
  onAttach?: (file: File, text: string) => Promise<void>;
  placeholder?: string;
  disabled?: boolean;
  /** Fill the height of the parent: the messages scroll and the box stays at the bottom */
  fill?: boolean;
  /** Shown at the top of the conversation and scrolling with it (the shared script and files) */
  header?: React.ReactNode;
  /** Opens the script from a "script shared" card */
  onOpenScript?: (n: number) => void;
  /** Client only: answer the latest preview. `id` is the preview's message. */
  onPreviewDecision?: (id: number, kind: 'approve' | 'changes', text: string) => Promise<void>;
}

/**
 * The message thread under a job, laid out like a chat app: your messages on the right, theirs on the left, grouped by sender,
 * day dividers, the time inside each bubble, and a rounded box with a round send button at the bottom. The same on both sides.
 */
export const ThreadView: React.FC<Props> = ({ messages, self, audioSrc, folder, onImport, onSend, onAttach, placeholder, disabled, fill, header, onOpenScript, onPreviewDecision }) => {
  const [pvText, setPvText] = useState('');
  const [pvAsk, setPvAsk] = useState(false);
  const [pvBusy, setPvBusy] = useState(false);
  const latestPreview = [...messages].reverse().find((m) => m.event?.type === 'preview');
  const decided = !!latestPreview && messages.some((m) => m.id > latestPreview.id && (m.event?.type === 'pvapproved' || m.event?.type === 'pvchanges') && m.event.n === latestPreview.id);
  const decide = async (id: number, kind: 'approve' | 'changes') => {
    if (!onPreviewDecision) return;
    if (kind === 'changes' && !pvText.trim()) return;
    setPvBusy(true); setError('');
    try { await onPreviewDecision(id, kind, pvText.trim()); setPvText(''); setPvAsk(false); } catch (e) { setError(e instanceof Error ? e.message : 'That was not sent.'); } finally { setPvBusy(false); }
  };
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attach = async (f: File) => {
    if (!onAttach) return;
    setBusy(true); setError('');
    try { await onAttach(f, text.trim()); setText(''); } catch (e) { setError(e instanceof Error ? e.message : 'The file could not be sent.'); } finally { setBusy(false); }
  };
  // On a phone, Enter makes a new line and the round button sends, as in other chat apps; on a computer Enter sends
  const touch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

  useLayoutEffect(() => { const el = scrollRef.current; if (el && fill) el.scrollTop = el.scrollHeight; }, [messages.length, fill]);
  useEffect(() => {
    const t = boxRef.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, 132)}px`;
  }, [text]);

  const submit = async () => {
    const t = text.trim();
    if (!t || busy || disabled) return;
    setBusy(true); setError('');
    try { await onSend(t); setText(''); } catch (e) { setError(e instanceof Error ? e.message : 'The message was not sent.'); } finally { setBusy(false); }
  };

  return (
    <div className={`flex min-h-0 flex-col ${fill ? 'h-full' : 'gap-3'}`}>
      <div className={fill ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain' : ''} ref={scrollRef}>
      {header}
      <ul ref={listRef} className="flex flex-col px-3 py-2" aria-label="Messages" aria-live="polite">
        {messages.length === 0 && <li className="mx-auto my-6 max-w-xs rounded-card border border-dashed border-line px-3 py-4 text-center text-xs text-ink-faint">No messages yet. Write here to start the conversation.</li>}
        {messages.map((m, i) => {
          const prev = messages[i - 1], next = messages[i + 1];
          const mine = m.role === self;
          const newDay = !prev || dayKey(prev.ts) !== dayKey(m.ts);
          const joinsPrev = !!prev && !newDay && prev.role === m.role && m.ts - prev.ts < GROUP_MS;
          const joinsNext = !!next && dayKey(next.ts) === dayKey(m.ts) && next.role === m.role && next.ts - m.ts < GROUP_MS;
          if (m.event && m.event.type !== 'preview') {
            const who = m.role === self ? 'You' : m.name;
            const t = m.event.type;
            const good = t === 'approved' || t === 'pvapproved', ask = t === 'changes' || t === 'pvchanges';
            const tone = good ? { chip: 'bg-ok/15 text-ok', text: 'text-ok', bar: 'border-ok/50' } : ask ? { chip: 'bg-warn/15 text-warn', text: 'text-warn', bar: 'border-warn/50' } : { chip: 'bg-accent-soft text-accent', text: 'text-accent', bar: 'border-accent/50' };
            const icon = good ? <Check className="h-3.5 w-3.5" /> : ask ? <MessageSquareWarning className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />;
            const label = t === 'shared' ? `${who === 'You' ? 'You shared' : `${who} shared`} the script (v${m.event.n})` : t === 'approved' ? `${who} approved v${m.event.n}` : t === 'pvapproved' ? `${who} approved the preview` : t === 'pvchanges' ? `${who} asked for changes to the preview` : `${who} asked for changes to v${m.event.n}`;
            const note = ask ? m.text : '';
            return (
              <React.Fragment key={m.id}>
                {newDay && <li className="my-3 self-center rounded-full bg-surface-2 px-3 py-0.5 text-[11px] font-medium text-ink-dim" aria-hidden>{dayLabel(m.ts)}</li>}
                <li className="my-3 w-full self-stretch" aria-label={`Update: ${label}`}>
                  {/* A status update, not a message: no bubble, a coloured round icon, small text, and a hairline either side */}
                  <div className="flex items-center gap-2.5">
                    <span aria-hidden className="h-px flex-1 bg-line" />
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${tone.chip}`}>{icon}</span>
                    <span className="max-w-[70%] text-center text-[11px] font-medium uppercase tracking-wide text-ink-dim"><span className={tone.text}>{label}</span><span className="ml-2 font-num normal-case text-ink-faint">{hm(m.ts)}</span></span>
                    <span aria-hidden className="h-px flex-1 bg-line" />
                  </div>
                  {note && (
                    <div className="mx-auto mt-2 max-w-[84%]">
                      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Note from {m.role === self ? 'you' : m.name}</div>
                      <p className={`whitespace-pre-wrap break-words rounded-md border-l-2 bg-surface-2/60 px-3 py-1.5 text-sm text-ink ${tone.bar}`}>{note}</p>
                    </div>
                  )}
                  {m.event.type === 'shared' && onOpenScript && <div className="mt-1 text-center"><button type="button" onClick={() => onOpenScript(m.event!.n)} className="text-[11px] font-semibold text-accent hover:brightness-125">Read the script</button></div>}
                </li>
              </React.Fragment>
            );
          }
          return (
            <React.Fragment key={m.id}>
              {newDay && <li className="my-3 self-center rounded-full bg-surface-2 px-3 py-0.5 text-[11px] font-medium text-ink-dim" aria-hidden>{dayLabel(m.ts)}</li>}
              <li className={`flex max-w-[84%] flex-col ${mine ? 'self-end items-end' : 'self-start items-start'} ${joinsPrev ? 'mt-0.5' : 'mt-2'}`}>
                <div className={`min-w-0 px-3 py-1.5 text-sm text-ink ${mine ? 'bg-accent-soft' : 'bg-surface-2'} rounded-2xl ${mine ? (joinsNext ? '' : 'rounded-br-md') : (joinsNext ? '' : 'rounded-bl-md')}`}>
                  {!mine && !joinsPrev && <div className="mb-0.5 text-xs font-semibold text-accent">{m.name}</div>}
                  {m.event?.type === 'preview' && <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">Preview</div>}
                  {m.attachment && (
                    <div className="mb-1 w-[min(280px,70vw)]">
                      <audio controls preload="none" src={audioSrc(m.attachment)} className="h-10 w-full" aria-label={`Play ${m.attachment.name}`} />
                      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-ink-dim">
                        <span className="min-w-0 truncate">{m.attachment.name} · {mb(m.attachment.bytes)}</span>
                        <span className="flex shrink-0 gap-1">
                          <SaveMenu folder={folder} name={m.attachment.name} getBlob={async () => { const r = await fetch(audioSrc(m.attachment!)); if (!r.ok) throw new Error('The file could not be downloaded.'); return r.blob(); }} />
                          {onImport && <button type="button" onClick={() => onImport(m.attachment!)} className="rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 font-semibold text-accent hover:brightness-125">Add to project</button>}
                        </span>
                      </div>
                      {(() => { const e = expiryLine(m.attachment.expiresAt); return e ? <p className={`mt-1 text-[11px] ${e.soon ? 'text-warn' : 'text-ink-faint'}`}>{e.text}</p> : null; })()}
                    </div>
                  )}
                  {m.attachmentExpired && <p className="mb-1 text-[11px] text-ink-faint">{m.event?.type === 'preview' ? 'This preview was replaced by a newer one.' : 'This recording expired and was deleted from the server.'}</p>}
                  {m.event?.type === 'preview' && m.id === latestPreview?.id && m.attachment && onPreviewDecision && !decided && (
                    <div className="mb-1.5 w-[min(280px,70vw)]">
                      {pvAsk ? (
                        <>
                          <textarea value={pvText} onChange={(e) => setPvText(e.target.value)} rows={3} maxLength={4000} aria-label="What should change" placeholder="What should change?" className="w-full resize-none rounded-card border border-line-strong bg-surface-1 p-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none" />
                          <div className="mt-1.5 flex gap-2"><button type="button" disabled={pvBusy || !pvText.trim()} onClick={() => void decide(m.id, 'changes')} className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink disabled:opacity-40">Send</button><button type="button" disabled={pvBusy} onClick={() => setPvAsk(false)} className="rounded-full border border-line px-3 py-1 text-xs text-ink-dim">Cancel</button></div>
                        </>
                      ) : (
                        <div className="flex gap-2"><button type="button" disabled={pvBusy} onClick={() => void decide(m.id, 'approve')} className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink disabled:opacity-40">Approve</button><button type="button" disabled={pvBusy} onClick={() => setPvAsk(true)} className="rounded-full border border-line-strong px-3 py-1 text-xs font-semibold text-ink hover:bg-surface-3">Request changes</button></div>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap items-end justify-end gap-x-3">
                    {m.text && <p className="min-w-0 max-w-full flex-1 whitespace-pre-wrap break-words">{m.text}</p>}
                    <span className="ml-auto shrink-0 translate-y-0.5 font-num text-[10px] leading-none text-ink-dim">{hm(m.ts)}</span>
                  </div>
                </div>
              </li>
            </React.Fragment>
          );
        })}
      </ul>
      </div>
      <div className={`${fill ? 'border-t border-line bg-surface-1 px-2 pt-2' : ''}`} style={fill ? { paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' } : undefined}>
        {error && <div role="alert" className="mb-1.5 px-2 text-xs text-danger">{error}</div>}
        <div className="flex items-end gap-2 lg:gap-1.5">
          {onAttach && (
            <>
              <button type="button" aria-label="Attach audio" disabled={busy || disabled} onClick={() => fileRef.current?.click()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line-strong text-ink-dim hover:bg-surface-3 disabled:opacity-40 lg:h-10 lg:w-10"><Paperclip className="h-5 w-5 lg:h-4 lg:w-4" /></button>
              <input ref={fileRef} type="file" accept={AUDIO_ACCEPT} hidden aria-label="Audio file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void attach(f); }} />
            </>
          )}
          <textarea
            ref={boxRef}
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (!touch || e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}
            rows={1}
            maxLength={4000}
            aria-label="Write a message"
            placeholder={placeholder ?? 'Write a message'}
            enterKeyHint={touch ? 'enter' : 'send'}
            className="max-h-[132px] min-h-[44px] flex-1 resize-none rounded-3xl border border-line-strong bg-surface-2 px-4 py-[10px] text-base leading-6 lg:min-h-[40px] lg:py-2 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 lg:text-sm"
          />
          <button type="button" aria-label="Send message" disabled={!text.trim() || busy || disabled} onClick={() => void submit()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition-opacity hover:brightness-110 disabled:opacity-40 lg:h-10 lg:w-10"><Send className="h-5 w-5 lg:h-4 lg:w-4" /></button>
        </div>
        {!touch && <p className="px-3 pb-0.5 pt-1 text-[10px] text-ink-faint">Enter to send · Shift+Enter for a new line</p>}
      </div>
    </div>
  );
};
