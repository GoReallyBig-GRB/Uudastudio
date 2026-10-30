import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { groupChainId, groupIdOfChain, groupIdsOf, groupLabel, isGroupChainId } from './groupChain';

const clip = (id: string, groupId?: string) => ({ id, groupId }) as never;
const project = {
  tracks: [
    { id: 't1', clips: [clip('a', 'g1'), clip('b'), clip('c', 'g2')] },
    { id: 't2', clips: [clip('d', 'g1')] },
  ],
} as unknown as Project;

describe('group chain ids', () => {
  it('round-trips and never clashes with track or master ids', () => {
    const id = groupChainId('g1');
    expect(isGroupChainId(id)).toBe(true);
    expect(groupIdOfChain(id)).toBe('g1');
    expect(isGroupChainId('track-1')).toBe(false);
    expect(isGroupChainId('__master__')).toBe(false);
    expect(isGroupChainId(null)).toBe(false);
  });
  it('lists groups that still have clips, in timeline order', () => {
    expect(groupIdsOf(project)).toEqual(['g1', 'g2']);
  });
  it('labels groups with their clip count', () => {
    expect(groupLabel(project, 'g1')).toBe('Group 1 (2 clips)');
    expect(groupLabel(project, 'g2')).toBe('Group 2 (1 clip)');
  });
});
