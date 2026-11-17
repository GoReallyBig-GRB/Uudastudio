import { describe, expect, it } from 'vitest';
import { formatBytes } from './storageInfo';

describe('storage sizes in words', () => {
  it('picks a sensible unit', () => {
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(500 * 1024)).toBe('500 KB');
    expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MB');
    expect(formatBytes(250 * 1024 ** 2)).toBe('250 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
    expect(formatBytes(-1)).toBe('0 MB');
  });
});
