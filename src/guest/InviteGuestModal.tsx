import React, { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { ScriptEditor } from '../components/ui/ScriptEditor';
import { Button, Input, ModalShell } from '../components/ui';
import { LINK_WARN_LENGTH, MAX_SCRIPT, countWords, estimateSeconds, formatClock, jobLink } from './job';

interface Props {
  open: boolean;
  onClose: () => void;
  defaultTitle: string;
}

/** Producer side: write the script and notes, get one link to send to the voice talent. Nothing is uploaded; the job is inside the link. */
export const InviteGuestModal: React.FC<Props> = ({ open, onClose, defaultTitle }) => {
  const [title, setTitle] = useState('');
  const [talent, setTalent] = useState('');
  const [producer, setProducer] = useState(() => { try { return localStorage.getItem('uuda-producer-name') ?? ''; } catch { return ''; } });
  const [script, setScript] = useState('');
  const [targetText, setTargetText] = useState('');
  const [copied, setCopied] = useState(false);

  const targetMin = Number(targetText);
  const targetSeconds = targetText.trim() && Number.isFinite(targetMin) && targetMin > 0 ? targetMin * 60 : undefined;
  const link = useMemo(
    () => jobLink({ v: 1, title: title.trim() || defaultTitle || 'Voice recording', script, targetSeconds, producer: producer.trim() || undefined, talent: talent.trim() || undefined }, window.location.origin + window.location.pathname),
    [title, defaultTitle, script, targetSeconds, producer, talent],
  );
  const words = countWords(script);
  const tooLong = link.length > LINK_WARN_LENGTH;

  const copy = async () => {
    try { localStorage.setItem('uuda-producer-name', producer.trim()); } catch { /* not saved */ }
    try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 2500); } catch { setCopied(false); }
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Invite voice talent"
      description="Write the script, copy the link, send it by email or WhatsApp. The talent records in their browser and sends you a WAV file."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={() => void copy()} leftIcon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}>{copied ? 'Link copied' : 'Copy link'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Job name" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={defaultTitle || 'Voice recording'} />
          <Input label="Your name (shown to the talent)" value={producer} onChange={(e) => setProducer(e.target.value)} />
          <Input label="Talent name (optional)" value={talent} onChange={(e) => setTalent(e.target.value)} />
        </div>
        <div>
          <label htmlFor="guest-script" className="mb-1.5 block text-xs font-medium text-ink-dim">Script</label>
          <ScriptEditor id="guest-script" value={script} maxLength={MAX_SCRIPT} onChange={setScript} rows={9} placeholder={'Type or paste the script.\nPut directions in [square brackets], for example [warm, smiling] or [pause]. The talent sees them highlighted and they are not counted as words to read.'} />
          <div className="mt-1 text-xs text-ink-dim">
            {words} words to read{words > 0 ? ` · about ${formatClock(estimateSeconds(script))} at a normal pace` : ''}
          </div>
        </div>
        <Input label="Target length (minutes, optional)" inputMode="decimal" value={targetText} onChange={(e) => setTargetText(e.target.value)} hint="Shown to the talent as a countdown while they record. Leave empty to use the estimate from the script." />
        <div>
          <div className="mb-1.5 text-xs font-medium text-ink-dim">Link</div>
          <div className="max-h-20 overflow-auto break-all rounded-card border border-line bg-surface-1 p-2 font-num text-[11px] text-ink-dim" aria-label="Guest link">{link}</div>
          {tooLong && <div role="alert" className="mt-1.5 text-xs text-warn">This link is very long and may be cut off by some apps. Shorten the script, or send the script as text and keep the link for recording.</div>}
          <div className="mt-1.5 text-xs text-ink-faint">Anyone with the link can record for this job. Nothing is stored on a server; the script is inside the link.</div>
        </div>
      </div>
    </ModalShell>
  );
};
