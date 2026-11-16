import { describe, expect, it } from 'vitest';
import { countdown, durationLabel, inviteMessage, markupToPlain, joinLink, linksIn, orderEvents, parseLiveHash, stateNow, upcomingEvents, whatsappUrl, type LiveEvent } from './events';

const ev = (o: Partial<LiveEvent>): LiveEvent => ({ id: 'x', token: 't'.repeat(20), kind: 'scheduled', title: 'T', description: '', notes: '', startsAt: 1000, durationMin: null, activatedAt: null, endedAt: null, participants: [], state: 'waiting', files: [], createdAt: 0, ...o });

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
  it('structures the invite: labelled, icon-led blocks with the join link straight after the duration', () => {
    const m = inviteMessage(ev({ title: 'Panel', description: 'About radio', notes: '# Agenda\n- **Intro**\n- Q and A', startsAt: Date.UTC(2026, 10, 20, 14, 0), durationMin: 90 }), 'https://x/#/live/t', 'Ada');
    expect(m.startsWith('🎙️ Ada invites you to a live session on Uuda Studio.')).toBe(true);
    expect(m).toContain('📌 Title\n   Panel');
    expect(m).toContain('💬 Description\n   About radio');
    expect(m).toMatch(/📅 When\n {3}Date: .*2026/);
    expect(m).toMatch(/ {3}Time: .*\(/);
    expect(m).toContain('Duration: 1 h 30 min');
    expect(m).toContain('📝 Notes (to help you prepare)');
    expect(m).toContain('   • Intro');
    expect(m).not.toContain('**');
    expect(m.indexOf('🔗 Join the session')).toBeGreaterThan(m.indexOf('Duration:'));
    expect(m.indexOf('🔗 Join the session')).toBeLessThan(m.indexOf('📝 Notes'));
    expect(m).toContain('🔗 Join the session\n   https://x/#/live/t');
  });
  it('leaves out the duration when none is set, and says starting now for a quick event', () => {
    const m = inviteMessage(ev({ title: 'Quick', startsAt: null }), 'https://x/#/live/t', '');
    expect(m).not.toContain('Duration');
    expect(m).toContain('Starting now');
    expect(m.startsWith('🎙️ Your host invites you')).toBe(true);
  });
  it('turns notes into plain text', () => {
    expect(markupToPlain('Read **this** first\n\n\n\n1. One\n2. Two')).toBe('Read this first\n\n1. One\n2. Two');
    expect(durationLabel(45)).toBe('45 min');
    expect(durationLabel(120)).toBe('2 h');
  });
  it('opens WhatsApp to a number when the contact is one, otherwise to the chooser', () => {
    expect(whatsappUrl('hi', '2348031234567').startsWith('https://wa.me/2348031234567?text=')).toBe(true);
    expect(whatsappUrl('hi', '').startsWith('https://wa.me/?text=')).toBe(true);
  });
  it('says how long to wait', () => {
    expect(countdown(30_000)).toBe('in under a minute');
    expect(countdown(5 * 60_000)).toBe('in 5 min');
    expect(countdown(3 * 3600_000)).toBe('in 3 h');
  });
});
