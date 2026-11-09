import React, { useEffect, useRef, useState } from 'react';
import { Download, Send } from 'lucide-react';
import { Button } from '../components/ui';
import type { Attachment, ThreadMessage } from './api';

const clock = (ts: number) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

interface Props {
  messages: ThreadMessage[];
  self: 'producer' | 'talent';
  audioSrc: (a: Attachment) => string;
  /** Producer only: bring a received take into the project */
  onImport?: (a: Attachment) => void;
  onSend: (text: string) => Promise<void>;
  placeholder?: string;
  /** Extra controls next to Send (for example a take to attach) */
  disabled?: boolean;
}

/** The message thread under a job: messages and audio on top, a box to write at the bottom. The same on both sides. */
export const ThreadView: React.FC<Props> = ({ messages, self, audioSrc, onImport, onSend, placeholder, disabled }) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length]);

  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setError('');
    try { await onSend(t); setText(''); } catch (e) { setError(e instanceof Error ? e.message : 'The message was not sent.'); } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <ul className="flex flex-col gap-2" aria-label="Messages" aria-live="polite">
        {messages.length === 0 && <li className="rounded-card border border-dashed border-line px-3 py-4 text-center text-xs text-ink-faint">No messages yet.</li>}
        {messages.map((m) => {
          const mine = m.role === self;
          return (
            <li key={m.id} className={`max-w-[92%] rounded-card border px-3 py-2 text-sm ${mine ? 'self-end border-accent/30 bg-accent-soft text-ink' : 'self-start border-line bg-surface-2 text-ink'}`}>
              <div className="mb-0.5 flex items-baseline justify-between gap-3 text-[10px] text-ink-dim"><span className="font-semibold">{m.name}</span><span className="font-num">{clock(m.ts)}</span></div>
              {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
              {m.attachment && (
                <div className="mt-1.5">
                  <audio controls preload="none" src={audioSrc(m.attachment)} className="h-9 w-full" aria-label={`Play ${m.attachment.name}`} />
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-ink-dim">
                    <span className="min-w-0 truncate">{m.attachment.name} · {mb(m.attachment.bytes)}</span>
                    <span className="flex shrink-0 gap-1">
                      <a href={audioSrc(m.attachment)} download={m.attachment.name} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-ink hover:bg-surface-3"><Download className="h-3 w-3" />Save</a>
                      {onImport && <button type="button" onClick={() => onImport(m.attachment!)} className="rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 font-semibold text-accent hover:brightness-125">Add to project</button>}
                    </span>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        <div ref={end} />
      </ul>
      <div>
        {error && <div role="alert" className="mb-1.5 text-xs text-danger">{error}</div>}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}
            rows={2}
            maxLength={4000}
            aria-label="Write a message"
            placeholder={placeholder ?? 'Write a message'}
            className="min-h-[44px] flex-1 resize-y rounded-card border border-line-strong bg-surface-1 p-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          />
          <Button size="md" variant="primary" disabled={!text.trim() || busy || disabled} onClick={() => void submit()} leftIcon={<Send className="h-4 w-4" />}>Send</Button>
        </div>
      </div>
    </div>
  );
};
