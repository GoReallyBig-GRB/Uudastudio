import { describe, it, expect } from 'vitest';
import {
  templateFromProject, projectFromTemplate, parseTemplate, serializeTemplate, templateFileName, guessRole,
  TEMPLATE_VERSION, MAX_TEMPLATE_TRACKS, UudaTemplate,
} from './template';
import { BUILT_IN_TEMPLATES } from './builtIn';
import { findPluginDescriptor } from '../plugins/registry';
import { DEFAULT_DUCKING } from '../audio/ducking';
import { Project, Track, Clip } from '../types';

const clip: Clip = {
  id: 'c', trackId: 't', assetId: 'a', name: 'c', startSeconds: 0, offsetSeconds: 0, durationSeconds: 5,
  gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'linear',
};
const track = (id: string, name: string, over: Partial<Track> = {}): Track => ({
  id, name, clips: [clip], volume: 1, pan: 0, muted: false, solo: false, ...over,
});
function sample(): Project {
  return {
    id: 'p', name: 'My show', sampleRate: 48000,
    settings: { autoRefresh: true, sampleRate: 48000, duckPlayingTracks: true, duckingAmountDb: -12 },
    tracks: [
      track('v1', 'Host', { customName: true, volume: 0.9, pan: -0.2, plugins: [
        { instanceId: 'i1', pluginId: 'uuda-native-compressor', isBypassed: false, dryWet: 1, parameters: { threshold: -24, ratio: 3 } },
      ] }),
      track('m1', 'Music', { volume: 0.5, ducking: { ...DEFAULT_DUCKING, enabled: true, sourceTrackIds: ['v1'], amountDb: -15 } }),
    ],
    masterPlugins: [{ instanceId: 'm', pluginId: 'uuda-native-limiter', isBypassed: false, dryWet: 1, parameters: { ceiling: -1 } }],
  };
}

describe('template from a project', () => {
  it('keeps structure, settings and plugin chains, and leaves out all audio', () => {
    const t = templateFromProject(sample(), { name: 'Show', description: 'd', tags: ['a', 'b'] }, 1000);
    expect(t.tracks.length).toBe(2);
    expect(t.tracks[0].name).toBe('Host');
    expect(t.tracks[0].role).toBe('voice');
    expect(t.tracks[0].volume).toBe(0.9);
    expect(t.tracks[0].pan).toBe(-0.2);
    expect(t.tracks[0].plugins![0].parameters.threshold).toBe(-24);
    expect(t.tracks[1].role).toBe('music');
    expect(t.masterPlugins![0].pluginId).toBe('uuda-native-limiter');
    expect(JSON.stringify(t)).not.toContain('"clips"');
    expect(JSON.stringify(t)).not.toContain('assetId');
  });

  it('records ducking sources by position, not by id', () => {
    const t = templateFromProject(sample(), { name: 'Show' });
    expect(t.tracks[1].ducking!.sourceTrackIndexes).toEqual([0]);
    expect(t.tracks[1].ducking!.amountDb).toBe(-15);
    expect('sourceTrackIds' in t.tracks[1].ducking!).toBe(false);
    expect(t.tracks[0].ducking).toBe(undefined);
  });

  it('guesses roles from names', () => {
    expect(guessRole('Guest')).toBe('voice');
    expect(guessRole('Music bed')).toBe('music');
    expect(guessRole('Sound effects')).toBe('sfx');
    expect(guessRole('Stuff')).toBe('other');
  });
});

describe('project from a template', () => {
  it('makes fresh empty tracks with new ids and remaps ducking sources to them', () => {
    const t = templateFromProject(sample(), { name: 'Show' });
    const a = projectFromTemplate(t, { now: 5 });
    const b = projectFromTemplate(t, { now: 6 });
    expect(a.tracks.every((x) => x.clips.length === 0)).toBe(true);
    expect(a.tracks[0].id).not.toBe('v1');
    expect(a.tracks[0].id).not.toBe(b.tracks[0].id);
    expect(a.tracks[1].ducking!.sourceTrackIds).toEqual([a.tracks[0].id]);
    expect(a.tracks[1].ducking!.enabled).toBe(true);
    expect(a.tracks[0].plugins![0].parameters.ratio).toBe(3);
    expect(a.masterPlugins!.length).toBe(1);
    expect(a.name).toBe('Show');
    expect(projectFromTemplate(t, { name: 'Other' }).name).toBe('Other');
  });

  it('a track never ducks under itself and bad source positions are dropped', () => {
    const t = templateFromProject(sample(), { name: 'Show' });
    t.tracks[1].ducking!.sourceTrackIndexes = [1, 0, 9, -1];
    const p = projectFromTemplate(t);
    expect(p.tracks[1].ducking!.sourceTrackIds).toEqual([p.tracks[0].id]);
  });

  it('does not share plugin objects with the template (editing a project must not change the template)', () => {
    const t = templateFromProject(sample(), { name: 'Show' });
    const p = projectFromTemplate(t);
    p.tracks[0].plugins![0].parameters.threshold = -50;
    expect(t.tracks[0].plugins![0].parameters.threshold).toBe(-24);
  });
});

describe('template files', () => {
  it('round-trips through text', () => {
    const t = templateFromProject(sample(), { name: 'Show', tags: ['x'] });
    const r = parseTemplate(serializeTemplate(t));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.template.tracks.map((x) => x.name)).toEqual(['Host', 'Music']);
      expect(r.template.tracks[1].ducking!.sourceTrackIndexes).toEqual([0]);
      expect(r.template.tags).toEqual(['x']);
    }
  });

  it('refuses things that are not templates, with a plain message', () => {
    for (const bad of ['not json', '[]', '{}', JSON.stringify({ format: 'something-else', version: 1, tracks: [{}] })]) {
      const r = parseTemplate(bad);
      expect(r.ok).toBe(false);
    }
    const noTracks = parseTemplate(JSON.stringify({ format: 'uuda-template', version: 1, tracks: [] }));
    expect(noTracks.ok).toBe(false);
  });

  it('refuses a newer version politely and a missing version', () => {
    const base = templateFromProject(sample(), { name: 'Show' });
    const newer = parseTemplate({ ...base, version: TEMPLATE_VERSION + 1 });
    expect(newer.ok).toBe(false);
    if (!newer.ok) expect(newer.error).toContain('newer version');
    expect(parseTemplate({ ...base, version: undefined }).ok).toBe(false);
  });

  it('limits and cleans odd values instead of trusting them', () => {
    const r = parseTemplate({
      format: 'uuda-template', version: 1, name: '  Big\u0000name  ', tags: ['ok', 5, 'x'.repeat(100)],
      builtIn: true,
      tracks: [
        { name: 'T', volume: 99, pan: -9, role: 'nonsense', ducking: { enabled: true, sourceTrackIndexes: [0, 1, 1, 'a', 50], thresholdDb: -999, amountDb: 40 },
          plugins: [{ pluginId: 'p', parameters: { a: 1, b: 'x', c: NaN }, dryWet: 5 }, { nothing: true }] },
        { name: 'U' },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const t = r.template;
      expect(t.name).toBe('Big name');
      expect(t.tags).toEqual(['ok', 'x'.repeat(24)]);
      expect(t.builtIn).toBe(undefined);
      expect(t.tracks[0].volume).toBe(1.5);
      expect(t.tracks[0].pan).toBe(-1);
      expect(t.tracks[0].role).toBe('other');
      expect(t.tracks[0].ducking!.sourceTrackIndexes).toEqual([1]); // not itself, not duplicates, not out of range
      expect(t.tracks[0].ducking!.thresholdDb).toBe(-70);
      expect(t.tracks[0].ducking!.amountDb).toBe(0);
      expect(t.tracks[0].plugins!.length).toBe(1);
      expect(t.tracks[0].plugins![0].parameters).toEqual({ a: 1 });
      expect(t.tracks[0].plugins![0].dryWet).toBe(1);
    }
  });

  it('caps the number of tracks', () => {
    const tracks = Array.from({ length: MAX_TEMPLATE_TRACKS + 1 }, (_, i) => ({ name: 'T' + i }));
    expect(parseTemplate({ format: 'uuda-template', version: 1, tracks }).ok).toBe(false);
  });

  it('never keeps a module URL from a file (a template cannot point the app at code)', () => {
    const r = parseTemplate({
      format: 'uuda-template', version: 1,
      tracks: [{ name: 'T', plugins: [{ pluginId: 'x', moduleUrl: 'https://evil.example/p.js', parameters: {} }] }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect('moduleUrl' in r.template.tracks[0].plugins![0]).toBe(false);
  });

  it('serializing leaves out the builtIn flag and names files safely', () => {
    const t: UudaTemplate = { ...BUILT_IN_TEMPLATES[0] };
    expect(serializeTemplate(t)).not.toContain('builtIn');
    expect(templateFileName({ ...t, name: 'My / show: v2' })).toBe('My_show_v2.uuda-template.json');
    expect(templateFileName({ ...t, name: '***' })).toBe('template.uuda-template.json');
  });
});

describe('built-in starters', () => {
  it('there are three, all valid, with unique ids', () => {
    expect(BUILT_IN_TEMPLATES.map((t) => t.name)).toEqual(['Podcast interview', '30-second spot', 'Station sweep']);
    expect(new Set(BUILT_IN_TEMPLATES.map((t) => t.id)).size).toBe(3);
    for (const t of BUILT_IN_TEMPLATES) {
      const r = parseTemplate(serializeTemplate(t));
      expect(r.ok).toBe(true);
    }
  });

  it('every plugin they use exists, and its settings are inside the plugin ranges', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      for (const tr of t.tracks) {
        for (const p of tr.plugins || []) {
          const d = findPluginDescriptor(p.pluginId)!;
          expect(!!d).toBe(true);
          for (const [k, v] of Object.entries(p.parameters)) {
            const def = d.parameters[k];
            expect(!!def, `${p.pluginId}.${k} is a real parameter`).toBe(true);
            expect(v >= def.min && v <= def.max, `${p.pluginId}.${k}=${v} within ${def.min}..${def.max}`).toBe(true);
          }
        }
      }
    }
  });

  it('music beds duck under the voice tracks and nothing ducks under itself', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      const p = projectFromTemplate(t);
      const music = p.tracks.find((x) => x.name === 'Music bed')!;
      const voices = t.tracks.map((x, i) => (x.role === 'voice' ? p.tracks[i].id : null)).filter(Boolean);
      expect(music.ducking!.enabled).toBe(true);
      expect(music.ducking!.sourceTrackIds).toEqual(voices);
      for (const tr of p.tracks) expect((tr.ducking?.sourceTrackIds || []).includes(tr.id)).toBe(false);
    }
  });
});
