import { describe, it, expect } from 'vitest';
import { appendOfflinePlugins } from './mastering';
import { pluginManager, MASTER_TRACK_ID } from '../plugins/pluginManager';
import { findPluginDescriptor } from '../plugins/registry';
import { makeContext, makeNode } from '../test/fakeAudioContext';

describe('master bus chain in the offline export', () => {
  it('wires active master plugins in series after the source and skips bypassed ones', async () => {
    pluginManager.clearAll();
    const ctx = makeContext();
    const comp = findPluginDescriptor('uuda-native-compressor')!;
    const limiter = findPluginDescriptor('uuda-native-limiter')!;
    const a = await pluginManager.addPluginToTrack(ctx, MASTER_TRACK_ID, comp);
    const b = await pluginManager.addPluginToTrack(ctx, MASTER_TRACK_ID, limiter);

    const source = makeNode();
    const out = await appendOfflinePlugins(makeContext(), MASTER_TRACK_ID, source);
    expect(out === source).toBe(false);

    pluginManager.setPluginBypass(MASTER_TRACK_ID, a.instanceId, true);
    pluginManager.setPluginBypass(MASTER_TRACK_ID, b.instanceId, true);
    const bypassed = await appendOfflinePlugins(makeContext(), MASTER_TRACK_ID, source);
    expect(bypassed === source).toBe(true);
    pluginManager.clearAll();
  });

  it('an empty chain returns the source untouched', async () => {
    pluginManager.clearAll();
    const source = makeNode();
    expect((await appendOfflinePlugins(makeContext(), MASTER_TRACK_ID, source)) === source).toBe(true);
  });
});
