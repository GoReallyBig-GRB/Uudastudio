import { describe, it, expect } from 'vitest';
import { BUILT_IN_TEMPLATES } from './builtIn';
import { projectFromTemplate } from './template';
import { pluginManager } from '../plugins/pluginManager';
import { restorePluginStates, withPluginStates } from '../plugins/projectPlugins';
import { makeContext } from '../test/fakeAudioContext';

describe('using a starter template', () => {
  it('sets up the voice chains in the plugin manager exactly as the template says, and saves them again', async () => {
    pluginManager.clearAll();
    const podcast = BUILT_IN_TEMPLATES[0];
    const project = projectFromTemplate(podcast);
    await restorePluginStates(makeContext(), project);

    const host = project.tracks[0];
    const chain = pluginManager.getPluginsForTrack(host.id);
    expect(chain.map((p) => p.descriptor.id)).toEqual([
      'uuda-native-voice-enhancer',
      'uuda-native-compressor',
      'uuda-native-deesser',
    ]);
    expect(chain.every((p) => !p.missing)).toBe(true);
    expect(chain[1].getParameter('threshold')).toBe(-26); // "Tight Podcast"

    // the music bed has no chain but does have ducking, and the guest has its own chain
    expect(pluginManager.getPluginsForTrack(project.tracks[2].id).length).toBe(0);
    expect(pluginManager.getPluginsForTrack(project.tracks[1].id).length).toBe(3);

    const saved = await withPluginStates(project);
    expect(saved.tracks[0].plugins!.length).toBe(3);
    expect(saved.tracks[2].ducking!.sourceTrackIds).toEqual([project.tracks[0].id, project.tracks[1].id]);
    pluginManager.clearAll();
  });
});
