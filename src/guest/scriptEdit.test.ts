import { describe, expect, it } from 'vitest';
import { insertAt, tidy, wrapSelection } from './scriptEdit';

describe('script editor helpers', () => {
  it('wraps a selection in a direction', () => {
    expect(wrapSelection('Hello there', 6, 11, '[', ']')).toEqual({ text: 'Hello [there]', start: 7, end: 12 });
  });
  it('with nothing selected puts the cursor between the brackets', () => {
    expect(wrapSelection('Hi', 2, 2, '[', ']')).toEqual({ text: 'Hi[]', start: 3, end: 3 });
  });
  it('pressing it again on a wrapped selection takes the brackets off', () => {
    expect(wrapSelection('Hello [there]', 6, 13, '[', ']')).toEqual({ text: 'Hello there', start: 6, end: 11 });
  });
  it('inserts a snippet in place of the selection', () => {
    expect(insertAt('One Two', 3, 4, ' [pause] ')).toEqual({ text: 'One [pause] Two', start: 12, end: 12 });
  });
  it('tidies pasted text', () => {
    expect(tidy('“Hello”  it’s  me   \n\n\n\nBye\t')).toBe('"Hello" it\'s me\n\nBye');
  });
});
