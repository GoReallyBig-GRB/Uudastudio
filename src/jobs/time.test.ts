import { describe, expect, it } from 'vitest';
import { ago } from './time';

describe('ago', () => {
  const now = Date.UTC(2026, 10, 12, 12, 0, 0);
  it('says it in the smallest sensible unit', () => {
    expect(ago(now - 10_000, now)).toBe('just now');
    expect(ago(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(ago(now - 3 * 3600_000, now)).toBe('3 h ago');
    expect(ago(now - 30 * 3600_000, now)).toBe('yesterday');
  });
});
