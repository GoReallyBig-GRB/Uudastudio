/**
 * Temporary per-clip levels for mastering and exporting a group.
 *
 * While a group is being mastered, each of its clips can be turned up or down (in dB) without touching the project: the levels
 * live only in the app's memory, are heard while auditioning, are applied to the export, and are dropped when the group is
 * released, the console closes or the export ends. Nothing here is saved, so the group's own mix in the project is never
 * disturbed. Pure functions, so the rules can be unit-tested without a browser.
 */
import type { Project } from '../types';

/** dB offset per clip id. A clip missing from the map is at 0 dB. */
export type TempClipLevels = Record<string, number>;

export const TEMP_LEVEL_MIN_DB = -24;
export const TEMP_LEVEL_MAX_DB = 12;

export const dbToFactor = (db: number): number => Math.pow(10, db / 20);

const clampDb = (db: number): number => (Number.isFinite(db) ? Math.min(TEMP_LEVEL_MAX_DB, Math.max(TEMP_LEVEL_MIN_DB, db)) : 0);

/** Returns new levels with one clip changed; 0 dB removes the entry so "no change" looks the same as "never touched". */
export function setTempLevel(levels: TempClipLevels, clipId: string, db: number): TempClipLevels {
  const next = { ...levels };
  const v = Math.round(clampDb(db) * 2) / 2; // half-dB steps
  if (v === 0) delete next[clipId];
  else next[clipId] = v;
  return next;
}

/** Linear multipliers for the audio engine (clips at 0 dB are left out). */
export function levelFactors(levels: TempClipLevels): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, db] of Object.entries(levels)) if (db !== 0) out[id] = dbToFactor(clampDb(db));
  return out;
}

export const hasTempLevels = (levels: TempClipLevels): boolean => Object.keys(levels).length > 0;

/** A copy of the project with the temporary levels multiplied into the clips' gain (what the export renders). */
export function applyTempLevels(project: Project, levels: TempClipLevels): Project {
  if (!hasTempLevels(levels)) return project;
  const factors = levelFactors(levels);
  return {
    ...project,
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => (factors[c.id] !== undefined ? { ...c, gain: (c.gain ?? 1) * factors[c.id] } : c)),
    })),
  };
}

/** Drops levels of clips that no longer exist. */
export function pruneTempLevels(levels: TempClipLevels, validIds: ReadonlySet<string>): TempClipLevels {
  const out: TempClipLevels = {};
  for (const [id, db] of Object.entries(levels)) if (validIds.has(id)) out[id] = db;
  return out;
}
