import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bold, Brackets, Heading, IndentDecrease, IndentIncrease, Italic, List, ListOrdered, PauseCircle, Redo2, Sparkles, Underline, Undo2 } from 'lucide-react';
import { tidy } from '../../guest/scriptEdit';
import { MAX_INDENT, domToMarkup, lineHtml, markupToHtml, type LineKind } from '../../guest/richScript';

interface Props {
  id: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  /** Read only: shows the script with its formatting and no tools */
  readOnly?: boolean;
}

const ICON = 'inline-flex h-8 w-8 items-center justify-center rounded-control text-ink-dim hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40';
const TOOL = 'inline-flex h-8 items-center gap-1.5 rounded-control px-2 text-xs font-medium text-ink-dim hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40';
const keep = (e: React.MouseEvent) => e.preventDefault(); // pressing a tool must not take the selection away from the text

/** How the lines look. Numbers count on their own; an indent moves a line in by 1.5em per level. */
const CSS = `
.uuda-rich{outline:none;line-height:1.6;counter-reset:n}
.uuda-rich>div{position:relative;min-height:1.6em;padding-left:calc(var(--i,0)*1.5em);word-break:break-word}
.uuda-rich>div:not([data-k=ol]){counter-reset:n}
.uuda-rich>div[data-k=ol]{counter-increment:n}
.uuda-rich>div[data-k=h1]{font-size:1.25em;font-weight:700;margin-top:.5em}
.uuda-rich>div[data-k=h2]{font-size:1.1em;font-weight:600;margin-top:.35em;opacity:.8}
.uuda-rich>div[data-k=ul],.uuda-rich>div[data-k=ol]{padding-left:calc(var(--i,0)*1.5em + 1.9em)}
.uuda-rich>div[data-k=ul]::before{content:"\\2022";position:absolute;left:calc(var(--i,0)*1.5em);width:1.5em;text-align:right;opacity:.6}
.uuda-rich>div[data-k=ol]::before{content:counter(n) ".";position:absolute;left:calc(var(--i,0)*1.5em);width:1.5em;text-align:right;opacity:.6;font-variant-numeric:tabular-nums}
.uuda-rich [data-note]{display:inline-block;margin:0 .1em;padding:0 .4em;border:1px solid color-mix(in srgb,var(--c-accent,#22d3ee) 40%,transparent);border-radius:.3em;background:color-mix(in srgb,var(--c-accent,#22d3ee) 10%,transparent);color:var(--c-accent,#22d3ee);font-style:italic;font-weight:600;font-size:.85em}
.uuda-rich [data-note]::before{content:"["}.uuda-rich [data-note]::after{content:"]"}
.uuda-rich[data-empty]>div:first-child::after{content:attr(data-ph);position:absolute;left:0;opacity:.45;pointer-events:none}
`;

interface Snap { html: string; a: [number, number]; f: [number, number] }
const HISTORY = 100;

const blocksOf = (root: HTMLElement): HTMLElement[] => [...root.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.tagName === 'DIV');
const blockOf = (root: HTMLElement, node: Node | null): HTMLElement | null => {
  let n: Node | null = node;
  while (n && n.parentNode !== root) n = n.parentNode;
  return n instanceof HTMLElement ? n : null;
};
const offsetIn = (block: HTMLElement, node: Node, off: number): number => {
  const r = document.createRange();
  r.selectNodeContents(block);
  try { r.setEnd(node, off); } catch { return 0; }
  return r.toString().length;
};
const place = (block: HTMLElement | undefined, off: number): [Node, number] => {
  if (!block) return [document.body, 0];
  const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let left = off;
  let last: Text | null = null;
  for (let t = w.nextNode() as Text | null; t; t = w.nextNode() as Text | null) {
    last = t;
    if (left <= t.length) return [t, left];
    left -= t.length;
  }
  return last ? [last, last.length] : [block, 0];
};

/**
 * The script editor. What you see is what the talent gets: bold looks bold, a heading looks like a heading, lists number themselves,
 * and directions show as highlighted [chips]. Underneath it still produces the plain text the server keeps, so nothing else changes.
 */
export const ScriptEditor: React.FC<Props> = ({ id, value, onChange, rows = 9, maxLength, placeholder, readOnly }) => {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null); // the text this editor last produced
  const past = useRef<Snap[]>([]);
  const future = useRef<Snap[]>([]);
  const typing = useRef(0);
  const [, tick] = useState(0);
  const [chars, setChars] = useState(value.length);

  const snap = (): Snap | null => {
    const root = ref.current;
    if (!root) return null;
    const sel = window.getSelection();
    const bl = blocksOf(root);
    const at = (n: Node | null, o: number): [number, number] => {
      const b = blockOf(root, n);
      return b ? [bl.indexOf(b), offsetIn(b, n!, o)] : [0, 0];
    };
    const a = sel && sel.rangeCount && root.contains(sel.anchorNode) ? at(sel.anchorNode, sel.anchorOffset) : [0, 0] as [number, number];
    const f = sel && sel.rangeCount && root.contains(sel.focusNode) ? at(sel.focusNode, sel.focusOffset) : a;
    return { html: root.innerHTML, a, f };
  };
  const restore = (s: Snap) => {
    const root = ref.current;
    if (!root) return;
    root.innerHTML = s.html;
    const bl = blocksOf(root);
    const [an, ao] = place(bl[s.a[0]], s.a[1]);
    const [fn, fo] = place(bl[s.f[0]], s.f[1]);
    const sel = window.getSelection();
    try { sel?.setBaseAndExtent(an, ao, fn, fo); } catch { /* the editor is not focused */ }
  };
  const update = useCallback(() => {
    const root = ref.current;
    if (!root) return;
    const text = domToMarkup(root);
    last.current = text;
    setChars(text.length);
    const bl = blocksOf(root);
    const empty = bl.length <= 1 && !text.trim();
    if (empty) root.setAttribute('data-empty', ''); else root.removeAttribute('data-empty');
    onChange(text);
    tick((n) => n + 1);
  }, [onChange]);
  /** Remember the state before a change, so Undo can come back to it */
  const remember = () => {
    const s = snap();
    if (!s) return;
    const top = past.current[past.current.length - 1];
    if (top && top.html === s.html) return;
    past.current.push(s);
    if (past.current.length > HISTORY) past.current.shift();
    future.current = [];
  };
  /** Runs an edit as one Undo step */
  const edit = (fn: (root: HTMLElement) => void) => {
    const root = ref.current;
    if (!root) return;
    root.focus();
    window.clearTimeout(typing.current); typing.current = 0;
    remember();
    fn(root);
    update();
  };

  // Write the script into the editor when it changes from outside (a version restored, the job loaded), not when this editor made the change
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || value === last.current) return;
    root.innerHTML = markupToHtml(value);
    root.setAttribute('data-ph', placeholder ?? '');
    if (!value.trim()) root.setAttribute('data-empty', ''); else root.removeAttribute('data-empty');
    last.current = value; setChars(value.length);
    past.current = []; future.current = [];
  }, [value, placeholder]);
  useEffect(() => { ref.current?.setAttribute('data-ph', placeholder ?? ''); }, [placeholder]);

  const selected = (): HTMLElement[] => {
    const root = ref.current, sel = window.getSelection();
    if (!root || !sel || !sel.rangeCount) return [];
    const bl = blocksOf(root);
    const a = blockOf(root, sel.anchorNode), f = blockOf(root, sel.focusNode);
    if (!a || !f) return [];
    const i = bl.indexOf(a), j = bl.indexOf(f);
    return bl.slice(Math.min(i, j), Math.max(i, j) + 1);
  };
  const setKind = (k: LineKind, i: number, el: HTMLElement) => { el.dataset.k = k; el.dataset.i = String(i); el.style.setProperty('--i', String(i)); };
  const kindOfEl = (el: HTMLElement) => (el.dataset.k as LineKind) || 'p';
  const toggleKind = (k: 'h1' | 'ul' | 'ol') => edit(() => {
    const bl = selected().filter((b) => b.textContent?.trim() || selected().length === 1);
    const off = bl.length > 0 && bl.every((b) => kindOfEl(b) === k);
    bl.forEach((b) => setKind(off ? 'p' : k, k === 'h1' ? 0 : off ? 0 : Number(b.dataset.i) || 0, b));
  });
  const shift = (d: 1 | -1) => edit(() => {
    selected().forEach((b) => { const k = kindOfEl(b); if (k === 'h1' || k === 'h2') return; setKind(k, Math.max(0, Math.min(MAX_INDENT, (Number(b.dataset.i) || 0) + d)), b); });
  });
  const inline = (cmd: 'bold' | 'italic' | 'underline') => edit(() => { document.execCommand('styleWithCSS', false, 'false'); document.execCommand(cmd); });
  const insertNote = (text: string, selectIt: boolean) => edit(() => {
    const sel = window.getSelection();
    const picked = sel && !sel.isCollapsed ? sel.toString().replace(/[\[\]]/g, '').trim() : '';
    const label = picked || text;
    const html = `<span data-note="1">${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>&nbsp;`;
    document.execCommand('insertHTML', false, html);
    if (selectIt && !picked) {
      // Leave "direction" selected so typing replaces it
      const s2 = window.getSelection();
      const spans = ref.current?.querySelectorAll('[data-note]');
      const el = spans?.[spans.length - 1];
      if (s2 && el?.firstChild) { const r = document.createRange(); r.selectNodeContents(el); s2.removeAllRanges(); s2.addRange(r); }
    }
  });
  const doTidy = () => edit((root) => { root.innerHTML = markupToHtml(tidy(domToMarkup(root))); });
  const undo = () => {
    const root = ref.current, s = snap();
    if (!root || !s) return;
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(s);
    restore(prev); update();
  };
  const redo = () => {
    const s = snap();
    const next = future.current.pop();
    if (!s || !next) return;
    past.current.push(s);
    restore(next); update();
  };

  const onInput = (e: React.FormEvent<HTMLDivElement>) => {
    const root = ref.current;
    if (!root) return;
    const ie = e.nativeEvent as InputEvent;
    if (!root.children.length) root.innerHTML = lineHtml('p', 0, '');
    if (ie.inputType === 'insertParagraph') {
      // A new line after a heading is an ordinary line; Enter on an empty list line ends the list
      const sel = window.getSelection();
      const cur = blockOf(root, sel?.anchorNode ?? null);
      const prev = cur?.previousElementSibling as HTMLElement | null;
      if (cur && prev) {
        const pk = kindOfEl(prev);
        if ((pk === 'h1' || pk === 'h2') && kindOfEl(cur) === pk) setKind('p', 0, cur);
        else if ((pk === 'ul' || pk === 'ol') && !prev.textContent?.trim() && kindOfEl(cur) === pk) {
          setKind('p', Math.max(0, (Number(prev.dataset.i) || 0) - 1), cur);
          prev.remove();
        }
      }
    }
    // Typing is grouped into one Undo step per pause
    if (!typing.current) { const s = pendingBefore.current; if (s) { past.current.push(s); if (past.current.length > HISTORY) past.current.shift(); future.current = []; } }
    window.clearTimeout(typing.current);
    typing.current = window.setTimeout(() => { typing.current = 0; }, 700);
    update();
  };
  // The state just before the first keystroke of a burst
  const pendingBefore = useRef<Snap | null>(null);
  const onBeforeInput = (e: React.FormEvent<HTMLDivElement>) => {
    const t = (e.nativeEvent as InputEvent).inputType;
    if (t === 'historyUndo') { e.preventDefault(); undo(); return; }
    if (t === 'historyRedo') { e.preventDefault(); redo(); return; }
    if (!typing.current) pendingBefore.current = snap();
  };
  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
    if (!text) return;
    edit(() => {
      // Plain lines in, each as a line of its own; any markers in them are read as the script's own
      const sel = window.getSelection();
      const lines = text.split('\n');
      if (lines.length === 1) { document.execCommand('insertText', false, text); return; }
      document.execCommand('insertHTML', false, lines.map((l) => `<div data-k="p" data-i="0" style="--i:0">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;') || '<br>'}</div>`).join(''));
      void sel;
    });
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    else if (!e.shiftKey && (k === 'b' || k === 'i' || k === 'u')) { e.preventDefault(); inline(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline'); }
  };
  // Tidy the typed text into the form the talent will see (directions typed in [brackets] become chips) when the writer leaves
  const onBlur = () => {
    const root = ref.current;
    if (!root) return;
    const m = domToMarkup(root);
    if (markupToHtml(m) !== root.innerHTML) { root.innerHTML = markupToHtml(m); }
  };

  const height = `${Math.max(3, rows) * 1.6}em`;
  const over = maxLength ? chars > maxLength * 0.9 : false;

  return (
    <div className={`rounded-card border border-line-strong bg-surface-1 ${readOnly ? '' : 'focus-within:border-accent'}`}>
      <style>{CSS}</style>
      {!readOnly && (
        <div role="toolbar" aria-label="Script tools" className="flex flex-wrap items-center gap-0.5 border-b border-line px-1.5 py-1">
          <button type="button" className={TOOL} aria-label="Undo" disabled={!past.current.length} onMouseDown={keep} onClick={undo}><Undo2 className="h-3.5 w-3.5" />Undo</button>
          <button type="button" className={TOOL} aria-label="Redo" disabled={!future.current.length} onMouseDown={keep} onClick={redo}><Redo2 className="h-3.5 w-3.5" />Redo</button>
          <span className="mx-1 h-4 w-px bg-line" aria-hidden />
          <button type="button" className={ICON} aria-label="Bold" title="Bold (Ctrl+B)" onMouseDown={keep} onClick={() => inline('bold')}><Bold className="h-4 w-4" /></button>
          <button type="button" className={ICON} aria-label="Italic" title="Italic (Ctrl+I)" onMouseDown={keep} onClick={() => inline('italic')}><Italic className="h-4 w-4" /></button>
          <button type="button" className={ICON} aria-label="Underline" title="Underline (Ctrl+U)" onMouseDown={keep} onClick={() => inline('underline')}><Underline className="h-4 w-4" /></button>
          <span className="mx-1 h-4 w-px bg-line" aria-hidden />
          <button type="button" className={ICON} aria-label="Heading" title="Heading (shown bigger, not counted as words to read)" onMouseDown={keep} onClick={() => toggleKind('h1')}><Heading className="h-4 w-4" /></button>
          <button type="button" className={ICON} aria-label="Numbered list" title="Numbered list" onMouseDown={keep} onClick={() => toggleKind('ol')}><ListOrdered className="h-4 w-4" /></button>
          <button type="button" className={ICON} aria-label="Bullet list" title="Bullet list" onMouseDown={keep} onClick={() => toggleKind('ul')}><List className="h-4 w-4" /></button>
          <button type="button" className={ICON} aria-label="Indent" title="Indent" onMouseDown={keep} onClick={() => shift(1)}><IndentIncrease className="h-4 w-4" /></button>
          <button type="button" className={ICON} aria-label="Outdent" title="Outdent" onMouseDown={keep} onClick={() => shift(-1)}><IndentDecrease className="h-4 w-4" /></button>
          <span className="mx-1 h-4 w-px bg-line" aria-hidden />
          <button type="button" className={TOOL} title="Mark the selected words as a direction, shown highlighted and not read aloud" onMouseDown={keep} onClick={() => insertNote('direction', true)}><Brackets className="h-3.5 w-3.5" />Direction</button>
          <button type="button" className={TOOL} title="Insert a pause" onMouseDown={keep} onClick={() => insertNote('pause', false)}><PauseCircle className="h-3.5 w-3.5" />Pause</button>
          <span className="mx-1 h-4 w-px bg-line" aria-hidden />
          <button type="button" className={TOOL} title="Straighten quotes, remove extra spaces and blank lines" disabled={!chars} onMouseDown={keep} onClick={doTidy}><Sparkles className="h-3.5 w-3.5" />Tidy</button>
        </div>
      )}
      <div
        ref={ref}
        id={id}
        role="textbox"
        aria-multiline="true"
        aria-label="Script"
        contentEditable={!readOnly}
        suppressContentEditableWarning
        spellCheck
        className="uuda-rich overflow-y-auto p-3 text-sm text-ink"
        style={{ minHeight: height, maxHeight: '60dvh' }}
        onInput={onInput}
        onBeforeInput={onBeforeInput}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      {over && maxLength && <div className={`border-t border-line px-3 py-1 text-right font-num text-[11px] ${chars > maxLength ? 'text-danger' : 'text-ink-dim'}`}>{chars.toLocaleString()} / {maxLength.toLocaleString()}</div>}
    </div>
  );
};
