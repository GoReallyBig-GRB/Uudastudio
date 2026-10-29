/**
 * Uuda Studio - effect chains for clip groups.
 *
 * A group of clips can carry one plugin chain that processes the whole group as a unit. The chain lives in the plugin
 * manager under a pseudo chain id (like the master bus does), and is saved on the project as Project.groupPlugins.
 * Pure helpers only, so the live engine, the export mixdown, saving, undo and the rack all agree on the ids.
 */
import type { Project } from '../types';

export const GROUP_CHAIN_PREFIX = '__group__:';

export const groupChainId = (groupId: string): string => `${GROUP_CHAIN_PREFIX}${groupId}`;
export const isGroupChainId = (id: string | null | undefined): boolean => !!id && id.startsWith(GROUP_CHAIN_PREFIX);
export const groupIdOfChain = (chainId: string): string => chainId.slice(GROUP_CHAIN_PREFIX.length);

/** Ids of every group that still has at least one clip, in the order they first appear on the timeline. */
export const groupIdsOf = (project: Pick<Project, 'tracks'>): string[] => {
  const seen: string[] = [];
  for (const t of project.tracks) {
    for (const c of t.clips) {
      if (c.groupId && !seen.includes(c.groupId)) seen.push(c.groupId);
    }
  }
  return seen;
};

/** "Group 2 (3 clips)": a plain label for menus. */
export const groupLabel = (project: Pick<Project, 'tracks'>, groupId: string): string => {
  const ids = groupIdsOf(project);
  const n = ids.indexOf(groupId) + 1;
  let count = 0;
  for (const t of project.tracks) for (const c of t.clips) if (c.groupId === groupId) count++;
  return `Group ${n > 0 ? n : '?'} (${count} ${count === 1 ? 'clip' : 'clips'})`;
};
