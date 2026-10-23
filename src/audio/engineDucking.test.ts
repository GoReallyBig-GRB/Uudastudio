import { describe, it, expect, beforeEach } from 'vitest';
import { AudioEngine } from './engine';
import { DEFAULT_DUCKING } from './ducking';
import { makeContext, makeNode } from '../test/fakeAudioContext';
import type { Project, Track, Clip } from '../types';

(globalThis as any).requestAnimationFrame = () => 1;
(globalThis as any).cancelAnimationFrame = () => undefined;

const SR = 8000;
const clip = (id: string, trackId: string, assetId: string, start: number, dur: number): Clip => ({
  id, trackId, assetId, name: id, startSeconds: start, offsetSeconds: 0, durationSeconds: dur,
  gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'linear',
});

let engine: any;
let project: Project;
let curveCalls: number;
let setCalls: Array<[number, number]>;

beforeEach(() => {
  engine = new AudioEngine();
  engine.ctx = makeContext();
  engine.masterGain = makeNode();
  const voice: Track = { id: 'v', name: 'V', clips: [clip('c1', 'v', 'voice', 1, 2)], volume: 1, pan: 0, muted: false, solo: false };
  const music: Track = {
    id: 'm', name: 'M', clips: [clip('c2', 'm', 'music', 0, 5)], volume: 1, pan: 0, muted: false, solo: false,
    ducking: { ...DEFAULT_DUCKING, enabled: true, sourceTrackIds: ['v'], thresholdDb: -30 },
  };
  project = { id: 'p', name: 'p', tracks: [voice, music], sampleRate: SR, settings: {} as any };
  const loud = new Float32Array(2 * SR).fill(0.5);
  const buf = (ch: Float32Array) => ({ duration: ch.length / SR, numberOfChannels: 1, sampleRate: SR, length: ch.length, getChannelData: () => ch });
  engine.registerAsset({ id: 'voice', name: 'voice', kind: 'import', buffer: buf(loud) as any, sampleRate: SR, durationSeconds: 2, numberOfChannels: 1 });
  engine.registerAsset({ id: 'music', name: 'music', kind: 'import', buffer: buf(new Float32Array(5 * SR).fill(0.2)) as any, sampleRate: SR, durationSeconds: 5, numberOfChannels: 1 });
  engine.syncTracks(project.tracks);
  curveCalls = 0;
  setCalls = [];
  const g = engine.trackNodes.get('m').duckNode.gain;
  g.setValueCurveAtTime = () => { curveCalls++; return g; };
  const origSet = g.setValueAtTime;
  g.setValueAtTime = (v: number, t: number) => { setCalls.push([v, t]); return origSet(v, t); };
});

describe('engine ducking', () => {
  it('schedules a duck curve on the music track when playing', async () => {
    await engine.play(project, 0);
    expect(curveCalls).toBe(1);
    engine.stop();
  });

  it('puts the duck back to unity on stop', async () => {
    await engine.play(project, 0);
    setCalls.length = 0;
    engine.stop();
    expect(setCalls.some(([v]) => v === 1)).toBe(true);
  });

  it('does nothing for a track with ducking switched off', async () => {
    project.tracks[1].ducking = { ...DEFAULT_DUCKING, enabled: false };
    await engine.play(project, 0);
    expect(curveCalls).toBe(0);
    engine.stop();
  });

  it('a live refresh reschedules only when something the curve depends on changed', async () => {
    await engine.play(project, 0);
    expect(curveCalls).toBe(1);
    engine.refreshDucking(project); // nothing changed
    expect(curveCalls).toBe(1);
    const next = JSON.parse(JSON.stringify(project));
    next.tracks[1].ducking.amountDb = -20;
    engine.refreshDucking(next);
    expect(curveCalls).toBe(2);
    engine.stop();
  });

  it('the voice track itself is never ducked', async () => {
    const vGain = engine.trackNodes.get('v').duckNode.gain;
    let vc = 0;
    vGain.setValueCurveAtTime = () => { vc++; return vGain; };
    await engine.play(project, 0);
    expect(vc).toBe(0);
    engine.stop();
  });
});
