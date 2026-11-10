import React, { useRef } from 'react';
import { Bold, Brackets, Heading, IndentDecrease, IndentIncrease, Italic, List, ListOrdered, PauseCircle, Redo2, Sparkles, Underline, Undo2 } from 'lucide-react';
import { insertAt, tidy, wrapSelection, type Edit } from '../../guest/scriptEdit';
import { setLineStyle, shiftIndent, toggleMarker } from '../../guest/scriptFormat';

interface Props {
  id: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
}

const ICON = 'inline-flex h-8 w-8 items-center justify-center rounded-control text-ink-dim hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40';
const TOOL = 'inline-flex h-8 items-center gap-1.5 rounded-control px-2 text-xs font-medium text-ink-dim hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40';

/**
 * A small text editor for the script: Undo, Redo, bold / italic / underline, headings, numbered and bulleted lines, indents, directions in [brackets], pauses, and tidying pasted text.
 * It edits the same plain text the talent reads; directions show highlighted on their side.
 */
export const ScriptEditor: React.FC<Props> = ({ id, value, onChange, rows = 9, maxLength, placeholder }) => {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Edits go through the browser's own text insertion where it allows, so Undo and Redo keep working across them
  const apply = (make: (t: string, s: number, e: number) => Edit) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const r = make(el.value, el.selectionStart, el.selectionEnd);
    let done = false;
    // Replace only the part that changed, so Undo puts back just that part (and its selection) and not the whole script
    const old = el.value;
    let pre = 0;
    while (pre < old.length && pre < r.text.length && old[pre] === r.text[pre]) pre++;
    let suf = 0;
    while (suf < old.length - pre && suf < r.text.length - pre && old[old.length - 1 - suf] === r.text[r.text.length - 1 - suf]) suf++;
    try { el.setSelectionRange(pre, old.length - suf); done = document.execCommand('insertText', false, r.text.slice(pre, r.text.length - suf)); } catch { /* fall back below */ }
    if (!done || el.value !== r.text) onChange(r.text);
    requestAnimationFrame(() => { el.setSelectionRange(r.start, r.end); });
  };
  const history = (cmd: 'undo' | 'redo') => { ref.current?.focus(); try { document.execCommand(cmd); } catch { /* not supported */ } };

  return (
    <div className="rounded-card border border-line-strong bg-surface-1 focus-within:border-accent">
      <div role="toolbar" aria-label="Script tools" className="flex flex-wrap items-center gap-0.5 border-b border-line px-1.5 py-1">
        <button type="button" className={TOOL} aria-label="Undo" onMouseDown={(e) => e.preventDefault()} onClick={() => history('undo')}><Undo2 className="h-3.5 w-3.5" />Undo</button>
        <button type="button" className={TOOL} aria-label="Redo" onMouseDown={(e) => e.preventDefault()} onClick={() => history('redo')}><Redo2 className="h-3.5 w-3.5" />Redo</button>
        <span className="mx-1 h-4 w-px bg-line" aria-hidden />
        <button type="button" className={ICON} aria-label="Bold" title="Bold (Ctrl+B)" onMouseDown={(e) => e.preventDefault()} onClick={() => apply((t, s, e) => toggleMarker(t, s, e, '**'))}><Bold className="h-4 w-4" /></button>
        <button type="button" className={ICON} aria-label="Italic" title="Italic (Ctrl+I)" onMouseDown={(e) => e.preventDefault()} onClick={() => apply((t, s, e) => toggleMarker(t, s, e, '*'))}><Italic className="h-4 w-4" /></button>
        <button type="button" className={ICON} aria-label="Underline" title="Underline (Ctrl+U)" onMouseDown={(e) => e.preventDefault()} onClick={() => apply((t, s, e) => toggleMarker(t, s, e, '__'))}><Underline className="h-4 w-4" /></button>
        <span className="mx-1 h-4 w-px bg-line" aria-hidden />
        <button type="button" className={ICON} aria-label="Heading" title="Make the lines a heading (shown bigger, not counted as words to read)" onMouseDown={(e) => e.preventDefault()} onClick={() => apply((t, s, e) => setLineStyle(t, s, e, 'heading'))}><Heading className="h-4 w-4" /></button>
        <button type="button" className={ICON} aria-label="Numbered list" title="Number the lines" onMouseDown={(e) => e.preventDefault()} onClick={() => apply((t, s, e) => setLineStyle(t, s, e, 'numbered'))}><ListOrdered className="h-4 w-4" /></button>
        <button type="button" className={ICON} aria-label="Bullet list" title="Bullet the lines" onMouseDown={(e) => e.preventDefault()} onClick={() => apply((t, s, e) => setLineStyle(t, s, e, 'bullets'))}><List className="h-4 w-4" /></button>
        <button type="button" className={ICON} aria-label="Indent" title="Indent the lines" onMouseDown={(e) => e.preventDefault()} onClick={() => apply((t, s, e) => shiftIndent(t, s, e, 1))}><IndentIncrease className="h-4 w-4" /></button>
        <button type="button" className={ICON} aria-label="Outdent" title="Outdent the lines" onMouseDown={(e) => e.preventDefault()} onClick={() => apply((t, s, e) => shiftIndent(t, s, e, -1))}><IndentDecrease className="h-4 w-4" /></button>
        <span className="mx-1 h-4 w-px bg-line" aria-hidden />
        <button type="button" className={TOOL} title="Put the selected words in [brackets] as a direction" onMouseDown={(e) => e.preventDefault()} onClick={() => apply((t, s, e) => wrapSelection(t, s, e, '[', ']'))}><Brackets className="h-3.5 w-3.5" />Direction</button>
        <button type="button" className={TOOL} title="Insert [pause]" onMouseDown={(e) => e.preventDefault()} onClick={() => apply((t, s, e) => insertAt(t, s, e, '[pause]'))}><PauseCircle className="h-3.5 w-3.5" />Pause</button>
        <span className="mx-1 h-4 w-px bg-line" aria-hidden />
        <button type="button" className={TOOL} title="Straighten quotes, remove extra spaces and blank lines" disabled={!value.trim()} onMouseDown={(e) => e.preventDefault()} onClick={() => apply((t) => ({ text: tidy(t), start: 0, end: 0 }))}><Sparkles className="h-3.5 w-3.5" />Tidy</button>
      </div>
      <textarea
        ref={ref}
        id={id}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
          const key = e.key.toLowerCase();
          const m = key === 'b' ? '**' : key === 'i' ? '*' : key === 'u' ? '__' : null;
          if (m) { e.preventDefault(); apply((t, s, en) => toggleMarker(t, s, en, m)); }
        }}
        rows={rows}
        placeholder={placeholder}
        className="block w-full resize-y rounded-b-card bg-transparent p-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
      />
    </div>
  );
};
