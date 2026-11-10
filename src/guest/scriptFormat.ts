/**
 * Script structure kept as plain text with a few light markers, so it travels in the link and on the server like any text:
 *   **bold**   __underline__   *italic*   [direction]
 *   # Heading   ## Subheading   1. numbered   - bullet   > indented (>> twice)
 * Everything here is pure: parsing for display, counting the words to be read, and the line edits behind the editor's buttons.
 */
import type { Edit } from './scriptEdit';

export interface Run { text: string; bold?: boolean; underline?: boolean; italic?: boolean; note?: boolean }
export type Block =
  | { type: 'blank' }
  | { type: 'heading'; level: 1 | 2; runs: Run[] }
  | { type: 'item'; marker: string; indent: number; runs: Run[] }
  | { type: 'para'; indent: number; runs: Run[] };

type Token = { t: 'text' | 'note' | '**' | '__' | '*'; v: string };

const tokenize = (line: string): Token[] => {
  const out: Token[] = [];
  const re = /\[[^\]]*\]|\*\*|__|\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push({ t: 'text', v: line.slice(last, m.index) });
    const v = m[0];
    out.push(v.startsWith('[') ? { t: 'note', v: v.slice(1, -1).trim() } : { t: v as Token['t'], v });
    last = m.index + v.length;
  }
  if (last < line.length) out.push({ t: 'text', v: line.slice(last) });
  return out;
};

/** One line's text as styled runs. A marker with no partner on the same line is left as ordinary text. */
export const parseInline = (line: string): Run[] => {
  const toks = tokenize(line);
  // Pair each marker with the next one of its kind; the odd one out stays literal
  const role = new Map<number, 'open' | 'close'>();
  for (const k of ['**', '__', '*'] as const) {
    let open = -1;
    toks.forEach((tok, i) => {
      if (tok.t !== k) return;
      if (open < 0) open = i; else { role.set(open, 'open'); role.set(i, 'close'); open = -1; }
    });
  }
  const runs: Run[] = [];
  let bold = false, underline = false, italic = false;
  const push = (r: Run) => { if (r.text) runs.push(r); };
  toks.forEach((tok, i) => {
    if (tok.t === 'note') { if (tok.v) push({ text: tok.v, note: true }); return; }
    if (tok.t === 'text') { push({ text: tok.v, ...(bold ? { bold } : {}), ...(underline ? { underline } : {}), ...(italic ? { italic } : {}) }); return; }
    const r = role.get(i);
    if (!r) { push({ text: tok.v, ...(bold ? { bold } : {}), ...(underline ? { underline } : {}), ...(italic ? { italic } : {}) }); return; }
    const on = r === 'open';
    if (tok.t === '**') bold = on; else if (tok.t === '__') underline = on; else italic = on;
  });
  // merge neighbours with the same styling
  return runs.reduce<Run[]>((acc, r) => {
    const p = acc[acc.length - 1];
    if (p && !p.note && !r.note && !!p.bold === !!r.bold && !!p.underline === !!r.underline && !!p.italic === !!r.italic) p.text += r.text; else acc.push({ ...r });
    return acc;
  }, []);
};

const INDENT_RE = /^((?:>\s?)*)/;
const NUM_RE = /^(\d{1,3})[.)]\s+(.*)$/;
const BUL_RE = /^[-•*]\s+(.*)$/;

export const parseBlocks = (script: string): Block[] =>
  script.replace(/\r\n?/g, '\n').split('\n').map((raw): Block => {
    if (!raw.trim()) return { type: 'blank' };
    const h = /^(#{1,2})\s+(.*)$/.exec(raw);
    if (h) return { type: 'heading', level: h[1].length as 1 | 2, runs: parseInline(h[2]) };
    const indentMatch = INDENT_RE.exec(raw)![1];
    const indent = Math.min(3, (indentMatch.match(/>/g) ?? []).length);
    const rest = raw.slice(indentMatch.length);
    const n = NUM_RE.exec(rest);
    if (n) return { type: 'item', marker: `${n[1]}.`, indent, runs: parseInline(n[2]) };
    const b = BUL_RE.exec(rest);
    // "* text" is a bullet, but "*italic* text" is not: a bullet marker needs its space
    if (b) return { type: 'item', marker: '•', indent, runs: parseInline(b[1]) };
    return { type: 'para', indent, runs: parseInline(rest) };
  });

/** What the talent reads aloud: no markers, no directions. Headings are labels, not spoken. */
export const spokenText = (script: string): string =>
  parseBlocks(script)
    .map((b) => (b.type === 'heading' || b.type === 'blank' ? '' : b.runs.filter((r) => !r.note).map((r) => r.text).join('')))
    .join('\n');

/* ---------- editor edits ---------- */

/** Wrap or unwrap the selection in a style marker. With nothing selected the pair is inserted with the cursor between. */
export const toggleMarker = (text: string, start: number, end: number, marker: '**' | '__' | '*'): Edit => {
  const before = text.slice(0, start), mid = text.slice(start, end), after = text.slice(end);
  const m = marker.length;
  if (mid.length >= 2 * m && mid.startsWith(marker) && mid.endsWith(marker)) {
    const inner = mid.slice(m, mid.length - m);
    return { text: before + inner + after, start, end: start + inner.length };
  }
  if (before.endsWith(marker) && after.startsWith(marker) && (marker !== '*' || (!before.endsWith('**') && !after.startsWith('**')))) {
    return { text: before.slice(0, before.length - m) + mid + after.slice(m), start: start - m, end: end - m };
  }
  return { text: before + marker + mid + marker + after, start: start + m, end: start + m + mid.length };
};

/** The lines touched by a selection: from the start of the first to the end of the last */
const lineSpan = (text: string, start: number, end: number): { from: number; to: number } => {
  const from = text.lastIndexOf('\n', Math.max(0, start) - 1) + 1;
  const stop = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const nl = text.indexOf('\n', stop);
  return { from, to: nl < 0 ? text.length : nl };
};

const splitLine = (line: string): { indent: string; marker: string; body: string } => {
  const ind = INDENT_RE.exec(line)![1];
  const rest = line.slice(ind.length);
  const h = /^#{1,2}\s+/.exec(rest);
  if (h) return { indent: ind, marker: h[0], body: rest.slice(h[0].length) };
  const n = /^\d{1,3}[.)]\s+/.exec(rest);
  if (n) return { indent: ind, marker: n[0], body: rest.slice(n[0].length) };
  const b = /^[-•]\s+/.exec(rest);
  if (b) return { indent: ind, marker: b[0], body: rest.slice(b[0].length) };
  return { indent: ind, marker: '', body: rest };
};

const mapLines = (text: string, start: number, end: number, fn: (lines: string[]) => string[]): Edit => {
  const { from, to } = lineSpan(text, start, end);
  const out = fn(text.slice(from, to).split('\n')).join('\n');
  return { text: text.slice(0, from) + out + text.slice(to), start: from, end: from + out.length };
};

export type LineStyle = 'heading' | 'numbered' | 'bullets';

/** Turn the selected lines into a heading, a numbered list (1. 2. 3.) or bullets; applying the same style again takes it off. Blank lines stay blank. */
export const setLineStyle = (text: string, start: number, end: number, style: LineStyle): Edit =>
  mapLines(text, start, end, (lines) => {
    const real = lines.filter((l) => l.trim());
    const parts = real.map(splitLine);
    const has = (p: { marker: string }) => (style === 'heading' ? /^#/.test(p.marker) : style === 'numbered' ? /^\d/.test(p.marker) : /^[-•]/.test(p.marker));
    const off = parts.length > 0 && parts.every(has);
    let n = 0;
    return lines.map((l) => {
      if (!l.trim()) return l;
      const p = splitLine(l);
      if (off) return p.indent + p.body;
      n += 1;
      const marker = style === 'heading' ? '# ' : style === 'numbered' ? `${n}. ` : '- ';
      return (style === 'heading' ? '' : p.indent) + marker + p.body;
    });
  });

/** Move the selected lines one level in (up to three) or out */
export const shiftIndent = (text: string, start: number, end: number, dir: 1 | -1): Edit =>
  mapLines(text, start, end, (lines) =>
    lines.map((l) => {
      if (!l.trim() || /^#/.test(l)) return l;
      const ind = INDENT_RE.exec(l)![1];
      const level = (ind.match(/>/g) ?? []).length;
      const next = Math.max(0, Math.min(3, level + dir));
      return '> '.repeat(next) + l.slice(ind.length);
    }),
  );
