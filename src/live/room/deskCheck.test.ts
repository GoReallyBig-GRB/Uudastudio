import { describe, expect, it } from 'vitest';
import { DESK_MESSAGES, deskVerdict } from './deskCheck';

describe('desk check', () => {
  it('passes fast computers, warns near the limit, and fails slow ones', () => {
    expect(deskVerdict(0.05)).toBe('fine');
    expect(deskVerdict(0.25)).toBe('tight');
    expect(deskVerdict(0.6)).toBe('too-slow');
    expect(deskVerdict(Infinity)).toBe('too-slow');
    expect(deskVerdict(NaN)).toBe('too-slow');
  });
  it('has something to say for the two bad cases only', () => {
    expect(DESK_MESSAGES.fine).toBeNull();
    expect(DESK_MESSAGES['too-slow']).toContain('Conversation');
  });
});
