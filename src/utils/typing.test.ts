import { describe, expect, it } from 'vitest';
import { isTypingTarget } from './typing';

const fake = (o: { tag?: string; editable?: boolean; closest?: string | null }) =>
  ({ tagName: o.tag ?? 'DIV', isContentEditable: o.editable ?? false, closest: (_: string) => (o.closest ? {} : null) }) as unknown as EventTarget;

describe('isTypingTarget', () => {
  it('is true for fields and rich text', () => {
    expect(isTypingTarget(fake({ tag: 'INPUT' }))).toBe(true);
    expect(isTypingTarget(fake({ tag: 'TEXTAREA' }))).toBe(true);
    expect(isTypingTarget(fake({ tag: 'SELECT' }))).toBe(true);
    expect(isTypingTarget(fake({ editable: true }))).toBe(true);
  });
  it('is true inside a window that owns the keyboard', () => {
    expect(isTypingTarget(fake({ tag: 'BUTTON', closest: 'x' }))).toBe(true);
  });
  it('is false for the page and for nothing', () => {
    expect(isTypingTarget(fake({ tag: 'BODY' }))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({} as EventTarget)).toBe(false);
  });
});
