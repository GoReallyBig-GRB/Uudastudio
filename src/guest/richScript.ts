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

// ---- Pasting from other programs ---------------------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (t: string): string => t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(c) && c > 0 ? String.fromCodePoint(c) : ''; }
  return ENTITIES[e.toLowerCase()] ?? m;
});

interface Fmt { tag: string; b: boolean; i: boolean; u: boolean }
const BLOCK = new Set(['p', 'div', 'li', 'tr', 'blockquote', 'pre', 'section', 'article', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const SKIP = new Set(['script', 'style', 'head', 'title', 'template']);

/**
 * Turns text copied from Word, Google Docs, a web page or another Uuda notes box into the editor's lines, keeping bold, italic,
 * underline, headings, bullets and numbered lists, and dropping everything else (fonts, colours, sizes). Returns '' when there is no text.
 * Written without the browser's HTML parser so it can be tested anywhere.
 */
export const clipboardHtmlToLines = (html: string): string => {
  const body = html.replace(/<!--StartFragment-->|<!--EndFragment-->/g, '');
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  const lines: string[] = [];
  const fmt: Fmt[] = [];
  const lists: Array<'ul' | 'ol'> = [];
  let cur = '', kind: LineKind = 'p', own: number | null = null, skipDepth = 0, m: RegExpExecArray | null;
  const flush = () => {
    if (cur.replace(/<[^>]+>/g, '').trim()) lines.push(lineHtml(kind, own ?? (kind === 'ul' || kind === 'ol' ? Math.min(MAX_INDENT, Math.max(0, lists.length - 1)) : 0), cur.trim()));
    cur = ''; kind = 'p'; own = null;
  };
  const style = (attrs: string) => {
    const st = /style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/i.exec(attrs); const css = (st?.[1] ?? st?.[2] ?? '').toLowerCase();
    const w = /font-weight\s*:\s*([a-z0-9]+)/.exec(css)?.[1];
    return {
      b: w ? w === 'bold' || w === 'bolder' || Number(w) >= 600 : null,
      i: /font-style\s*:\s*italic/.test(css) ? true : /font-style\s*:\s*normal/.test(css) ? false : null,
      u: /text-decoration[^;]*underline/.test(css) ? true : /text-decoration[^;]*none/.test(css) ? false : null,
    };
  };
  while ((m = re.exec(body))) {
    if (m[4] !== undefined) {
      if (skipDepth) continue;
      const text = decode(m[4]).replace(/\s+/g, ' ');
      if (!text.trim() && !cur) continue;
      let h = esc(text);
      const f = fmt[fmt.length - 1];
      if (f?.u) h = `<u>${h}</u>`; if (f?.i) h = `<i>${h}</i>`; if (f?.b) h = `<b>${h}</b>`;
      cur += h; continue;
    }
    if (!m[2]) continue;
    const closing = m[1] === '/', tag = m[2].toLowerCase(), attrs = m[3] ?? '';
    if (SKIP.has(tag)) { skipDepth = Math.max(0, skipDepth + (closing ? -1 : 1)); continue; }
    if (skipDepth) continue;
    if (tag === 'br') { flush(); continue; }
    if (tag === 'ul' || tag === 'ol') { flush(); if (closing) lists.pop(); else lists.push(tag); continue; }
    if (BLOCK.has(tag)) {
      flush();
      const mine = /data-k="(p|h1|h2|ul|ol)"/.exec(attrs);
      if (!closing && mine) { kind = mine[1] as LineKind; const ind = /data-i="(\d)"/.exec(attrs); own = ind ? Math.min(MAX_INDENT, Number(ind[1])) : 0; continue; }
      if (!closing) kind = tag === 'h1' ? 'h1' : /^h[2-6]$/.test(tag) ? 'h2' : tag === 'li' ? (lists[lists.length - 1] ?? 'ul') : 'p';
      continue;
    }
    // Inline tags carry their formatting down to the text inside
    const parent = fmt[fmt.length - 1] ?? { tag: '', b: false, i: false, u: false };
    if (closing) { for (let k = fmt.length - 1; k >= 0; k--) if (fmt[k].tag === tag) { fmt.splice(k, 1); break; } continue; }
    if (/\/\s*$/.test(attrs)) continue;
    const s = style(attrs);
    fmt.push({
      tag,
      b: s.b ?? (tag === 'b' || tag === 'strong' ? true : parent.b),
      i: s.i ?? (tag === 'i' || tag === 'em' ? true : parent.i),
      u: s.u ?? (tag === 'u' || tag === 'ins' ? true : parent.u),
    });
  }
  flush();
  return lines.join('');
};
