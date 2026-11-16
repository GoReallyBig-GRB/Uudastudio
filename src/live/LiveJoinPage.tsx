/** What a guest sees at a live-event link: the event details and files, and whether the room is open. The room itself comes later. */
import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Music, Radio } from 'lucide-react';
import { getJoinInfo, LiveApiError, type JoinInfo } from './api';
import { parseBlocks, type Run } from '../guest/scriptFormat';
import { countdown, durationLabel, linksIn, parseLiveHash, whenParts } from './events';

const Linked: React.FC<{ text: string }> = ({ text }) => {
  const parts = text.split(/(https?:\/\/[^\s<>"')]+)/g);
  return <>{parts.map((p, i) => (linksIn(p).length && /^https?:\/\//.test(p) ? <a key={i} href={p.replace(/[.,;:!?]+$/, '')} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">{p}</a> : <React.Fragment key={i}>{p}</React.Fragment>))}</>;
};

const RunView: React.FC<{ run: Run }> = ({ run }) => {
  const body = <Linked text={run.text} />;
  let out: React.ReactNode = body;
  if (run.bold) out = <strong>{out}</strong>;
  if (run.italic) out = <em>{out}</em>;
  if (run.underline) out = <u>{out}</u>;
  return run.note ? <span className="rounded border border-line-strong px-1 text-xs italic text-ink-dim">{out}</span> : <>{out}</>;
};

/** The producer's formatted notes, read only, with links you can tap */
const NotesView: React.FC<{ notes: string }> = ({ notes }) => (
  <div className="text-sm leading-relaxed text-ink">
    {parseBlocks(notes).map((b, i) => {
      if (b.type === 'blank') return <div key={i} className="h-3" />;
      const runs = b.runs.map((r, j) => <RunView key={j} run={r} />);
      if (b.type === 'heading') return <div key={i} className={b.level === 1 ? 'mt-2 text-lg font-bold' : 'mt-1 text-base font-semibold text-ink-dim'}>{runs}</div>;
      const pad = { paddingLeft: `${b.indent * 1.5}em` };
      return b.type === 'item'
        ? <div key={i} style={pad} className="flex gap-2"><span className="w-5 shrink-0 text-right text-ink-faint">{b.marker}</span><span className="min-w-0">{runs}</span></div>
        : <div key={i} style={pad}>{runs}</div>;
    })}
  </div>
);

const LiveJoinPage: React.FC = () => {
  const token = parseLiveHash(window.location.hash);
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [error, setError] = useState('');
  const [skew, setSkew] = useState(0);
  const [tick, setTick] = useState(Date.now());

  const load = useCallback(async () => {
    if (!token) { setError('This link is not valid.'); return; }
    try { const i = await getJoinInfo(token); setInfo(i); setSkew(i.now - Date.now()); setError(''); }
    catch (e) { setError(e instanceof LiveApiError ? e.message : 'Could not reach the server. Check your connection.'); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = setInterval(() => { setTick(Date.now()); void load(); }, 15_000); return () => clearInterval(t); }, [load]);

  const now = tick + skew;
  return (
    <main className="min-h-screen bg-surface-0 px-4 py-10 text-ink">
      <div className="mx-auto flex max-w-xl flex-col gap-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gold"><Radio className="h-4 w-4" />Uuda Studio · Live session</div>
        {error && <p role="alert" className="rounded-card border border-danger/40 bg-danger/10 p-4 text-sm">{error}</p>}
        {!info && !error && <p className="text-sm text-ink-dim">Loading...</p>}
        {info && (
          <>
            <div>
              <h1 className="text-2xl font-bold">{info.title}</h1>
              {info.host && <p className="mt-1 text-sm text-ink-dim">Hosted by {info.host}</p>}
              {info.startsAt && <p className="mt-1 text-sm text-ink-dim">{whenParts(info.startsAt).date} · {whenParts(info.startsAt).time}{info.durationMin ? ` · ${durationLabel(info.durationMin)}` : ''}</p>}
            </div>
            <div role="status" className={`rounded-card border p-4 text-sm ${info.state === 'open' ? 'border-ok/50 bg-ok/10' : 'border-line-strong bg-surface-2'}`}>
              {info.state === 'open' && 'The host has opened this session. The live room is coming soon: keep this page open and you will be let in when it is ready.'}
              {info.state === 'waiting' && (info.startsAt && info.startsAt > now ? `This session is not open yet. It opens ${countdown(info.startsAt - now)}, or when the host opens it.` : 'This session is not open yet. It opens when the host starts it.')}
              {info.state === 'ended' && 'This session has ended.'}
            </div>
            {info.description && <p className="whitespace-pre-wrap text-sm text-ink-dim">{info.description}</p>}
            {info.notes && (
              <section aria-label="Event notes"><h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">Notes</h2><NotesView notes={info.notes} /></section>
            )}
            {info.files.length > 0 && (
              <section aria-label="Files"><h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">Files</h2>
                <ul className="flex flex-col gap-2">
                  {info.files.map((f) => (
                    <li key={f.id}><a href={`/api/live/join/${encodeURIComponent(token ?? '')}/files/${f.id}`} download={f.name} className="flex items-center gap-2 rounded-control border border-line bg-surface-2 px-3 py-2 text-sm text-ink hover:bg-surface-3">
                      {f.kind === 'audio' ? <Music className="h-4 w-4 text-ink-dim" /> : <FileText className="h-4 w-4 text-ink-dim" />}<span className="min-w-0 flex-1 truncate">{f.name}</span><span className="text-xs text-ink-faint">Download</span>
                    </a></li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
};
export default LiveJoinPage;
