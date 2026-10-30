/**
 * Uuda Studio - plugin chains in undo/redo.
 *
 * The chains live in the plugin manager, not in the project. For undo to cover them, each history snapshot carries
 * the chains as plain data (Track.plugins, Project.masterPlugins), kept up to date by attachLive() after edits.
 * Undoing then means putting the live chains back to match the snapshot: applySnapshot().
 *
 * pluginSignature() is how two states are compared. It ignores instance ids (rebuilt chains get new ones) and the
 * opaque state blob, and looks at what you can hear: which plugins, in what order, bypass, mix and parameters.
 */

import { Project, Track } from '../types';
import { pluginManager, MASTER_TRACK_ID } from './pluginManager';
import { restorePluginStates } from './projectPlugins';
import { StoredPluginState } from './types';
import { groupChainId, groupIdsOf } from './groupChain';

export interface LivePluginStates {
  tracks: Record<string, StoredPluginState[]>;
  master: StoredPluginState[];
  groups?: Record<string, StoredPluginState[]>;
}

function norm(list: StoredPluginState[] | undefined): unknown[] {
  return (list || []).map((p) => [p.pluginId, p.isBypassed ? 1 : 0, p.dryWet, Object.entries(p.parameters || {}).sort(([a], [b]) => (a < b ? -1 : 1))]);
}

export function pluginSignature(project: Project): string {
  const tracks = project.tracks
    .filter((t) => (t.plugins?.length ?? 0) > 0)
    .map((t) => [t.id, norm(t.plugins)])
    .sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1));
  const groups = Object.entries(project.groupPlugins ?? {})
    .filter(([, l]) => l.length > 0)
    .map(([g, l]) => [g, norm(l)])
    .sort((a, b) => ((a[0] as string) < (b[0] as string) ? -1 : 1));
  return JSON.stringify(groups.length > 0 ? [tracks, norm(project.masterPlugins), groups] : [tracks, norm(project.masterPlugins)]);
}

export async function collectLive(project: Project): Promise<LivePluginStates> {
  const tracks: Record<string, StoredPluginState[]> = {};
  for (const t of project.tracks) tracks[t.id] = await pluginManager.exportTrackPluginStates(t.id);
  const groups: Record<string, StoredPluginState[]> = {};
  for (const g of new Set([...groupIdsOf(project), ...Object.keys(project.groupPlugins ?? {})])) {
    groups[g] = await pluginManager.exportTrackPluginStates(groupChainId(g));
  }
  return { tracks, master: await pluginManager.exportTrackPluginStates(MASTER_TRACK_ID), groups };
}

/** The project with its plugin data replaced by the live chains (everything else untouched) */
export function attachLive(project: Project, live: LivePluginStates): Project {
  const tracks: Track[] = project.tracks.map((t) => {
    const states = live.tracks[t.id];
    if (states && states.length > 0) return { ...t, plugins: states };
    if (t.plugins === undefined) return t;
    const { plugins: _drop, ...rest } = t;
    return rest as Track;
  });
  const { masterPlugins: _m, groupPlugins: _g, ...base } = project;
  const groupPlugins: Record<string, StoredPluginState[]> = {};
  for (const [g, states] of Object.entries(live.groups ?? {})) if (states.length > 0) groupPlugins[g] = states;
  const withMaster: Project = live.master.length > 0 ? { ...base, tracks, masterPlugins: live.master } : { ...base, tracks };
  return Object.keys(groupPlugins).length > 0 ? { ...withMaster, groupPlugins } : withMaster;
}

/**
 * Makes the live chains match a history snapshot. Returns true when it had to rebuild them.
 * Leaves chains alone when they already match, so undoing a clip edit never disturbs the audio.
 */
export async function applySnapshot(ctx: BaseAudioContext | Promise<BaseAudioContext>, snapshot: Project): Promise<boolean> {
  const live = await collectLive(snapshot);
  if (pluginSignature(attachLive(snapshot, live)) === pluginSignature(snapshot)) return false;
  pluginManager.clearAll();
  await restorePluginStates(ctx, snapshot);
  return true;
}
