import { describe, expect, it } from 'vitest';
import { clipboardHtmlToLines } from './richScript';

describe('pasting formatted text', () => {
  it('keeps bold, italic, underline, headings and lists, drops the rest', () => {
    const out = clipboardHtmlToLines('<h1 style="color:red">Agenda</h1><p>Read <b>this</b> and <em>that</em> <span style="text-decoration:underline">now</span></p><ul><li>One</li><li>Two<ul><li>Deep</li></ul></li></ul><ol><li>First</li></ol>');
    expect(out).toContain('data-k="h1"');
    expect(out).toContain('<b>this</b>');
    expect(out).toContain('<i>that</i>');
    expect(out).toContain('<u>now</u>');
    expect(out).toContain('data-k="ul" data-i="0"');
    expect(out).toContain('data-k="ul" data-i="1"');
    expect(out).toContain('data-k="ol"');
    expect(out).not.toContain('color');
  });
  it('treats Google Docs "bold but normal weight" wrappers as plain and reads font-weight styles', () => {
    const out = clipboardHtmlToLines('<b style="font-weight:normal" id="docs-internal-guid-1"><p>Plain <span style="font-weight:700">strong</span></p></b>');
    expect(out).toContain('Plain ');
    expect(out).not.toContain('<b>Plain');
    expect(out).toContain('<b>strong</b>');
  });
  it('keeps the lines of another Uuda notes box as they were', () => {
    const out = clipboardHtmlToLines('<div data-k="h2" data-i="0" style="--i:0">Topics</div><div data-k="ol" data-i="1" style="--i:1">Item</div>');
    expect(out).toContain('data-k="h2"');
    expect(out).toContain('data-k="ol" data-i="1"');
  });
  it('escapes text and returns nothing for empty content', () => {
    expect(clipboardHtmlToLines('<p>a &lt;b&gt; &amp; c</p>')).toContain('a &lt;b&gt; &amp; c');
    expect(clipboardHtmlToLines('<style>p{}</style><p> </p>')).toBe('');
  });
});
