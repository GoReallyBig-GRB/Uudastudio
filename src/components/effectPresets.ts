/**
 * Uuda Studio - factory presets for the built-in effects in the Effects rack.
 * Each effect has at least four presets that sound clearly different from one another. The tests check every value
 * against the range the effect accepts.
 */
import type { EffectType } from '../types';

export const EFFECT_PRESETS: Record<EffectType, { name: string; params: any }[]> = {
  delay: [
    {
      name: 'Vocal Slapback (120ms)',
      params: { timeMs: 120, feedback: 0.25, lowCutHz: 120, highCutHz: 6500, pingPong: false, dryWet: 0.35 },
    },
    {
      name: 'Stereo Ping-Pong (350ms)',
      params: { timeMs: 350, feedback: 0.55, lowCutHz: 150, highCutHz: 5000, pingPong: true, dryWet: 0.4 },
    },
    {
      name: 'Ambient Dub Echo (500ms)',
      params: { timeMs: 500, feedback: 0.75, lowCutHz: 200, highCutHz: 4000, pingPong: true, dryWet: 0.5 },
    },
    {
      name: 'Tape Echo (240ms)',
      params: { timeMs: 240, feedback: 0.4, lowCutHz: 180, highCutHz: 3800, pingPong: false, dryWet: 0.3 },
    },
    {
      name: 'Subtle Doubler (45ms)',
      params: { timeMs: 45, feedback: 0, lowCutHz: 100, highCutHz: 9000, pingPong: false, dryWet: 0.3 },
    },
  ],
  equalizer: [
    {
      name: 'Vocal Air & Presence',
      params: {
        bands: [
          { id: '1', type: 'highpass', frequency: 80, gainDb: 0, q: 0.707, enabled: true },
          { id: '2', type: 'lowshelf', frequency: 200, gainDb: -2, q: 0.7, enabled: true },
          { id: '3', type: 'peaking', frequency: 1000, gainDb: -1.5, q: 1.2, enabled: true },
          { id: '4', type: 'peaking', frequency: 3200, gainDb: 3.5, q: 1.5, enabled: true },
          { id: '5', type: 'highshelf', frequency: 10000, gainDb: 4.0, q: 0.7, enabled: true },
        ],
        dryWet: 1.0,
      },
    },
    {
      name: 'Warm Broadcast Host',
      params: {
        bands: [
          { id: '1', type: 'highpass', frequency: 65, gainDb: 0, q: 0.707, enabled: true },
          { id: '2', type: 'lowshelf', frequency: 150, gainDb: 2.5, q: 0.8, enabled: true },
          { id: '3', type: 'peaking', frequency: 450, gainDb: -2.0, q: 1.4, enabled: true },
          { id: '4', type: 'peaking', frequency: 2800, gainDb: 2.0, q: 1.2, enabled: true },
          { id: '5', type: 'highshelf', frequency: 8000, gainDb: 1.5, q: 0.7, enabled: true },
        ],
        dryWet: 1.0,
      },
    },
    {
      name: 'Telephone',
      params: {
        bands: [
          { id: '1', type: 'highpass', frequency: 500, gainDb: 0, q: 0.9, enabled: true },
          { id: '2', type: 'peaking', frequency: 900, gainDb: 3, q: 1.2, enabled: true },
          { id: '3', type: 'peaking', frequency: 2200, gainDb: 4, q: 1.4, enabled: true },
          { id: '4', type: 'lowpass', frequency: 3400, gainDb: 0, q: 0.9, enabled: true },
          { id: '5', type: 'highshelf', frequency: 6000, gainDb: -6, q: 0.7, enabled: true },
        ],
        dryWet: 1.0,
      },
    },
    {
      name: 'De-Mud & Tame Boom',
      params: {
        bands: [
          { id: '1', type: 'highpass', frequency: 70, gainDb: 0, q: 0.707, enabled: true },
          { id: '2', type: 'peaking', frequency: 120, gainDb: -3, q: 1.0, enabled: true },
          { id: '3', type: 'peaking', frequency: 280, gainDb: -4.5, q: 1.3, enabled: true },
          { id: '4', type: 'peaking', frequency: 4500, gainDb: 1.5, q: 1.0, enabled: true },
          { id: '5', type: 'highshelf', frequency: 10000, gainDb: 1.0, q: 0.7, enabled: true },
        ],
        dryWet: 1.0,
      },
    },
  ],
  chorus: [
    {
      name: 'Subtle Stereo Thickener',
      params: { voices: 3, rateHz: 1.2, depthMs: 4, stereoSpread: 0.8, feedback: 0.2, dryWet: 0.35 },
    },
    {
      name: 'Lush 80s Dimension',
      params: { voices: 4, rateHz: 2.2, depthMs: 8, stereoSpread: 1.0, feedback: 0.4, dryWet: 0.55 },
    },
    {
      name: 'Classic Vibrato',
      params: { voices: 2, rateHz: 5.5, depthMs: 3, stereoSpread: 0.3, feedback: 0, dryWet: 1.0 },
    },
    {
      name: 'Wide Vocal Double',
      params: { voices: 2, rateHz: 0.5, depthMs: 12, stereoSpread: 1.0, feedback: 0.1, dryWet: 0.4 },
    },
  ],
  flanger: [
    {
      name: 'Jet Sweep Flanger',
      params: { delayMs: 2.5, rateHz: 0.35, depthMs: 2.0, feedback: 0.75, stereoPhaseDeg: 90, dryWet: 0.5 },
    },
    {
      name: 'Deep Resonant Hollow',
      params: { delayMs: 4.0, rateHz: 0.8, depthMs: 3.0, feedback: -0.8, stereoPhaseDeg: 120, dryWet: 0.6 },
    },
    {
      name: 'Tape Flange',
      params: { delayMs: 2.0, rateHz: 0.1, depthMs: 3.0, feedback: 0.55, stereoPhaseDeg: 60, dryWet: 0.5 },
    },
    {
      name: 'Barber-Pole Whoosh',
      params: { delayMs: 1.0, rateHz: 1.6, depthMs: 1.5, feedback: 0.85, stereoPhaseDeg: 180, dryWet: 0.45 },
    },
  ],
  phaser: [
    {
      name: '6-Stage Classic Sweeper',
      params: { stages: 6, rateHz: 0.45, depth: 0.75, centerFreqHz: 1200, feedback: 0.65, stereoOffsetDeg: 90, dryWet: 0.5 },
    },
    {
      name: '10-Stage Cosmic Swirl',
      params: { stages: 10, rateHz: 0.8, depth: 0.9, centerFreqHz: 2000, feedback: 0.8, stereoOffsetDeg: 180, dryWet: 0.65 },
    },
    {
      name: '4-Stage Phase 90',
      params: { stages: 4, rateHz: 0.5, depth: 0.7, centerFreqHz: 800, feedback: 0.3, stereoOffsetDeg: 0, dryWet: 0.5 },
    },
    {
      name: 'Slow Deep Wash',
      params: { stages: 12, rateHz: 0.12, depth: 1.0, centerFreqHz: 600, feedback: 0.8, stereoOffsetDeg: 120, dryWet: 0.6 },
    },
  ],
  reverb: [
    {
      name: 'Studio Vocal Plate',
      params: { type: 'algorithmic', preset: 'plate', preDelayMs: 25, decayTimeSec: 2.2, damping: 0.35, diffusion: 0.8, size: 1.0, lowCutHz: 120, highCutHz: 8000, dryWet: 0.35 },
    },
    {
      name: 'Warm Intimate Room',
      params: { type: 'algorithmic', preset: 'room', preDelayMs: 10, decayTimeSec: 1.2, damping: 0.5, diffusion: 0.7, size: 0.7, lowCutHz: 150, highCutHz: 6500, dryWet: 0.25 },
    },
    {
      name: 'Cathedral Hall (Large)',
      params: { type: 'algorithmic', preset: 'hall', preDelayMs: 40, decayTimeSec: 4.5, damping: 0.25, diffusion: 0.9, size: 1.6, lowCutHz: 100, highCutHz: 7500, dryWet: 0.45 },
    },
    {
      name: 'Tight Vocal Booth',
      params: { type: 'algorithmic', preset: 'room', preDelayMs: 4, decayTimeSec: 0.4, damping: 0.7, diffusion: 0.6, size: 0.3, lowCutHz: 150, highCutHz: 7000, dryWet: 0.18 },
    },
  ],
};
