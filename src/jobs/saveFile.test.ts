import { describe, expect, it } from 'vitest';
import { expiryLine } from './saveFile';

const DAY = 86400000;
describe('expiryLine', () => {
  const now = new Date(2026, 10, 10, 12).getTime();
  it('says when the file goes and how long is left', () => {
    const e = expiryLine(now + 30 * DAY, now)!;
    expect(e.text).toContain('30 days left'); expect(e.text).toContain('10 Dec'); expect(e.soon).toBe(false); expect(e.gone).toBe(false);
  });
  it('flags the last week and says when it is gone', () => {
    expect(expiryLine(now + 6.2 * DAY, now)!.soon).toBe(true);
    expect(expiryLine(now + 0.5 * DAY, now)!.text).toContain('1 day left');
    const g = expiryLine(now - 1, now)!; expect(g.gone).toBe(true); expect(g.text).toContain('expired');
  });
  it('shows nothing when the server gave no date', () => expect(expiryLine(undefined, now)).toBeNull());
});
