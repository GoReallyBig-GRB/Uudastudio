import { describe, expect, it } from 'vitest';
import { inviteText, isTalentHash, parseTalentHash, talentLink } from './links';
import { addJob, loadJobs, markRead, removeJob, saveJobs, statusOf, unreadCount } from './jobsStore';

const ID = 'a'.repeat(32), KEY = 'b'.repeat(48);
describe('talent link', () => {
  it('round-trips and replaces an old # part', () => {
    const l = talentLink('https://app.test/x?y=1#old', ID, KEY);
    expect(l).toBe(`https://app.test/x?y=1#/t/${ID}.${KEY}`);
    expect(parseTalentHash('#' + l.split('#')[1])).toEqual({ jobId: ID, key: KEY });
  });
  it('rejects anything malformed', () => {
    expect(parseTalentHash('#/t/short.key')).toBeNull();
    expect(parseTalentHash(`#/t/${ID}`)).toBeNull();
    expect(parseTalentHash(`#/join/${ID}.${KEY}`)).toBeNull();
    expect(isTalentHash(`#/t/x`)).toBe(true);
  });
  it('the invite text carries the link and the job name', () => {
    expect(inviteText('Intro', 'Ada', 'https://l')).toContain('"Intro" from Ada');
    expect(inviteText('Intro', '', 'https://l')).toContain('https://l');
  });
});

describe('producer job list', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
  it('saves, loads, adds, removes and tolerates junk', () => {
    const s = mem();
    let jobs = addJob([], { id: 'j1', producerKey: 'k1', title: 'One', createdAt: 1 });
    jobs = addJob(jobs, { id: 'j2', producerKey: 'k2', title: 'Two', createdAt: 2 });
    saveJobs(s, jobs);
    expect(loadJobs(s).map((j) => j.id)).toEqual(['j2', 'j1']);
    expect(removeJob(jobs, 'j1').map((j) => j.id)).toEqual(['j2']);
    s.setItem('uuda-jobs-v1', 'not json');
    expect(loadJobs(s)).toEqual([]);
  });
  it('read marker only moves forward, unread counts only talent messages', () => {
    const jobs = addJob([], { id: 'j', producerKey: 'k', title: 't', createdAt: 0 });
    expect(markRead(markRead(jobs, 'j', 5), 'j', 3)[0].lastRead).toBe(5);
    const msgs = [{ id: 1, role: 'talent' }, { id: 2, role: 'producer' }, { id: 3, role: 'talent' }];
    expect(unreadCount(msgs, 0)).toBe(2);
    expect(unreadCount(msgs, 1)).toBe(1);
    expect(unreadCount(msgs, 3)).toBe(0);
  });
  it('status follows the talent messages', () => {
    expect(statusOf([])).toBe('waiting');
    expect(statusOf([{ role: 'talent', attachment: null }])).toBe('talking');
    expect(statusOf([{ role: 'talent', attachment: null }, { role: 'talent', attachment: {} }])).toBe('take');
    expect(statusOf([{ role: 'producer', attachment: { id: 'r' } }])).toBe('waiting');
  });
});

import { markReadClient } from './jobsStore';
describe('client thread read marks', () => {
  it('keeps its own read mark, only moving forward, and old saved jobs load with zero', () => {
    const jobs = addJob([], { id: 'j', producerKey: 'k', title: 'T', createdAt: 1 });
    expect(jobs[0].lastReadClient).toBe(0);
    expect(markReadClient(markReadClient(jobs, 'j', 5), 'j', 3)[0].lastReadClient).toBe(5);
    expect(markReadClient(jobs, 'j', 5)[0].lastRead).toBe(0);
    const old = loadJobs({ getItem: () => JSON.stringify([{ id: 'a', producerKey: 'b', title: 'x', createdAt: 1, lastRead: 2 }]) });
    expect(old[0].lastReadClient).toBe(0);
  });
});
