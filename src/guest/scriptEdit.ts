/** Small pure helpers behind the script editor's buttons. Each returns the new text and where the selection should be. */

export interface Edit { text: string; start: number; end: number }

/** Put `open`/`close` around the selection. With nothing selected the pair is inserted with the cursor between. Pressing it again on a wrapped selection removes it. */
export const wrapSelection = (text: string, start: number, end: number, open: string, close: string): Edit => {
  const before = text.slice(0, start), mid = text.slice(start, end), after = text.slice(end);
  if (mid.startsWith(open) && mid.endsWith(close) && mid.length >= open.length + close.length) {
    const inner = mid.slice(open.length, mid.length - close.length);
    return { text: before + inner + after, start, end: start + inner.length };
  }
  return { text: before + open + mid + close + after, start: start + open.length, end: start + open.length + mid.length };
};

/** Insert a snippet at the selection (replacing it), with the cursor after it */
export const insertAt = (text: string, start: number, end: number, snippet: string): Edit => {
  const pos = start + snippet.length;
  return { text: text.slice(0, start) + snippet + text.slice(end), start: pos, end: pos };
};

/** Clean up pasted text: curly quotes to straight ones, no-break spaces and tabs to spaces, no trailing spaces, no runs of spaces, at most one blank line in a row */
export const tidy = (text: string): string =>
  text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[ \t]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
