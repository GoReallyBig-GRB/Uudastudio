/**
 * Level, pan and mute of a clip group. A group behaves like a small channel of its own: its clips no longer pass through
 * their track's fader, so moving a track fader never disturbs the group's mix. Stored on Project.groupSettings (key = Clip.groupId)
 * and removed again when the group is released.
 */
import type { GroupSettings, Project } from '../types';

export const DEFAULT_GROUP_SETTINGS: GroupSettings = { volume: 1, pan: 0, muted: false };

export const GROUP_VOLUME_MAX = 1.5;

export function groupSettingsFor(project: Pick<Project, 'groupSettings'>, groupId: string): GroupSettings {
  return { ...DEFAULT_GROUP_SETTINGS, ...(project.groupSettings?.[groupId] ?? {}) };
}

/** Linear gain the group's output stage uses (0 while muted). */
export function groupOutputGain(s: GroupSettings): number {
  return s.muted ? 0 : clamp(s.volume, 0, GROUP_VOLUME_MAX);
}

export function groupPan(s: GroupSettings): number {
  return clamp(s.pan, -1, 1);
}

function isDefault(s: GroupSettings): boolean {
  return s.volume === DEFAULT_GROUP_SETTINGS.volume && s.pan === DEFAULT_GROUP_SETTINGS.pan && !s.muted && s.color === undefined && s.name === undefined && s.order === undefined;
}

/** Returns a new project with the patch applied; settings equal to the defaults are not stored. */
export function patchGroupSettings(project: Project, groupId: string, patch: Partial<GroupSettings>): Project {
  const next = { ...groupSettingsFor(project, groupId), ...patch };
  next.volume = clamp(next.volume, 0, GROUP_VOLUME_MAX);
  next.pan = clamp(next.pan, -1, 1);
  const map = { ...(project.groupSettings ?? {}) };
  if (isDefault(next)) delete map[groupId];
  else map[groupId] = next;
  const out: Project = { ...project };
  if (Object.keys(map).length > 0) out.groupSettings = map;
  else delete out.groupSettings;
  return out;
}

/** Removes the settings of the given groups (used by Ungroup). */
export function dropGroupSettings(project: Project, groupIds: Iterable<string>): Project {
  if (!project.groupSettings) return project;
  const map = { ...project.groupSettings };
  for (const g of groupIds) delete map[g];
  const out: Project = { ...project };
  if (Object.keys(map).length > 0) out.groupSettings = map;
  else delete out.groupSettings;
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}
