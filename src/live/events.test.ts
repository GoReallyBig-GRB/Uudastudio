import { describe, expect, it } from 'vitest';
import { countdown, inviteMessage, joinLink, linksIn, orderEvents, parseLiveHash, stateNow, upcomingEvents, whatsappUrl, type LiveEvent } from './events';

const ev = (o: Partial<LiveEvent>): LiveEvent => ({ id: 'x', token: 't'.repeat(20), kind: 'scheduled', title: 'T', description: '', notes: '', startsAt: 1000, activatedAt: null, endedAt: null, participants: [], state: 'waiting', files: [], createdAt: 0, ...o });

describe('event order', () => {
  it('puts the live one first, then the next one, then past ones last', () => {
    const list = [ev({ id: 'late', startsAt: 9000 }), ev({ id: 'past', state: 'ended', startsAt: 100 }), ev({ id: 'now', state: 'open', startsAt: 500 }), ev({ id: 'soon', startsAt: 2000 })];
    expect(orderEvents(list).map((e) => e.id)).toEqual(['now', 'soon', 'late', 'past']);
    expect(upcomingEvents(list).map((e) => e.id)).toEqual(['now', 'soon', 'late']);
  });
  it('opens by the clock without asking the server', () => {
    expect(stateNow(ev({ startsAt: 5000 }), 4000)).toBe('waiting');
    expect(stateNow(ev({ startsAt: 5000 }), 5000)).toBe('open');
    expect(stateNow(ev({ startsAt: 5000, endedAt: 6000 }), 5500)).toBe('ended');
  });
});

describe('links and invites', () => {
  it('builds and reads the join link', () => {
    const l = joinLink('https://uudatest.goreallybig.com/', 'abcdefghijklmnopqrstu');
    expect(l).toBe('https://uudatest.goreallybig.com/#/live/abcdefghijklmnopqrstu');
    expect(parseLiveHash(new URL(l).hash)).toBe('abcdefghijklmnopqrstu');
    expect(parseLiveHash('#/live/short')).toBeNull();
  });
  it('finds clickable links in notes once each', () => {
    expect(linksIn('Read https://a.com/x, then https://a.com/x and http://b.org.')).toEqual(['https://a.com/x', 'http://b.org']);
  });
  it('sends title, description and notes along with the invite', () => {
    const m = inviteMessage(ev({ title: 'Panel', description: 'About radio', notes: 'Read https://a.com', startsAt: null }), 'https://x/#/live/t', 'Ada');
    expect(m).toContain('Panel');
    expect(m).toContain('About radio');
    expect(m).toContain('https://a.com');
    expect(m).toContain('Starting now');
    expect(m.endsWith('https://x/#/live/t')).toBe(true);
  });
  it('opens WhatsApp to a number when the contact is one, otherwise to the chooser', () => {
    expect(whatsappUrl('hi', '+234 803 123 4567').startsWith('https://wa.me/2348031234567?text=')).toBe(true);
    expect(whatsappUrl('hi', 'ada@x.com').startsWith('https://wa.me/?text=')).toBe(true);
  });
  it('says how long to wait', () => {
    expect(countdown(30_000)).toBe('in under a minute');
    expect(countdown(5 * 60_000)).toBe('in 5 min');
    expect(countdown(3 * 3600_000)).toBe('in 3 h');
  });
});
