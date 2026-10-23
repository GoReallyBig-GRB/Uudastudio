import { describe, it, expect } from 'vitest';
import { pluginManager } from './pluginManager';
import { findPluginDescriptor } from './registry';
import { withPluginStates, restorePluginStates } from './projectPlugins';
import { appendOfflinePlugins, SkippedPlugin } from '../audio/mastering';
import { makeContext, makeNode } from '../test/fakeAudioContext';
import { Project, Track } from '../types';

const track = (id: string): Track => ({ id, name: id, clips: [], volume: 1, pan: 0, muted: false, solo: false });
const project = (): Project => ({
  id: 'p', name: 'p', tracks: [track('t1')], sampleRate: 48000,
  settings: { autoRefresh: true, sampleRate: 48000, duckPlayingTracks: true, duckingAmountDb: -12 },
});

const saved = (): Project => ({
  ...project(),
  tracks: [
    {
      ...track('t1'),
      plugins: [
        { instanceId: 'a', pluginId: 'acme-super-verb', isBypassed: true, dryWet: 0.4, parameters: { size: 0.7, decay: 3 }, customState: { size: 0.7, decay: 3 }, moduleUrl: 'https://example.com/verb.js' },
        { instanceId: 'b', pluginId: 'uuda-native-compressor', isBypassed: false, dryWet: 1, parameters: { threshold: -22 } },
      ],
    },
  ],
});

describe('missing plugins', () => {
  pluginManager.thirdPartyLoadTimeoutMs = 50; // a module URL that never answers (as in this sandbox) becomes Missing quickly

  it('an unknown plugin stays in the chain as a pass-through, in order, beside the working ones', async () => {
    pluginManager.clearAll();
    await restorePluginStates(makeContext(), saved());
    const chain = pluginManager.getPluginsForTrack('t1');
    expect(chain.length).toBe(2);
    expect(chain[0].missing).toBe(true);
    expect(chain[0].descriptor.id).toBe('acme-super-verb');
    expect(chain[1].missing).toBe(undefined);
    expect(chain[1].descriptor.id).toBe('uuda-native-compressor');
    expect(chain[1].getParameter('threshold')).toBe(-22);
    pluginManager.clearAll();
  });

  it('saving again keeps the missing plugin and everything it remembered', async () => {
    pluginManager.clearAll();
    await restorePluginStates(makeContext(), saved());
    const out = await withPluginStates(project());
    const first = out.tracks[0].plugins![0];
    expect(first.pluginId).toBe('acme-super-verb');
    expect(first.isBypassed).toBe(true);
    expect(first.dryWet).toBe(0.4);
    expect(first.parameters.size).toBe(0.7);
    expect(first.parameters.decay).toBe(3);
    expect(first.moduleUrl).toBe('https://example.com/verb.js');
    pluginManager.clearAll();
  });

  it('settings survive when the plugin comes back (open the file where it is installed)', async () => {
    pluginManager.clearAll();
    const real = findPluginDescriptor('uuda-native-reverb')!;
    const file: Project = {
      ...project(),
      tracks: [{ ...track('t1'), plugins: [{ instanceId: 'x', pluginId: real.id, isBypassed: false, dryWet: 0.3, parameters: { decayTime: 2 } }] }],
    };
    await restorePluginStates(makeContext(), file);
    const chain = pluginManager.getPluginsForTrack('t1');
    expect(chain[0].missing).toBe(undefined);
    expect(chain[0].dryWet).toBeCloseTo(0.3);
    pluginManager.clearAll();
  });

  it('audio passes through it unchanged in the live graph', async () => {
    pluginManager.clearAll();
    await restorePluginStates(makeContext(), saved());
    const src = makeNode();
    const dst = makeNode();
    const connected: unknown[] = [];
    src.connect = (n: unknown) => { connected.push(n); return n; };
    pluginManager.connectPluginChain('t1', src, dst);
    expect(connected.length).toBe(1);
    expect(connected[0] === pluginManager.getPluginsForTrack('t1')[0].inputNode).toBe(true);
    pluginManager.clearAll();
  });

  it('the export skips it, says so, and still builds the working plugin', async () => {
    pluginManager.clearAll();
    await restorePluginStates(makeContext(), saved());
    const skipped: SkippedPlugin[] = [];
    // The first (missing) plugin is bypassed in this file, so un-bypass it to be sure it is reported
    pluginManager.getPluginsForTrack('t1')[0].isBypassed = false;
    const source = makeNode();
    const out = await appendOfflinePlugins(makeContext(), 't1', source, skipped);
    expect(skipped).toEqual([{ chainId: 't1', name: 'Acme super verb', reason: 'missing' }]);
    expect(out === source).toBe(false); // the compressor was applied
    pluginManager.clearAll();
  });

  it('a bypassed missing plugin is not reported (it was not going to do anything)', async () => {
    pluginManager.clearAll();
    await restorePluginStates(makeContext(), saved());
    const skipped: SkippedPlugin[] = [];
    await appendOfflinePlugins(makeContext(), 't1', makeNode(), skipped);
    expect(skipped.length).toBe(0);
    pluginManager.clearAll();
  });
});
