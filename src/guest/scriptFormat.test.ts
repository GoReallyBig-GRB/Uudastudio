import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline, setLineStyle, shiftIndent, spokenText, toggleMarker } from './scriptFormat';
import { countWords } from './job';

describe('inline styles', () => {
  it('reads bold, underline, italic and directions', () => {
    expect(parseInline('a **b** __c__ *d* [e]')).toEqual([
      { text: 'a ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', underline: true }, { text: ' ' }, { text: 'd', italic: true }, { text: ' ' }, { text: 'e', note: true },
    ]);
  });
  it('nests styles', () => {
    expect(parseInline('**bold __and under__**')).toEqual([{ text: 'bold ', bold: true }, { text: 'and under', bold: true, underline: true }]);
  });
  it('leaves a marker with no partner as text', () => {
    expect(parseInline('5 * 3 and **open')).toEqual([{ text: '5 * 3 and **open' }]);
  });
});

describe('blocks', () => {
  it('reads headings, lists, indents and blanks', () => {
    const b = parseBlocks('# Scene 1\n1. First\n2) Second\n- Dot\n>> deep\n\nplain');
    expect(b.map((x) => x.type)).toEqual(['heading', 'item', 'item', 'item', 'para', 'blank', 'para']);
    expect(b[1]).toMatchObject({ marker: '1.', indent: 0 });
    expect(b[2]).toMatchObject({ marker: '2.' });
    expect(b[3]).toMatchObject({ marker: '•' });
    expect(b[4]).toMatchObject({ indent: 2 });
  });
  it('does not take *italic* at the start of a line for a bullet', () => {
    expect(parseBlocks('*stress* this')[0].type).toBe('para');
  });
});

describe('words to read', () => {
  it('ignores markers, numbers, directions and headings', () => {
    expect(spokenText('# Title\n1. **Hello** there [smile]\n- friend')).toBe('\nHello there \nfriend');
    expect(countWords('# Title\n1. **Hello** there [smile]\n- friend')).toBe(3);
  });
});

describe('editor edits', () => {
  it('toggles a marker around the selection and back off', () => {
    const a = toggleMarker('say hello now', 4, 9, '**');
    expect(a).toEqual({ text: 'say **hello** now', start: 6, end: 11 });
    expect(toggleMarker(a.text, a.start, a.end, '**').text).toBe('say hello now');
  });
  it('numbers the selected lines, keeps blanks, and removes numbering when applied again', () => {
    const t = 'one\ntwo\n\nthree';
    const a = setLineStyle(t, 0, t.length, 'numbered');
    expect(a.text).toBe('1. one\n2. two\n\n3. three');
    expect(setLineStyle(a.text, a.start, a.end, 'numbered').text).toBe(t);
  });
  it('switches a numbered list to bullets without losing the text', () => {
    const t = '1. one\n2. two';
    expect(setLineStyle(t, 0, t.length, 'bullets').text).toBe('- one\n- two');
  });
  it('makes only the lines touched by the cursor a heading', () => {
    expect(setLineStyle('a\nb\nc', 2, 2, 'heading').text).toBe('a\n# b\nc');
  });
  it('indents and outdents within three levels', () => {
    const a = shiftIndent('x', 0, 1, 1);
    expect(a.text).toBe('> x');
    expect(shiftIndent(shiftIndent(shiftIndent(a.text, 0, 3, 1).text, 0, 9, 1).text, 0, 20, 1).text).toBe('> > > x');
    expect(shiftIndent('> x', 0, 3, -1).text).toBe('x');
  });
});
