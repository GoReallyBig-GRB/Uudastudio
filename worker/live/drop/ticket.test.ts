import { describe, expect, it } from 'vitest';
import { checkTicket, makeTicket, TICKET_LIFETIME_MS } from './ticket';

describe('upload tickets', () => {
  it('accepts its own ticket for the same event and take', async () => {
    const t = await makeTicket('s3cret', 'ev1', 'take-1-abc', 1000);
    expect(await checkTicket('s3cret', 'ev1', 'take-1-abc', t, 2000)).toBe(true);
  });
  it('rejects another event, another take, another secret, or a changed ticket', async () => {
    const t = await makeTicket('s3cret', 'ev1', 'take-1-abc', 1000);
    expect(await checkTicket('s3cret', 'ev2', 'take-1-abc', t, 2000)).toBe(false);
    expect(await checkTicket('s3cret', 'ev1', 'take-2-abc', t, 2000)).toBe(false);
    expect(await checkTicket('other', 'ev1', 'take-1-abc', t, 2000)).toBe(false);
    expect(await checkTicket('s3cret', 'ev1', 'take-1-abc', t.slice(0, -1) + '0', 2000)).toBe(false);
    expect(await checkTicket('s3cret', 'ev1', 'take-1-abc', 'nonsense', 2000)).toBe(false);
  });
  it('expires and refuses odd take names', async () => {
    const t = await makeTicket('s3cret', 'ev1', 'take-1-abc', 1000);
    expect(await checkTicket('s3cret', 'ev1', 'take-1-abc', t, 1000 + TICKET_LIFETIME_MS + 1)).toBe(false);
    expect(await checkTicket('s3cret', 'ev1', '../x', t, 2000)).toBe(false);
  });
});
