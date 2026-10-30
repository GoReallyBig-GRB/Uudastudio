import { describe, it, expect } from 'vitest';
import { pluginManager, MASTER_TRACK_ID } from './pluginManager';
import { findPluginDescriptor } from './registry';
import { pluginSignature, collectLive, attachLive, applySnapshot } from './pluginHistory';
import { makeContext } from '../test/fakeAudioContext';
import { Project, Track } from '../types';
import { groupChainId } from './groupChain';

const track = (id: string): Track => ({ id, name: id, clips: [], volume: 1, pan: 0, muted: false, solo: false });
const project = (ids: string[]): Project => ({
  id: 'p', name: 'p', tracks: ids.map(track), sampleRate: 48000,
  settings: { autoRefresh: true, sampleRate: 48000, duckPlayingTracks: true, duckingAmountDb: -12 },
});
const comp = () => findPluginDescriptor('uuda-native-compressor')!;
const reverb = () => findPluginDescriptor('uuda-native-reverb')!;

async function snap(p: Project): Promise<Project> {
  return JSON.parse(JSON.stringify(attachLive(p, await collectLive(p))));
}

describe('plugin chains in history', () => {
  it('the signature sees plugin, order, bypass, mix and parameters, but not instance ids', async () => {
    pluginManager.clearAll();
    const ctx = makeContext();
    const base = project(['t1']);
    const empty = pluginSignature(base);
    const a = await pluginManager.addPluginToTrack(ctx, 't1', comp());
    const s1 = pluginSignature(await snap(base));
    expect(s1).not.toBe(empty);

    a.setParameter('threshold', -33);
    const s2 = pluginSignature(await snap(base));
    expect(s2).not.toBe(s1);

    a.isBypassed = true;
    const s3 = pluginSignature(await snap(base));
    expect(s3).not.toBe(s2);

    // a rebuilt chain has new instance ids but the same signature
    const full = await snap(base);
    const oldId = full.tracks[0].plugins![0].instanceId;
    pluginManager.clearAll();
    expect(await applySnapshot(ctx, full)).toBe(true);
    const rebuilt = await snap(base);
    expect(rebuilt.tracks[0].plugins![0].instanceId === oldId).toBe(false);
    expect(pluginSignature(rebuilt)).toBe(pluginSignature(full));
    pluginManager.clearAll();
  });

  it('undo: applying an older snapshot removes a plugin that was added afterwards; redo brings it back', async () => {
    pluginManager.clearAll();
    const ctx = makeContext();
    const base = project(['t1']);
    const before = await snap(base); // no plugins
    const a = await pluginManager.addPluginToTrack(ctx, 't1', comp());
    a.setParameter('threshold', -27);
    const after = await snap(base); // one compressor

    expect(await applySnapshot(ctx, before)).toBe(true);
    expect(pluginManager.getPluginsForTrack('t1').length).toBe(0);

    expect(await applySnapshot(ctx, after)).toBe(true);
    const back = pluginManager.getPluginsForTrack('t1');
    expect(back.length).toBe(1);
    expect(back[0].getParameter('threshold')).toBe(-27);
    pluginManager.clearAll();
  });

  it('undo restores order, bypass and the master chain', async () => {
    pluginManager.clearAll();
    const ctx = makeContext();
    const base = project(['t1']);
    await pluginManager.addPluginToTrack(ctx, 't1', comp());
    await pluginManager.addPluginToTrack(ctx, 't1', reverb());
    await pluginManager.addPluginToTrack(ctx, MASTER_TRACK_ID, comp());
    const original = await snap(base);

    pluginManager.reorderTrackPlugins('t1', 0, 1);
    pluginManager.getPluginsForTrack('t1')[0].isBypassed = true;
    pluginManager.clearTrack(MASTER_TRACK_ID);
    expect(pluginSignature(await snap(base))).not.toBe(pluginSignature(original));

    expect(await applySnapshot(ctx, original)).toBe(true);
    expect(pluginManager.getPluginsForTrack('t1').map((p) => p.descriptor.id)).toEqual(['uuda-native-compressor', 'uuda-native-reverb']);
    expect(pluginManager.getPluginsForTrack('t1')[0].isBypassed).toBe(false);
    expect(pluginManager.getPluginsForTrack(MASTER_TRACK_ID).length).toBe(1);
    pluginManager.clearAll();
  });

  it('does not touch the chains when they already match (undoing a clip edit)', async () => {
    pluginManager.clearAll();
    const ctx = makeContext();
    const base = project(['t1']);
    const a = await pluginManager.addPluginToTrack(ctx, 't1', comp());
    const same = await snap(base);
    expect(await applySnapshot(ctx, same)).toBe(false);
    expect(pluginManager.getPluginsForTrack('t1')[0] === a).toBe(true); // same live instance, not rebuilt
    pluginManager.clearAll();
  });

  it('undoing a track delete brings the track chain back', async () => {
    pluginManager.clearAll();
    const ctx = makeContext();
    const base = project(['t1', 't2']);
    await pluginManager.addPluginToTrack(ctx, 't2', reverb());
    const withTrack = await snap(base);
    pluginManager.clearTrack('t2'); // what handleDeleteTrack does
    expect(pluginManager.getPluginsForTrack('t2').length).toBe(0);
    await applySnapshot(ctx, withTrack);
    expect(pluginManager.getPluginsForTrack('t2').length).toBe(1);
    pluginManager.clearAll();
  });

  it('every kind of edit, including a parameter drag, notifies edit listeners', async () => {
    pluginManager.clearAll();
    const ctx = makeContext();
    let edits = 0;
    const off = pluginManager.subscribeEdits(() => edits++);
    const a = await pluginManager.addPluginToTrack(ctx, 't1', comp());
    const afterAdd = edits;
    expect(afterAdd).toBeGreaterThan(0);
    pluginManager.setParameterDirect('t1', a.instanceId, 'threshold', -20);
    expect(edits).toBeGreaterThan(afterAdd);
    const n = edits;
    pluginManager.setPluginBypass('t1', a.instanceId, true);
    expect(edits).toBeGreaterThan(n);
    off();
    pluginManager.clearAll();
  });
});

describe('group chains in history', () => {
  const grouped = (): Project => {
    const p = project(['t1']);
    p.tracks[0].clips = [{ id: 'c1', trackId: 't1', assetId: 'a', name: 'c1', startSeconds: 0, offsetSeconds: 0, durationSeconds: 1, gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'linear', groupId: 'g1' }];
    return p;
  };

  it('a group chain is saved with the snapshot and changes the signature', async () => {
    pluginManager.clearAll();
    const ctx = makeContext();
    const base = grouped();
    const empty = pluginSignature(await snap(base));
    await pluginManager.addPluginToTrack(ctx, groupChainId('g1'), comp());
    const withChain = await snap(base);
    expect(withChain.groupPlugins?.g1).toHaveLength(1);
    expect(pluginSignature(withChain)).not.toBe(empty);
  });

  it('undo rebuilds a removed group chain from the snapshot', async () => {
    pluginManager.clearAll();
    const ctx = makeContext();
    const base = grouped();
    await pluginManager.addPluginToTrack(ctx, groupChainId('g1'), comp());
    const before = await snap(base);
    pluginManager.clearTrack(groupChainId('g1'));
    expect(pluginManager.getPluginsForTrack(groupChainId('g1'))).toHaveLength(0);
    const rebuilt = await applySnapshot(ctx, before);
    expect(rebuilt).toBe(true);
    expect(pluginManager.getPluginsForTrack(groupChainId('g1'))).toHaveLength(1);
  });
});
