import { describe, it, expect, beforeEach } from 'vitest';
import { AudioEngine } from './engine';
import { MASTER_TRACK_ID } from '../plugins/pluginManager';
import { makeContext, makeNode } from '../test/fakeAudioContext';
import type { Project, Track, Clip } from '../types';

(globalThis as any).requestAnimationFrame = () => 1;
(globalThis as any).cancelAnimationFrame = () => undefined;

function clip(id: string, trackId: string, start: number, dur: number): Clip {
  return {
    id, trackId, assetId: 'a-' + id, name: id, startSeconds: start, offsetSeconds: 0, durationSeconds: dur,
    gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'linear',
  };
}
function track(id: string, clips: Clip[], over: Partial<Track> = {}): Track {
  return { id, name: id, clips, volume: 0.8, pan: 0, muted: false, solo: false, ...over };
}

let engine: any;
let project: Project;
const gainOf = (id: string) => engine.trackNodes.get(id).gainNode.gain.value;

beforeEach(() => {
  engine = new AudioEngine();
  engine.ctx = makeContext();
  engine.masterGain = makeNode();
  const a = track('A', [clip('c1', 'A', 2, 10)]);
  const b = track('B', [clip('c2', 'B', 5, 4)], { muted: true });
  const empty = track('E', []);
  project = { id: 'p', name: 'p', tracks: [a, b, empty], sampleRate: 48000, settings: {} as any };
  for (const c of [...a.clips, ...b.clips]) {
    engine.registerAsset({ id: c.assetId, name: c.id, kind: 'import', buffer: { duration: 60 } as any, sampleRate: 48000, durationSeconds: 60, numberOfChannels: 1 });
  }
  engine.syncTracks(project.tracks);
});

describe('rack preview', () => {
  it('refuses a track with no audio and leaves the transport alone', async () => {
    const r = await engine.startPreview(project, 'E');
    expect(r.ok).toBe(false);
    expect(engine.getPreviewTarget()).toBe(null);
    expect(engine.getIsPlaying()).toBe(false);
  });

  it('plays only the target, even a muted one, and does not move the playhead', async () => {
    engine.playheadSeconds = 1.5;
    const r = await engine.startPreview(project, 'B');
    expect(r.ok).toBe(true);
    expect(engine.getPreviewTarget()).toBe('B');
    expect(gainOf('B')).toBeCloseTo(0.8);
    expect(gainOf('A')).toBe(0);
    expect(engine.previewRange).toEqual({ start: 5, end: 9 });
    engine.stopPreview();
    expect(engine.getPreviewTarget()).toBe(null);
    expect(engine.getIsPlaying()).toBe(false);
    expect(engine.playheadSeconds).toBe(1.5);
    // faders back to normal: A audible, B still muted
    expect(gainOf('A')).toBeCloseTo(0.8);
    expect(gainOf('B')).toBe(0);
  });

  it('master target plays the whole mix and loops at most 20 seconds', async () => {
    const r = await engine.startPreview(project, MASTER_TRACK_ID);
    expect(r.ok).toBe(true);
    expect(gainOf('A')).toBeCloseTo(0.8);
    expect(engine.previewRange.start).toBe(2);
    expect(engine.previewRange.end).toBe(12);
    engine.stopPreview();
  });

  it('starts at the playhead when it sits inside the audio, and a long clip is capped', async () => {
    project.tracks[0].clips[0].durationSeconds = 100;
    engine.playheadSeconds = 30;
    await engine.startPreview(project, 'A');
    expect(engine.previewRange).toEqual({ start: 30, end: 50 });
    engine.stopPreview();
  });

  it('the main transport stopping or playing ends the preview', async () => {
    await engine.startPreview(project, 'A');
    engine.stop();
    expect(engine.getPreviewTarget()).toBe(null);
    await engine.startPreview(project, 'A');
    await engine.play(project, 0);
    expect(engine.getPreviewTarget()).toBe(null);
    expect(engine.getIsPlaying()).toBe(true);
    engine.stop();
  });
});

describe('seeking while playing', () => {
  it('never reports position 0 on the way to the new position, going forward or back', async () => {
    const seen: number[] = [];
    engine.setOnTimeUpdate((t: number) => seen.push(t));
    await engine.play(project, 3);
    seen.length = 0;
    engine.seek(8, project);
    await new Promise((r) => setTimeout(r, 20));
    engine.seek(2.5, project);
    await new Promise((r) => setTimeout(r, 20));
    expect(seen.includes(0)).toBe(false);
    expect(seen[0]).toBe(8);
    expect(engine.getIsPlaying()).toBe(true);
    expect(engine.playheadSeconds).toBeCloseTo(2.5, 1);
    engine.stop();
  });
});

