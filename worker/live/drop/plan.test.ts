import { describe, expect, it } from 'vitest';
import { B2_CAP_BYTES, DO_CAP_BYTES, FULL_MESSAGE, KEEP_AFTER_COLLECTED_MS, KEEP_IF_NOT_COLLECTED_MS, MAX_FILE_BYTES, chooseBacking, expiresAt, nextBacking, partsFor } from './plan';

const GB = 1024 ** 3, MB = 1024 ** 2;

describe('storage routing marks', () => {
  it('switches to B2 at 80% and back only below 65%', () => {
    expect(nextBacking('do', 3.9 * GB)).toBe('do');
    expect(nextBacking('do', 4 * GB)).toBe('b2');
    expect(nextBacking('b2', 3.9 * GB)).toBe('b2');
    expect(nextBacking('b2', 3.3 * GB)).toBe('b2');
    expect(nextBacking('b2', 3.2 * GB)).toBe('do');
  });
  it('does not flip back and forth around one number', () => {
    let mode = nextBacking('do', 4.01 * GB);
    for (const t of [3.95, 4.02, 3.9, 3.5]) mode = nextBacking(mode, t * GB);
    expect(mode).toBe('b2');
  });
});

describe('choosing where a file goes', () => {
  const base = { prev: 'do' as const, size: 500 * MB, doTotal: 1 * GB, b2Configured: true, b2Total: 0 };
  it('uses the Durable Object while there is room under the mark', () => {
    expect(chooseBacking(base)).toMatchObject({ backing: 'do', mode: 'do', refusal: null });
  });
  it('moves new files to B2 once the Durable Object passes 80%', () => {
    expect(chooseBacking({ ...base, doTotal: 4.1 * GB })).toMatchObject({ backing: 'b2', mode: 'b2' });
  });
  it('sends a file to B2 when it would carry the Durable Object past the mark', () => {
    expect(chooseBacking({ ...base, doTotal: 3.8 * GB, size: 600 * MB })).toMatchObject({ backing: 'b2' });
  });
  it('stays on B2 between the marks, and returns below 65%', () => {
    expect(chooseBacking({ ...base, prev: 'b2', doTotal: 3.6 * GB })).toMatchObject({ backing: 'b2' });
    expect(chooseBacking({ ...base, prev: 'b2', doTotal: 3 * GB })).toMatchObject({ backing: 'do', mode: 'do' });
  });
  it('without B2 it uses the Durable Object up to 95% and then refuses clearly', () => {
    expect(chooseBacking({ ...base, b2Configured: false, doTotal: 4.2 * GB })).toMatchObject({ backing: 'do' });
    expect(chooseBacking({ ...base, b2Configured: false, doTotal: 4.5 * GB })).toMatchObject({ backing: null, refusal: FULL_MESSAGE });
  });
  it('uses what is left in the Durable Object when B2 is full, and refuses when both are full', () => {
    expect(chooseBacking({ ...base, prev: 'b2', doTotal: 4 * GB, b2Total: B2_CAP_BYTES - 100 * MB })).toMatchObject({ backing: 'do' });
    expect(chooseBacking({ ...base, prev: 'b2', doTotal: 4.6 * GB, b2Total: B2_CAP_BYTES })).toMatchObject({ backing: null, refusal: FULL_MESSAGE });
  });
  it('refuses empty, invalid or oversized files', () => {
    expect(chooseBacking({ ...base, size: 0 }).backing).toBeNull();
    expect(chooseBacking({ ...base, size: NaN }).backing).toBeNull();
    expect(chooseBacking({ ...base, size: MAX_FILE_BYTES + 1 }).backing).toBeNull();
    expect(DO_CAP_BYTES).toBe(5 * GB);
  });
});

describe('keeping and deleting', () => {
  it('keeps a collected take for 24 hours and an uncollected one for 7 days', () => {
    expect(expiresAt(1000, 5000)).toBe(5000 + KEEP_AFTER_COLLECTED_MS);
    expect(expiresAt(1000, null)).toBe(1000 + KEEP_IF_NOT_COLLECTED_MS);
  });
  it('counts parts', () => {
    expect(partsFor(1)).toBe(1);
    expect(partsFor(5 * MB)).toBe(1);
    expect(partsFor(5 * MB + 1)).toBe(2);
    expect(partsFor(520 * MB)).toBe(104);
  });
});
