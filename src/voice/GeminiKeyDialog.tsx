/** Shown when someone tries AI voice without a Gemini key: how to get a free key (from the "Activate Your AI Voice" guide), and a field to connect it. */
import React, { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button, ModalShell } from '../components/ui';
import { authService } from '../services/authService';

export const NEED_GEMINI_KEY_EVENT = 'uuda:need-gemini-key';
export const AI_STUDIO_URL = 'https://aistudio.google.com/onboarding';

const STEPS: Array<{ title: string; text: string }> = [
  { title: 'Open Google AI Studio', text: 'Sign in with your Google account if asked.' },
  { title: 'Accept and continue', text: 'Tick the required acknowledgement, then press Continue. The email box is optional.' },
  { title: 'Press Skip', text: 'When Google asks what brings you to AI Studio, choose Skip.' },
  { title: 'Open Dashboard', text: 'In the left menu, under Manage, click Dashboard.' },
  { title: 'Choose Default Gemini API Key', text: 'If you land on a Create API key page instead, go back and click Dashboard again.' },
  { title: 'Copy the API Key', text: 'Press Copy key next to the value labelled API Key. Do not copy the project name or number.' },
];

export const looksLikeGeminiKey = (k: string): boolean => /^[\w.-]{20,}$/.test(k.trim());

export const GeminiKeyDialog: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const show = () => { setKey(''); setError(''); setDone(false); setOpen(true); };
    window.addEventListener(NEED_GEMINI_KEY_EVENT, show);
    return () => window.removeEventListener(NEED_GEMINI_KEY_EVENT, show);
  }, []);

  const connect = () => {
    if (!looksLikeGeminiKey(key)) { setError('That does not look like an API key. Copy the value labelled API Key.'); return; }
    authService.setOwnGeminiKey(key.trim());
    setKey(''); setDone(true);
  };

  return (
    <ModalShell open={open} onClose={() => setOpen(false)} title="Connect your free Gemini key" description="AI voices use your own Google Gemini access. It takes about two minutes." size="md" blockShortcuts
      footer={done ? <Button variant="primary" onClick={() => setOpen(false)}>Done</Button> : <Button variant="ghost" onClick={() => setOpen(false)}>Not now</Button>}>
      {done ? (
        <p role="status" className="rounded-card border border-ok/50 bg-ok/10 p-4 text-sm text-ink">Gemini voice is connected. Try your voice again.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <a href={AI_STUDIO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-control bg-accent px-4 text-sm font-semibold text-accent-ink hover:brightness-110">
            <ExternalLink className="h-4 w-4" />Open Google AI Studio
          </a>
          <ol className="flex flex-col gap-2.5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-accent/50 text-[11px] font-bold text-accent">{i + 1}</span>
                <span className="text-sm text-ink"><span className="font-semibold">{s.title}.</span> <span className="text-ink-dim">{s.text}</span></span>
              </li>
            ))}
          </ol>
          <div>
            <label htmlFor="gemini-key" className="mb-1.5 block text-xs font-medium text-ink-dim">Paste it here</label>
            <div className="flex gap-2">
              <input id="gemini-key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => { setKey(e.target.value); setError(''); }} onKeyDown={(e) => { if (e.key === 'Enter') connect(); }} placeholder="Your Gemini API key"
                className="h-10 min-w-0 flex-1 rounded-control border border-line-strong bg-surface-3 px-3.5 font-mono text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" />
              <Button variant="primary" onClick={connect} disabled={!key.trim()}>Connect</Button>
            </div>
            {error && <p role="alert" className="mt-1.5 text-xs text-danger">{error}</p>}
          </div>
          <p className="text-[11px] text-ink-faint">Keep your key private. Google's free tier has limits, so free does not mean unlimited voice generation.</p>
        </div>
      )}
    </ModalShell>
  );
};
