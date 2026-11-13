import { describe, expect, it } from 'vitest';
import { DAILY_LIMIT_MESSAGE, STORAGE_FULL_FALLBACK, limitKind, limitMessage } from './limits';

describe('limits', () => {
  it('treats a 429 with no message of ours as the daily limit', () => {
    expect(limitKind(429)).toBe('daily');
    expect(limitMessage(429)).toBe(DAILY_LIMIT_MESSAGE);
    expect(limitKind(1027)).toBe('daily');
    expect(limitKind(503)).toBe('daily');
  });
  it('does not mistake our own "thread is full" 429 for the daily limit', () => {
    expect(limitKind(429, 'This thread is full.')).toBeNull();
    expect(limitMessage(429, 'This thread is full.')).toBeNull();
  });
  it('maps 507 to storage full, preferring the server text', () => {
    expect(limitKind(507, 'No room.')).toBe('storage');
    expect(limitMessage(507, 'No room.')).toBe('No room.');
    expect(limitMessage(507)).toBe(STORAGE_FULL_FALLBACK);
  });
  it('ignores other errors', () => {
    for (const s of [0, 400, 403, 404, 413, 422, 500]) expect(limitKind(s)).toBeNull();
    expect(limitMessage(404, 'x')).toBeNull();
  });
  it('always tells the person the recording is safe', () => {
    expect(DAILY_LIMIT_MESSAGE).toContain('safe on this device');
    expect(STORAGE_FULL_FALLBACK).toContain('safe on this device');
  });
});
