import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { assetIdsOf, pastStatesToDrop } from './historyLimits';

const proj = (...assets: string[]): Project =>
  ({ tracks: assets.map((a, i) => ({ id: `t${i}`, clips: [{ id: `c${i}`, assetId: a }] })) } as unknown as Project);
const processed = (id: string) => id.startsWith('P');

describe('undo limit for processed copies', () => {
  // original -> P1 -> P2 -> P3 -> P4, each a processing step
  const states = [proj('orig'), proj('P1'), proj('P2'), proj('P3')];
  const present = proj('P4');

  it('finds the assets a project uses', () => {
    expect([...assetIdsOf(proj('a', 'b'))].sort()).toEqual(['a', 'b']);
  });
  it('no limit keeps everything', () => {
    expect(pastStatesToDrop(states, present, null, processed)).toBe(0);
  });
  it('limit 3 keeps the present and two older copies, and drops older states', () => {
    // present P4, then P3, P2 are within 3; the state with P1 would be the 4th
    expect(pastStatesToDrop(states, present, 3, processed)).toBe(2);
  });
  it('limit 1 keeps only the present copy but still allows undo back to the original', () => {
    const one = [proj('orig')];
    expect(pastStatesToDrop(one, proj('P1'), 1, processed)).toBe(0);
    expect(pastStatesToDrop(states, present, 1, processed)).toBe(4);
  });
  it('edits that do not create copies cost nothing', () => {
    const cheap = [proj('orig'), proj('orig'), proj('P1'), proj('P1'), proj('P1')];
    expect(pastStatesToDrop(cheap, proj('P1'), 1, processed)).toBe(0);
  });
});
