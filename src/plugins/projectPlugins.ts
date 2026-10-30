/**
 * Uuda Studio - saving and restoring plugin chains with the project.
 *
 * Chains live in the plugin manager while the app runs. To keep them across a reload or a saved file, the project
 * carries them as plain data: Track.plugins for each track and Project.masterPlugins for the whole mix.
 *
 * withPluginStates():   copy of the project with the current chains written in. Used by autosave and "save to file".
 * restorePluginStates(): rebuilds the chains from a loaded project.
 *
 * While a restore is running, saving keeps whatever chain data the project already carries instead of reading the
 * (still empty) live chains, so an autosave that fires mid-restore cannot wipe the saved chains.
 */

import { Project, Track } from '../types';
import { pluginManager, MASTER_TRACK_ID } from './pluginManager';
import { StoredPluginState } from './types';
import { groupChainId, groupIdsOf } from './groupChain';

let restoring = 0;

export function isRestoringPlugins(): boolean {
  return restoring > 0;
}

function without<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const { [key]: _drop, ...rest } = obj;
  return rest;
}

export async function withPluginStates(project: Project): Promise<Project> {
  const tracks: Track[] = [];
  for (const track of project.tracks) {
    const live = await pluginManager.exportTrackPluginStates(track.id);
    if (live.length > 0) tracks.push({ ...track, plugins: live });
    else if (restoring > 0 && track.plugins && track.plugins.length > 0) tracks.push(track);
    else tracks.push(without(track, 'plugins') as Track);
  }

  const liveMaster = await pluginManager.exportTrackPluginStates(MASTER_TRACK_ID);
  let masterPlugins: StoredPluginState[] | undefined;
  if (liveMaster.length > 0) masterPlugins = liveMaster;
  else if (restoring > 0) masterPlugins = project.masterPlugins;

  // Group chains: one per group that still has clips (or that the project already carries while a restore runs)
  const groupPlugins: Record<string, StoredPluginState[]> = {};
  const groupIds = new Set([...groupIdsOf(project), ...Object.keys(project.groupPlugins ?? {})]);
  for (const g of groupIds) {
    const live = await pluginManager.exportTrackPluginStates(groupChainId(g));
    if (live.length > 0) groupPlugins[g] = live;
    else if (restoring > 0 && project.groupPlugins?.[g]?.length) groupPlugins[g] = project.groupPlugins[g];
  }

  const base = without(without(project, 'masterPlugins'), 'groupPlugins') as Project;
  const out: Project = masterPlugins && masterPlugins.length > 0 ? { ...base, tracks, masterPlugins } : { ...base, tracks };
  return Object.keys(groupPlugins).length > 0 ? { ...out, groupPlugins } : out;
}

/** True when the project carries any saved chain */
export function hasSavedPlugins(project: Project): boolean {
  return (
    (project.masterPlugins?.length ?? 0) > 0 ||
    Object.values(project.groupPlugins ?? {}).some((l) => l.length > 0) ||
    project.tracks.some((t) => (t.plugins?.length ?? 0) > 0)
  );
}

/**
 * Rebuilds the saved chains. `ctx` may be a promise (the audio context can wait for the first click); the restoring
 * flag is raised straight away so saves in the meantime keep the saved data. Only the tracks listed in the project
 * are replaced, so a plugin the user adds meanwhile on another chain is left alone. Callers that load a different
 * project clear the old chains first with pluginManager.clearAll().
 */
export async function restorePluginStates(
  ctx: BaseAudioContext | Promise<BaseAudioContext>,
  project: Project
): Promise<void> {
  restoring++;
  try {
    const audioCtx = await ctx;
    for (const track of project.tracks) {
      if (track.plugins && track.plugins.length > 0) {
        await pluginManager.restoreTrackPluginStates(audioCtx, track.id, track.plugins);
      }
    }
    if (project.masterPlugins && project.masterPlugins.length > 0) {
      await pluginManager.restoreTrackPluginStates(audioCtx, MASTER_TRACK_ID, project.masterPlugins);
    }
    for (const [groupId, states] of Object.entries(project.groupPlugins ?? {})) {
      if (states.length > 0) await pluginManager.restoreTrackPluginStates(audioCtx, groupChainId(groupId), states);
    }
  } finally {
    restoring--;
  }
}
