import { describe, expect, it } from 'vitest';
import { GUEST_TIPS, PROBLEMS, SECTIONS, searchGuide } from './guideContent';
import { buildReport, scrub } from './problemReport';

describe('live guide', () => {
  it('has the twelve starting problems covered, each with steps', () => {
    expect(PROBLEMS.length).toBeGreaterThanOrEqual(11);
    for (const p of PROBLEMS) { expect(p.steps.length).toBeGreaterThanOrEqual(2); expect(p.symptom.length).toBeGreaterThan(10); }
    expect(new Set(PROBLEMS.map((p) => p.id)).size).toBe(PROBLEMS.length);
    expect(new Set(SECTIONS.map((s) => s.id)).size).toBe(SECTIONS.length);
    expect(GUEST_TIPS.length).toBeGreaterThan(3);
  });
  it('returns everything for an empty search', () => {
    expect(searchGuide('  ')).toHaveLength(SECTIONS.length + PROBLEMS.length);
  });
  it('finds problems by the words a person would use', () => {
    const ids = (q: string) => searchGuide(q).filter((h) => h.kind === 'problem').map((h) => (h.item as { id: string }).id);
    expect(ids('I can hear myself')).toContain('echo');
    expect(ids('obs')).toContain('program-out');
    expect(ids('bluetooth')).toContain('mic-blocked');
    expect(ids('iphone')).toContain('browser');
    expect(ids('doubled')).toContain('doubled');
  });
  it('needs every word to match, and finds sections too', () => {
    expect(searchGuide('zzzz nothing')).toHaveLength(0);
    expect(searchGuide('waiting list').some((h) => h.kind === 'section')).toBe(true);
    expect(searchGuide('4 people')).not.toHaveLength(0);
  });
});

describe('problem report', () => {
  const base = { when: new Date('2026-11-19T10:00:00Z'), browser: 'Chrome 130', platform: 'Windows', inputs: ['USB Audio Interface'], outputs: ['Speakers'], studio: { gear: 'USB mixer', mode: 'broadcast', programContains: 'guests', headphones: true, quality: 'standard' }, checks: { computer: 'fine' }, errors: [] as string[] };
  it('lists what was and was not run', () => {
    const t = buildReport(base);
    expect(t).toMatch(/Computer check: fine/);
    expect(t).toMatch(/Connection check: not run/);
    expect(t).toMatch(/USB Audio Interface/);
    expect(t).toMatch(/Recent errors: none/);
  });
  it('removes links, emails and long tokens, and keeps only the last five errors', () => {
    expect(scrub('see https://x.test/#/live/abcdefghijklmnopqrstuvwxyz0123 mail a.b@c.com')).toBe('see [link] mail [email]');
    expect(scrub('tok abcdefghijklmnopqrstuvwxyz0123')).toBe('tok [token]');
    const t = buildReport({ ...base, errors: Array.from({ length: 8 }, (_, i) => `e${i} https://secret.test/x`) });
    expect(t).not.toMatch(/secret\.test/);
    expect(t).not.toMatch(/e2\b/);
    expect(t).toMatch(/e7/);
  });
  it('handles no studio and no devices', () => {
    const t = buildReport({ ...base, studio: null, inputs: [], outputs: [] });
    expect(t).toMatch(/Studio: none saved/);
    expect(t).toMatch(/Sound inputs: none found/);
  });
});
