/**
 * The bridge between the script editor on screen and the script text kept on the server.
 * The server keeps plain text with light markers (see scriptFormat.ts). The editor shows what those markers mean (bold looks bold,
 * a heading looks like a heading) and turns it back into the same text when something changes, so nothing else has to change.
 *
 * On screen every line is a <div data-k="p|h1|h2|ul|ol" data-i="indent 0..3"> holding inline <b> <i> <u> and <span data-note> for [directions].
 */
import { parseBlocks, type Block, type Run } from './scriptFormat';

export type LineKind = 'p' | 'h1' | 'h2' | 'ul' | 'ol';
export const MAX_INDENT = 3;

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const runHtml = (r: Run): string => {
  if (r.note) return `<span data-note="1">${esc(r.text)}</span>`;
  let h = esc(r.text);
  if (r.underline) h = `<u>${h}</u>`;
  if (r.italic) h = `<i>${h}</i>`;
  if (r.bold) h = `<b>${h}</b>`;
  return h;
};

export const lineHtml = (kind: LineKind, indent: number, inner: string): string =>
  `<div data-k="${kind}" data-i="${indent}" style="--i:${indent}">${inner || '<br>'}</div>`;

const blockHtml = (b: Block): string => {
  if (b.type === 'blank') return lineHtml('p', 0, '');
  const inner = b.runs.map(runHtml).join('');
  if (b.type === 'heading') return lineHtml(b.level === 1 ? 'h1' : 'h2', 0, inner);
  if (b.type === 'item') return lineHtml(b.marker === '•' ? 'ul' : 'ol', b.indent, inner);
  return lineHtml('p', b.indent, inner);
};

/** The script text as the lines the editor shows */
export const markupToHtml = (markup: string): string => {
  const blocks = parseBlocks(markup);
  return (blocks.length ? blocks : [{ type: 'blank' } as Block]).map(blockHtml).join('');
};

const isBold = (el: HTMLElement): boolean => el.tagName === 'B' || el.tagName === 'STRONG' || /^(bold|[6-9]00)$/.test(el.style.fontWeight);
const isItalic = (el: HTMLElement): boolean => el.tagName === 'I' || el.tagName === 'EM' || el.style.fontStyle === 'italic';
const isUnderline = (el: HTMLElement): boolean => el.tagName === 'U' || /underline/.test(el.style.textDecoration || el.style.textDecorationLine);

/** Inline content of one line as marked-up text */
const inlineText = (node: Node): string => {
  let out = '';
  node.childNodes.forEach((c) => {
    if (c.nodeType === Node.TEXT_NODE) { out += (c.textContent ?? '').replace(/[​\r\n]/g, '').replace(/ /g, ' '); return; }
    if (c.nodeType !== Node.ELEMENT_NODE) return;
    const el = c as HTMLElement;
    if (el.tagName === 'BR') return;
    const inner = inlineText(el);
    if (!inner) return;
    if (el.dataset.note) { out += `[${inner.trim()}]`; return; }
    let t = inner;
    if (isUnderline(el)) t = `__${t}__`;
    if (isItalic(el)) t = `*${t}*`;
    if (isBold(el)) t = `**${t}**`;
    out += t;
  });
  // A style that closes and reopens right away ("**a****b**") is one run
  return out.replace(/\*\*\*\*/g, '').replace(/____/g, '');
};

const kindOf = (el: HTMLElement): LineKind => {
  const k = el.dataset.k;
  return k === 'h1' || k === 'h2' || k === 'ul' || k === 'ol' ? k : 'p';
};

/** The lines of an editor, as the script text kept on the server */
export const domToMarkup = (root: HTMLElement): string => {
  const lines: string[] = [];
  let n = 0;
  const push = (kind: LineKind, indent: number, text: string) => {
    if (kind === 'ol') n += 1; else n = 0;
    const ind = '> '.repeat(Math.max(0, Math.min(MAX_INDENT, indent)));
    if (kind === 'h1') lines.push(`# ${text}`);
    else if (kind === 'h2') lines.push(`## ${text}`);
    else if (kind === 'ul') lines.push(`${ind}- ${text}`);
    else if (kind === 'ol') lines.push(`${ind}${n}. ${text}`);
    else lines.push(text ? `${ind}${text}` : '');
  };
  root.childNodes.forEach((c) => {
    if (c.nodeType === Node.TEXT_NODE) { const t = (c.textContent ?? '').replace(/[​\r\n]/g, ''); push('p', 0, t); return; }
    if (c.nodeType !== Node.ELEMENT_NODE) return;
    const el = c as HTMLElement;
    const kind = kindOf(el);
    const indent = Math.max(0, Math.min(MAX_INDENT, Number(el.dataset.i) || 0));
    // A browser may nest a line inside a line when pasting; each inner div is a line of its own
    const inner = [...el.children].filter((x) => x.tagName === 'DIV');
    if (inner.length) { inner.forEach((d) => push(kind, indent, inlineText(d).trimEnd())); return; }
    push(kind, indent, inlineText(el).trimEnd());
  });
  return lines.join('\n').replace(/\n+$/, '');
};

/** Lines (and headings, which are one line each) whose text an edit may change */
export const kindLabel = (k: LineKind): string => (k === 'h1' ? 'Heading' : k === 'h2' ? 'Subheading' : k === 'ul' ? 'Bullet' : k === 'ol' ? 'Numbered' : 'Line');
