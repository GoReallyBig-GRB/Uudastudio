import { describe, it, expect, beforeEach } from 'vitest';
import { AudioEngine } from './engine';
import { makeContext, makeNode } from '../test/fakeAudioContext';
import type { Project, Track, Clip } from '../types';

(globalThis as any).requestAnimationFrame = () => 1;
(globalThis as any).cancelAnimationFrame = () => undefined;

function clip(id: string, trackId: string, start: number, dur: number, groupId?: string): Clip {
  return {
    id, trackId, assetId: 'a-' + id, name: id, startSeconds: start, offsetSeconds: 0, durationSeconds: dur,
    gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'linear', groupId,
  };
}
function track(id: string, clips: Clip[], over: Partial<Track> = {}): Track {
  return { id, name: id, clips, volume: 0.3, pan: 0.7, muted: false, solo: false, ...over };
}

let engine: any;
let project: Project;
let scheduled: Array<{ id: string; dest: unknown }>;

beforeEach(() => {
  engine = new AudioEngine();
  engine.ctx = makeContext();
  engine.masterGain = makeNode();
  // A is muted with a low fader; its grouped clip must still sound and ignore the fader
  const a = track('A', [clip('c1', 'A', 0, 5, 'g1'), clip('loose', 'A', 0, 5)], { muted: true });
  const b = track('B', [clip('c2', 'B', 1, 5, 'g1')]);
  project = { id: 'p', name: 'p', tracks: [a, b], sampleRate: 48000, settings: {} as any, groupSettings: { g1: { volume: 0.5, pan: -0.25, muted: false } } };
  for (const c of [...a.clips, ...b.clips]) {
    engine.registerAsset({ id: c.assetId, name: c.id, kind: 'import', buffer: { duration: 60 } as any, sampleRate: 48000, durationSeconds: 60, numberOfChannels: 1 });
  }
  engine.syncTracks(project.tracks);
  scheduled = [];
  engine.scheduleClip = (c: Clip, dest: unknown) => { scheduled.push({ id: c.id, dest }); };
});

describe('group channel', () => {
  it('sends grouped clips straight to the group bus, whatever their track does', async () => {
    await engine.play(project, 0);
    const bus = engine.groupBuses.get('g1');
    expect(bus).toBeTruthy();
    expect(scheduled.find((s) => s.id === 'c1')?.dest).toBe(bus.input);
    expect(scheduled.find((s) => s.id === 'c2')?.dest).toBe(bus.input);
    // the loose clip still goes through its own (muted) track
    expect(scheduled.find((s) => s.id === 'loose')?.dest).toBe(engine.trackNodes.get('A').gainNode);
    engine.stop();
  });

  it('applies the group level and pan, not the track fader', async () => {
    await engine.play(project, 0);
    const bus = engine.groupBuses.get('g1');
    expect(bus.level.gain.value).toBeCloseTo(0.5);
    expect(bus.pan.pan.value).toBeCloseTo(-0.25);
    engine.stop();
  });

  it('muting the group silences it, and the change applies live', async () => {
    await engine.play(project, 0);
    const bus = engine.groupBuses.get('g1');
    engine.syncGroupSettings({ g1: { volume: 0.5, pan: 0, muted: true } });
    expect(bus.level.gain.value).toBe(0);
    engine.syncGroupSettings({ g1: { volume: 0.9, pan: 0, muted: false } });
    expect(bus.level.gain.value).toBeCloseTo(0.9);
    engine.stop();
  });

  it('solo plays only one group: loose clips and other groups go silent, and it all comes back', async () => {
    const p2 = { ...project, groupSettings: { g1: { volume: 0.5, pan: 0, muted: false }, g2: { volume: 0.8, pan: 0, muted: false } } } as Project;
    p2.tracks = [...p2.tracks, track('C', [clip('c3', 'C', 0, 5, 'g2')])];
    engine.registerAsset({ id: 'a-c3', name: 'c3', kind: 'import', buffer: { duration: 60 } as any, sampleRate: 48000, durationSeconds: 60, numberOfChannels: 1 });
    engine.syncTracks(p2.tracks);
    await engine.play(p2, 0);
    engine.setSoloGroup('g1');
    expect(engine.groupBuses.get('g1').level.gain.value).toBeCloseTo(0.5);
    expect(engine.groupBuses.get('g2').level.gain.value).toBe(0);
    expect(engine.trackNodes.get('B').gainNode.gain.value).toBe(0);
    engine.setSoloGroup(null);
    expect(engine.groupBuses.get('g2').level.gain.value).toBeCloseTo(0.8);
    expect(engine.trackNodes.get('B').gainNode.gain.value).toBeGreaterThan(0);
    engine.stop();
  });

  it('a muted group is still heard while soloed', async () => {
    const p2 = { ...project, groupSettings: { g1: { volume: 0.7, pan: 0, muted: true } } } as Project;
    await engine.play(p2, 0);
    engine.setSoloGroup('g1');
    expect(engine.groupBuses.get('g1').level.gain.value).toBeCloseTo(0.7);
    engine.setSoloGroup(null);
    expect(engine.groupBuses.get('g1').level.gain.value).toBe(0);
    engine.stop();
  });
});
