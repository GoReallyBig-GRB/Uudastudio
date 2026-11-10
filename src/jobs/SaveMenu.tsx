import React, { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { canPickFolder, saveToCloud, saveToComputer } from './saveFile';
import { ROOT_NAME, cleanName, studioFolderLabel } from './studioFolder';

interface Props {
  /** The file, or a way to fetch it (received audio is fetched only when the person chooses where to put it) */
  getBlob: () => Promise<Blob>;
  name: string;
  label?: string;
  /** Sub-folders inside Uuda Studio where this file belongs, e.g. ["Jobs", "Intro spot"] */
  folder?: string[];
  /** Visual style: "pill" is the small chip used in message bubbles, "button" is a full-size button */
  look?: 'pill' | 'button';
}

/** One Save button that asks where the file should go: this computer, or cloud storage through the device's own save menu. */
export const SaveMenu: React.FC<Props> = ({ getBlob, name, label = 'Save', look = 'pill', folder = ['Jobs'] }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const root = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({});
  /** Fixed to the screen so a scrolling message list cannot clip it; opens upward when there is more room above */
  const toggle = () => {
    if (!open && btn.current) {
      const b = btn.current.getBoundingClientRect(), w = Math.min(240, window.innerWidth * 0.8), h = 150;
      const up = window.innerHeight - b.bottom < h && b.top > h;
      const left = Math.max(8, Math.min(window.innerWidth - w - 8, look === 'pill' ? b.right - w : b.left));
      setPos({ position: 'fixed', left, width: w, ...(up ? { bottom: window.innerHeight - b.top + 4 } : { top: b.bottom + 4 }) });
    }
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  useEffect(() => { if (!note) return; const t = window.setTimeout(() => setNote(''), 6000); return () => window.clearTimeout(t); }, [note]);

  const [home, setHome] = useState('');
  useEffect(() => { if (open) void studioFolderLabel().then(setHome); }, [open]);
  const go = async (to: 'computer' | 'cloud' | 'move') => {
    setOpen(false); setBusy(true); setNote('');
    try {
      const blob = await getBlob();
      setNote(await (to === 'cloud' ? saveToCloud(blob, name) : saveToComputer(blob, name, folder, { choose: to === 'move' })));
    } catch (e) { setNote(e instanceof Error ? e.message : 'The file could not be saved.'); } finally { setBusy(false); }
  };
  const cls = look === 'pill'
    ? 'inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-ink hover:bg-surface-3 disabled:opacity-60'
    : 'inline-flex h-11 items-center gap-2 rounded-card bg-accent px-4 text-sm font-semibold text-[var(--accent-ink,#041014)] hover:brightness-110 disabled:opacity-60';
  const item = 'block w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface-3';
  return (
    <span ref={root} className="inline-flex flex-col items-start">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`${label} ${name}`} disabled={busy} onClick={toggle} ref={btn} className={cls}>
        <Download className={look === 'pill' ? 'h-3 w-3' : 'h-4 w-4'} />{busy ? 'Saving…' : label}
      </button>
      {open && (
        <span role="menu" aria-label="Where to save" style={pos} className="z-50 overflow-hidden rounded-card border border-line bg-surface-1 shadow-lg">
          <button type="button" role="menuitem" className={item} onClick={() => void go('computer')}>
            This computer<span className="block text-[11px] text-ink-dim">{canPickFolder() ? (home ? `Saved in ${ROOT_NAME} / ${folder.map((f) => cleanName(f)).join(' / ')}` : `You pick where the ${ROOT_NAME} folder lives, once. Every save after goes into it.`) : 'Goes to your Downloads folder'}</span>
          </button>
          {canPickFolder() && home && (
            <button type="button" role="menuitem" className={`${item} border-t border-line`} onClick={() => void go('move')}>
              Change the {ROOT_NAME} folder<span className="block text-[11px] text-ink-dim">Now: {home}. Saves this file in the new place.</span>
            </button>
          )}
          <button type="button" role="menuitem" className={`${item} border-t border-line`} onClick={() => void go('cloud')}>
            Cloud storage<span className="block text-[11px] text-ink-dim">Opens your device's save menu (iCloud, Drive, Dropbox, Files)</span>
          </button>
        </span>
      )}
      {note && <span role="status" className="mt-1 max-w-60 text-[11px] text-ink-dim">{note}</span>}
    </span>
  );
};
