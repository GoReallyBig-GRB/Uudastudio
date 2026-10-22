import { describe, it, expect } from 'vitest';
import { pluginManager, MASTER_TRACK_ID } from './pluginManager';
import { findPluginDescriptor } from './registry';
import { withPluginStates, restorePluginStates, isRestoringPlugins } from './projectPlugins';
import { makeContext } from '../test/fakeAudioContext';
import { Project, Track } from '../types';

function track(id: string): Track {
  return { id, name: 'Track', clips: [], volume: 1, pan: 0, muted: false, solo: false };
}
function project(tracks: Track[]): Project {
  return {
    id: 'p',
    name: 'p',
    tracks,
    sampleRate: 48000,
    settings: { autoRefresh: true, sampleRate: 48000, duckPlayingTracks: true, duckingAmountDb: -12 },
  };
}

describe('plugin chains saved with the project', () => {
  it('writes chains into the project and rebuilds them with the same settings', async () => {
    pluginManager.clearAll();
    const ctx = makeContext();
    const comp = findPluginDescriptor('uuda-native-compressor')!;
    const reverb = findPluginDescriptor('uuda-native-reverb')!;
    const a = await pluginManager.addPluginToTrack(ctx, 't1', comp);
    a.setParameter('threshold', -30);
    a.isBypassed = true;
    await pluginManager.addPluginToTrack(ctx, MASTER_TRACK_ID, reverb);

    const saved = await withPluginStates(project([track('t1'), track('t2')]));
    expect(saved.tracks[0].plugins!.length).toBe(1);
    expect(saved.tracks[0].plugins![0].pluginId).toBe('uuda-native-compressor');
    expect(saved.tracks[0].plugins![0].parameters.threshold).toBe(-30);
    expect(saved.tracks[0].plugins![0].isBypassed).toBe(true);
    expect('plugins' in saved.tracks[1]).toBe(false);
    expect(saved.masterPlugins!.length).toBe(1);

    // Survives a JSON round trip, like a saved file
    const reloaded = JSON.parse(JSON.stringify(saved)) as Project;
    pluginManager.clearAll();
    expect(pluginManager.getPluginsForTrack('t1').length).toBe(0);
    await restorePluginStates(makeContext(), reloaded);

    const back = pluginManager.getPluginsForTrack('t1');
    expect(back.length).toBe(1);
    expect(back[0].getParameter('threshold')).toBe(-30);
    expect(back[0].isBypassed).toBe(true);
    expect(pluginManager.getPluginsForTrack(MASTER_TRACK_ID).length).toBe(1);
    pluginManager.clearAll();
  });

  it('a save that happens while restoring keeps the saved chains instead of wiping them', async () => {
    pluginManager.clearAll();
    const ctx = makeContext();
    await pluginManager.addPluginToTrack(ctx, 't1', findPluginDescriptor('uuda-native-gate')!);
    const saved = await withPluginStates(project([track('t1')]));
    pluginManager.clearAll();

    // Start a restore but do not wait: while it runs, live chains are still empty
    const pending = restorePluginStates(makeContext(), saved);
    expect(isRestoringPlugins()).toBe(true);
    const midSave = await withPluginStates(saved);
    expect(midSave.tracks[0].plugins!.length).toBe(1);
    await pending;
    expect(isRestoringPlugins()).toBe(false);

    // Once restored, removing the plugin removes it from the next save
    pluginManager.clearAll();
    const after = await withPluginStates(saved);
    expect('plugins' in after.tracks[0]).toBe(false);
  });

  it('clearTrack removes only that track', async () => {
    pluginManager.clearAll();
    const ctx = makeContext();
    await pluginManager.addPluginToTrack(ctx, 'a', findPluginDescriptor('uuda-native-gate')!);
    await pluginManager.addPluginToTrack(ctx, 'b', findPluginDescriptor('uuda-native-gate')!);
    pluginManager.clearTrack('a');
    expect(pluginManager.getPluginsForTrack('a').length).toBe(0);
    expect(pluginManager.getPluginsForTrack('b').length).toBe(1);
    pluginManager.clearAll();
  });
});
