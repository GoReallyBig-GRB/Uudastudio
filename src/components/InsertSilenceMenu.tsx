import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { Button, CapsuleButton, SegmentedControl } from './ui';
import { MAX_SILENCE_SECONDS, type SilenceScope } from './insertSilence';
import { formatTimecode } from '../utils/formatters';
import { getPlayhead } from '../playback/playheadStore';

interface Props {
  disabled?: boolean;
  /** Length of the highlighted range, when there is one: it becomes the default length and the gap opens at its start */
  rangeSeconds: number | null;
  /** Where the range starts (the gap opens there when there is a range) */
  rangeStartSeconds?: number | null;
  onInsert: (lengthSeconds: number, scope: SilenceScope) => void;
}

/** The small arrow beside Silence: "Insert silence" with a length and whether other tracks move too. */
export const InsertSilenceMenu: React.FC<Props> = ({ disabled, rangeSeconds, rangeStartSeconds, onInsert }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [text, setText] = useState('1');
  const [scope, setScope] = useState<SilenceScope>('track');
  const [at, setAt] = useState(0);
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('[data-silence-menu]') || anchor.current?.contains(t))) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [open]);

  const toggle = () => {
    const r = anchor.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.min(window.innerWidth - 296, Math.max(8, r.left)), top: r.bottom + 6 });
    if (!open) setText(rangeSeconds ? rangeSeconds.toFixed(2).replace(/\.?0+$/, '') : '1');
    setAt(rangeSeconds && rangeStartSeconds != null ? rangeStartSeconds : getPlayhead());
    setOpen((v) => !v);
  };

  const length = Math.min(MAX_SILENCE_SECONDS, parseFloat(text.replace(',', '.')));
  const valid = Number.isFinite(length) && length > 0;
  const go = () => { if (valid) { onInsert(length, scope); setOpen(false); } };

  return (
    <>
      <span ref={anchor} className="inline-flex">
        <CapsuleButton iconOnly title="Insert silence: open a gap of a chosen length at the playhead (or at the start of the highlighted range)" disabled={disabled} onClick={toggle} icon={<ChevronDown className="h-3 w-3" />} aria-expanded={open} />
      </span>
      {open && (
        <div data-silence-menu style={{ left: pos.left, top: pos.top }} className="fixed z-50 w-72 space-y-3 rounded-card border border-line-strong bg-surface-2 p-3 shadow-float uuda-pop-in">
          <div className="text-[11px] font-semibold text-ink">Insert silence</div>
          <div className="text-[10px] text-ink-dim">
            {rangeSeconds ? 'At the start of the highlighted range' : 'At the playhead'}: <span className="font-num text-ink">{formatTimecode(at)}</span>
          </div>
          <label className="flex items-center justify-between gap-3 text-[11px] text-ink-dim">
            Length (seconds)
            <input
              autoFocus
              inputMode="decimal"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') go(); }}
              aria-label="Silence length in seconds"
              className="h-7 w-24 rounded-control border border-line-strong bg-surface-1 px-2 text-right font-num text-[12px] text-ink outline-none focus:border-accent"
            />
          </label>
          <div>
            <div className="mb-1 text-[10px] text-ink-dim">What moves later</div>
            <SegmentedControl
              size="sm"
              value={scope}
              onChange={(v) => setScope(v)}
              options={[{ value: 'track', label: 'This track' }, { value: 'all', label: 'All tracks' }] as const}
              label="What moves later"
            />
            <div className="mt-1 text-[10px] text-ink-faint">
              {scope === 'track' ? 'Only this track moves. Other tracks stay where they are, so they may no longer line up.' : 'Every track opens the same gap, so music, dialogue and effects stay in sync.'}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={go} disabled={!valid} leftIcon={<Plus className="h-3 w-3" />}>Insert</Button>
          </div>
        </div>
      )}
    </>
  );
};
