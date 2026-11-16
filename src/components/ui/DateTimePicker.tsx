import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { hour12, monthGrid, onDay, sameDay, startOfDay, withTime } from './dateTime';

interface Props {
  id?: string;
  label: string;
  /** Milliseconds since 1970, or null before one is chosen */
  value: number | null;
  onChange: (ms: number) => void;
  /** Days before this cannot be chosen */
  min?: number;
}

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const nextHour = () => { const d = new Date(); d.setMinutes(0, 0, 0); return d.getTime() + 3600_000; };
const SELECT = 'h-10 rounded-control border border-line-strong bg-surface-3 px-2.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50';

/** A date and time picker: a month calendar, a clock row, quick picks, and an OK button that closes it */
export const DateTimePicker: React.FC<Props> = ({ id, label, value, onChange, min }) => {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(() => new Date(value ?? Date.now()));
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const pop = useRef<HTMLDivElement | null>(null);
  const current = value ?? nextHour();
  const minDay = startOfDay(min ?? Date.now());
  const clock = hour12(current);

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const h = 470; const w = 330;
    const top = r.bottom + 8 + h > window.innerHeight ? Math.max(8, r.top - 8 - h) : r.bottom + 8;
    setPos({ left: Math.min(Math.max(8, r.left), window.innerWidth - w - 8), top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { const t = e.target as Node; if (!pop.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true); };
  }, [open]);

  const pick = (ms: number) => { onChange(Math.max(ms, 0)); };
  const grid = monthGrid(shown.getFullYear(), shown.getMonth());
  const today = new Date();
  const text = value === null ? 'Pick a date and time' : `${new Date(value).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  const quick = (label2: string, ms: number) => <button key={label2} type="button" onClick={() => { pick(ms); setShown(new Date(ms)); }} className="rounded-full border border-line px-3 py-1 text-xs text-ink-dim hover:border-accent/60 hover:text-accent cursor-pointer">{label2}</button>;
  const at = (days: number, h: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d.getTime(); };

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-ink-dim">{label}</label>
      <button ref={trigger} id={id} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setShown(new Date(value ?? Date.now())); if (value === null) pick(current); setOpen((o) => !o); }}
        className="flex h-10 w-full items-center gap-2.5 rounded-control border border-line-strong bg-surface-3 px-3 text-left text-sm text-ink hover:border-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer">
        <CalendarDays className="h-4 w-4 shrink-0 text-ink-dim" /><span className="min-w-0 flex-1 truncate">{text}</span>
      </button>
      {open && pos && (
        <div ref={pop} role="dialog" aria-label={label} style={{ left: pos.left, top: pos.top }} className="fixed z-[200] w-[330px] rounded-card border border-line-strong bg-surface-1 p-4 shadow-float">
          <div className="mb-3 flex items-center justify-between">
            <button type="button" aria-label="Previous month" onClick={() => setShown(new Date(shown.getFullYear(), shown.getMonth() - 1, 1))} className="grid h-8 w-8 place-items-center rounded-full text-ink-dim hover:bg-white/5 hover:text-ink cursor-pointer"><ChevronLeft className="h-4 w-4" /></button>
            <span className="text-sm font-semibold text-ink" aria-live="polite">{shown.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
            <button type="button" aria-label="Next month" onClick={() => setShown(new Date(shown.getFullYear(), shown.getMonth() + 1, 1))} className="grid h-8 w-8 place-items-center rounded-full text-ink-dim hover:bg-white/5 hover:text-ink cursor-pointer"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-7 text-center text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{WEEK.map((d) => <span key={d} className="py-1">{d}</span>)}</div>
          <div className="grid grid-cols-7 gap-y-1" role="grid">
            {grid.map(({ date, inMonth }) => {
              const disabled = date.getTime() + 86_399_999 < minDay;
              const selected = value !== null && sameDay(date, new Date(value));
              return (
                <button key={date.toISOString()} type="button" role="gridcell" aria-selected={selected} disabled={disabled} onClick={() => pick(onDay(current, date))}
                  className={`mx-auto grid h-9 w-9 place-items-center rounded-full text-sm transition-colors ${selected ? 'bg-accent font-bold text-accent-ink' : sameDay(date, today) ? 'border border-accent/60 text-accent' : inMonth ? 'text-ink hover:bg-white/10' : 'text-ink-faint/50 hover:bg-white/5'} ${disabled ? 'cursor-not-allowed opacity-30 hover:bg-transparent' : 'cursor-pointer'}`}>
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
            <Clock className="h-4 w-4 shrink-0 text-ink-dim" />
            <select aria-label="Hour" value={clock.h} onChange={(e) => pick(withTime(current, Number(e.target.value), new Date(current).getMinutes(), clock.pm))} className={SELECT}>{Array.from({ length: 12 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{h}</option>)}</select>
            <span className="text-ink-dim">:</span>
            <select aria-label="Minute" value={new Date(current).getMinutes()} onChange={(e) => pick(withTime(current, clock.h, Number(e.target.value), clock.pm))} className={SELECT}>
              {[...new Set([...MINUTES, new Date(current).getMinutes()])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
            </select>
            <div className="ml-auto inline-flex overflow-hidden rounded-control border border-line-strong" role="group" aria-label="AM or PM">
              {(['AM', 'PM'] as const).map((p) => <button key={p} type="button" aria-pressed={(p === 'PM') === clock.pm} onClick={() => pick(withTime(current, clock.h, new Date(current).getMinutes(), p === 'PM'))} className={`h-10 px-3 text-xs font-semibold cursor-pointer ${(p === 'PM') === clock.pm ? 'bg-accent text-accent-ink' : 'bg-surface-3 text-ink-dim hover:text-ink'}`}>{p}</button>)}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">{[quick('In 1 hour', nextHour()), quick('Today 6 PM', at(0, 18)), quick('Tomorrow 10 AM', at(1, 10)), quick('Next week', at(7, 10))]}</div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-xs text-ink-dim">{text}</span>
            <button type="button" onClick={() => { setOpen(false); trigger.current?.focus(); }} className="h-10 shrink-0 rounded-control border border-accent px-6 text-sm font-semibold text-accent transition-colors hover:bg-accent/10 active:bg-accent active:text-accent-ink cursor-pointer">OK</button>
          </div>
        </div>
      )}
    </div>
  );
};
