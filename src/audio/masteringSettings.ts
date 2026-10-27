/**
 * Mastering settings: the presets, the editable parameters, and the saved state that goes with a project.
 * Pure data and helpers (no audio nodes), so the live engine, the export pipeline and the panels can all share it.
 *
 * Mastering works like a plugin on the master bus: it is either active or not, it has a preset plus manual
 * adjustments, and the same settings drive what you hear and what you export.
 */
import type { Project } from '../types';

export type MasteringProfileType = 'podcast' | 'broadcast' | 'music' | 'custom' | 'bypass';
export type BroadcastPreset = 'ebu_r128' | 'atsc_a85' | 'hot_commercial';

export interface MasteringProfileConfig {
  type: MasteringProfileType;
  name: string;
  description: string;
  targetLufs: number;
  ceilingDbTP: number;
  compressionRatio: number;
  attackMs: number;
  releaseMs: number;
  midPresenceGainDb: number;
  midPresenceFreqHz: number;
  broadcastPreset?: BroadcastPreset;
}

export const BROADCAST_PRESETS: Record<BroadcastPreset, { label: string; targetLufs: number; standard: string }> = {
  ebu_r128: {
    label: 'EBU R128 (-23 LUFS)',
    targetLufs: -23.0,
    standard: 'European Broadcast Standard (EBU R128, -23 LUFS, -1 dBTP ceiling)',
  },
  atsc_a85: {
    label: 'ATSC A/85 (-24 LKFS)',
    targetLufs: -24.0,
    standard: 'North American Television / Radio Standard (ATSC A/85, -24 LKFS / LUFS, -1 dBTP ceiling)',
  },
  hot_commercial: {
    label: 'Commercial Spot Hot (-14 LUFS)',
    targetLufs: -14.0,
    standard: 'High-Impact Radio Imaging & Commercial Promos (-14 LUFS, -1 dBTP ceiling)',
  },
};

export const MASTERING_PROFILES: Record<MasteringProfileType, MasteringProfileConfig> = {
  podcast: {
    type: 'podcast',
    name: 'Podcast Voice Master',
    description: 'Level voices consistently, warm broadcast compression, target -16.0 LUFS with -1.0 dBTP ceiling.',
    targetLufs: -16.0,
    ceilingDbTP: -1.0,
    compressionRatio: 2.5,
    attackMs: 20,
    releaseMs: 120,
    midPresenceGainDb: 1.0,
    midPresenceFreqHz: 3000,
  },
  broadcast: {
    type: 'broadcast',
    name: 'Broadcast / Radio Stinger',
    description: '4:1 aggressive compression, 5ms attack, +3 dB mid presence boost; configurable loudness (EBU R128 -23 LUFS / ATSC A/85 -24 LKFS).',
    targetLufs: -23.0,
    ceilingDbTP: -1.0,
    compressionRatio: 4.0,
    attackMs: 5,
    releaseMs: 60,
    midPresenceGainDb: 3.0,
    midPresenceFreqHz: 2500,
    broadcastPreset: 'ebu_r128',
  },
  music: {
    type: 'music',
    name: 'Music Bed / Wide Stereo',
    description: 'Preserve stereo width and bass dynamics, transparent true-peak limiter, target -14.0 LUFS with -1.0 dBTP ceiling.',
    targetLufs: -14.0,
    ceilingDbTP: -1.0,
    compressionRatio: 1.8,
    attackMs: 30,
    releaseMs: 200,
    midPresenceGainDb: 0.0,
    midPresenceFreqHz: 2500,
  },
  custom: {
    type: 'custom',
    name: 'Custom Loudness Profile',
    description: 'Full manual control over target LUFS, true peak ceiling, compressor ratio, attack, release and presence EQ.',
    targetLufs: -16.0,
    ceilingDbTP: -1.0,
    compressionRatio: 3.0,
    attackMs: 10,
    releaseMs: 100,
    midPresenceGainDb: 1.5,
    midPresenceFreqHz: 2500,
  },
  bypass: {
    type: 'bypass',
    name: 'Raw Mix (Bypass Mastering)',
    description: 'Export direct timeline mixdown without additional mastering DSP or compression.',
    targetLufs: -16.0,
    ceilingDbTP: -0.1,
    compressionRatio: 1.0,
    attackMs: 10,
    releaseMs: 100,
    midPresenceGainDb: 0.0,
    midPresenceFreqHz: 2500,
  },
};


/** What the mastering chain needs: presence EQ, compressor, loudness target, true-peak ceiling. */
export interface ChainSettings {
  type: MasteringProfileType;
  targetLufs: number;
  ceilingDbTP: number;
  midPresenceGainDb: number;
  midPresenceFreqHz: number;
  compressionRatio: number;
  attackMs: number;
  releaseMs: number;
}

/** Result of measuring the project through the chain, so the loudness gain is known without re-measuring. */
export interface MasteringAnalysis {
  /** masteringKey() of the settings it was measured with */
  settingsKey: string;
  /** mixFingerprint() of the project it was measured on */
  mixKey: string;
  /** Gain (dB) that brings the processed mix to the target loudness */
  gainDb: number;
  /** Loudness of the mix before mastering, and after the chain before the gain */
  mixLufs: number;
  processedLufs: number;
  durationSeconds: number;
  measuredAt: number;
}

export interface MasteringSettings extends ChainSettings {
  /** On: heard live and applied on export. Off: the raw mix. */
  active: boolean;
  broadcastPreset?: BroadcastPreset;
  analysis?: MasteringAnalysis | null;
}

/** Fixed parts of the chain, shared by the live engine and the export so they sound the same. */
export const CHAIN_COMPRESSOR_THRESHOLD_DB = -22;
export const CHAIN_COMPRESSOR_KNEE_DB = 8;
export const CHAIN_PRESENCE_Q = 1.5;
/** Limiter timing: 2 ms look-ahead, 50 ms release */
export const CHAIN_LIMITER_LOOKAHEAD_SECONDS = 0.002;
export const CHAIN_LIMITER_RELEASE_SECONDS = 0.05;

export const DEFAULT_PRESET: MasteringProfileType = 'podcast';

export function presetValues(type: MasteringProfileType, broadcastPreset?: BroadcastPreset): ChainSettings & { broadcastPreset?: BroadcastPreset } {
  const p = MASTERING_PROFILES[type];
  const preset = type === 'broadcast' ? (broadcastPreset ?? p.broadcastPreset) : undefined;
  return {
    type,
    targetLufs: preset ? BROADCAST_PRESETS[preset].targetLufs : p.targetLufs,
    ceilingDbTP: p.ceilingDbTP,
    midPresenceGainDb: p.midPresenceGainDb,
    midPresenceFreqHz: p.midPresenceFreqHz,
    compressionRatio: p.compressionRatio,
    attackMs: p.attackMs,
    releaseMs: p.releaseMs,
    ...(preset ? { broadcastPreset: preset } : {}),
  };
}

export function defaultMasteringSettings(): MasteringSettings {
  return { active: false, ...presetValues(DEFAULT_PRESET), analysis: null };
}

/** Same as the stored settings, but with anything missing or out of range made safe (old projects, hand edits). */
export function normalizeMastering(m?: Partial<MasteringSettings> | null): MasteringSettings {
  const d = defaultMasteringSettings();
  if (!m) return d;
  const num = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  const type = (m.type && m.type in MASTERING_PROFILES ? m.type : d.type) as MasteringProfileType;
  return {
    active: !!m.active,
    type,
    broadcastPreset: m.broadcastPreset && m.broadcastPreset in BROADCAST_PRESETS ? m.broadcastPreset : undefined,
    targetLufs: num(m.targetLufs, -40, -5, d.targetLufs),
    ceilingDbTP: num(m.ceilingDbTP, -6, 0, d.ceilingDbTP),
    midPresenceGainDb: num(m.midPresenceGainDb, -6, 6, d.midPresenceGainDb),
    midPresenceFreqHz: num(m.midPresenceFreqHz, 500, 8000, d.midPresenceFreqHz),
    compressionRatio: num(m.compressionRatio, 1, 10, d.compressionRatio),
    attackMs: num(m.attackMs, 1, 100, d.attackMs),
    releaseMs: num(m.releaseMs, 10, 1000, d.releaseMs),
    analysis: m.analysis ?? null,
  };
}

/** Fingerprint of everything that changes the sound (not whether it is active, not the stored analysis). */
export function masteringKey(s: ChainSettings): string {
  return [s.type, s.targetLufs, s.ceilingDbTP, s.midPresenceGainDb, s.midPresenceFreqHz, s.compressionRatio, s.attackMs, s.releaseMs].join('|');
}

export function toChainSettings(s: MasteringSettings): ChainSettings {
  const { type, targetLufs, ceilingDbTP, midPresenceGainDb, midPresenceFreqHz, compressionRatio, attackMs, releaseMs } = s;
  return { type, targetLufs, ceilingDbTP, midPresenceGainDb, midPresenceFreqHz, compressionRatio, attackMs, releaseMs };
}

/**
 * Fingerprint of everything in the project that changes the mix: clips, fades, gain, track level/pan/mute/solo,
 * ducking, effects and the master fader. A saved analysis is only trusted while this still matches.
 */
export function mixFingerprint(project: Project, masterVolume = 1, masterMuted = false): string {
  const parts: Array<string | number> = [project.sampleRate, masterMuted ? 0 : masterVolume, JSON.stringify(project.masterPlugins ?? null)];
  for (const t of project.tracks) {
    parts.push(t.id, t.volume, t.pan, t.muted ? 1 : 0, t.solo ? 1 : 0, JSON.stringify(t.ducking ?? null), JSON.stringify(t.plugins ?? null));
    for (const c of t.clips) {
      parts.push(c.id, c.assetId, c.startSeconds, c.offsetSeconds, c.durationSeconds, c.gain, c.fadeInSeconds, c.fadeOutSeconds, c.muted ? 1 : 0);
    }
  }
  // Small, fast 53-bit string hash (cyrb53): enough to notice edits
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  const str = parts.join('~');
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** True while the stored analysis still describes this project and these settings. */
export function analysisIsCurrent(s: MasteringSettings, mixKey: string): boolean {
  return !!s.analysis && s.analysis.settingsKey === masteringKey(s) && s.analysis.mixKey === mixKey;
}
