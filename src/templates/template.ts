/**
 * Uuda Studio - project templates.
 *
 * A template is the structure of a project with no audio in it: track names and order, volumes, plugin chains with
 * their settings, auto-duck settings, and a few labels. "New from template" turns it into an empty project ready
 * to record into. It travels as a small JSON file (.uuda-template.json) with a version number, so older files keep
 * opening as the format grows.
 *
 * Everything here is plain data in, plain data out: no audio, no browser APIs.
 */

import { DuckingSettings, Project, Track } from '../types';
import { StoredPluginState } from '../plugins/types';
import { normalizeDucking } from '../audio/ducking';

export const TEMPLATE_FORMAT = 'uuda-template';
export const TEMPLATE_VERSION = 1;
export const TEMPLATE_FILE_SUFFIX = '.uuda-template.json';
export const MAX_TEMPLATE_TRACKS = 64;
export const MAX_PLUGINS_PER_CHAIN = 32;

export type TrackRole = 'voice' | 'music' | 'sfx' | 'other';
const ROLES: TrackRole[] = ['voice', 'music', 'sfx', 'other'];

/** Auto-duck settings with the source tracks named by position, since track ids are made fresh for each new project */
export type TemplateDucking = Omit<DuckingSettings, 'sourceTrackIds'> & { sourceTrackIndexes: number[] };

export interface TemplateTrack {
  name: string;
  /** True when the user typed this name (it stays put); otherwise it follows the track's position */
  customName?: boolean;
  /** What the track is for: shown in the list, and a hint for where audio should go */
  role: TrackRole;
  volume: number;
  pan: number;
  plugins?: StoredPluginState[];
  ducking?: TemplateDucking;
}

export interface UudaTemplate {
  format: typeof TEMPLATE_FORMAT;
  version: number;
  id: string;
  name: string;
  description: string;
  tags: string[];
  /** Built-in starters cannot be deleted or overwritten */
  builtIn?: boolean;
  tracks: TemplateTrack[];
  masterPlugins?: StoredPluginState[];
  createdAt: number;
}

// ---------------------------------------------------------------------------------------------------------------------
// Making a template from a project
// ---------------------------------------------------------------------------------------------------------------------

/** Best guess at a track's role from its name; the user can change it later by saving again */
export function guessRole(name: string): TrackRole {
  const n = name.toLowerCase();
  if (/(voice|host|guest|narrat|vo\b|talent|speaker|presenter|announcer)/.test(n)) return 'voice';
  if (/(music|bed|song|jingle|score)/.test(n)) return 'music';
  if (/(sfx|effect|fx|sound|foley|stinger|sweep)/.test(n)) return 'sfx';
  return 'other';
}

function cleanText(v: unknown, max: number, fallback = ''): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : fallback;
}

function num(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(hi, Math.max(lo, n));
}

function cleanPlugins(list: unknown): StoredPluginState[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const out: StoredPluginState[] = [];
  for (const raw of list.slice(0, MAX_PLUGINS_PER_CHAIN)) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, unknown>;
    const pluginId = cleanText(p.pluginId, 120);
    if (!pluginId) continue;
    const parameters: Record<string, number> = {};
    if (p.parameters && typeof p.parameters === 'object') {
      for (const [k, v] of Object.entries(p.parameters as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v) && k.length <= 60) parameters[k] = v;
      }
    }
    const stored: StoredPluginState = {
      instanceId: cleanText(p.instanceId, 80) || `tpl-${out.length}`,
      pluginId,
      isBypassed: !!p.isBypassed,
      dryWet: num(p.dryWet, 0, 1, 1),
      parameters,
      customState: { ...parameters },
    };
    // A template never carries code locations of its own: a web plugin is found again by its id in the catalogue.
    out.push(stored);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * `project` should already carry its plugin chains (use withPluginStates). Clips and audio are left out.
 */
export function templateFromProject(
  project: Project,
  meta: { name: string; description?: string; tags?: string[] },
  now: number = Date.now(),
): UudaTemplate {
  const indexById = new Map(project.tracks.map((t, i) => [t.id, i] as const));
  const tracks: TemplateTrack[] = project.tracks.slice(0, MAX_TEMPLATE_TRACKS).map((t) => {
    const out: TemplateTrack = {
      name: cleanText(t.name, 60, 'Track') || 'Track',
      role: guessRole(t.name || ''),
      volume: num(t.volume, 0, 1.5, 1),
      pan: num(t.pan, -1, 1, 0),
    };
    if (t.customName) out.customName = true;
    const plugins = cleanPlugins(t.plugins);
    if (plugins) out.plugins = plugins;
    if (t.ducking && t.ducking.enabled) {
      const d = normalizeDucking(t.ducking);
      const sourceTrackIndexes = d.sourceTrackIds
        .map((id) => indexById.get(id))
        .filter((i): i is number => typeof i === 'number' && i < MAX_TEMPLATE_TRACKS);
      const { sourceTrackIds: _drop, ...rest } = d;
      out.ducking = { ...rest, sourceTrackIndexes };
    }
    return out;
  });
  const template: UudaTemplate = {
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    id: `tpl-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: cleanText(meta.name, 80, 'Untitled template') || 'Untitled template',
    description: cleanText(meta.description, 300),
    tags: (meta.tags || []).map((t) => cleanText(t, 24)).filter(Boolean).slice(0, 8),
    tracks,
    createdAt: now,
  };
  const master = cleanPlugins(project.masterPlugins);
  if (master) template.masterPlugins = master;
  return template;
}

// ---------------------------------------------------------------------------------------------------------------------
// Making a project from a template
// ---------------------------------------------------------------------------------------------------------------------

export function projectFromTemplate(
  template: UudaTemplate,
  opts: { name?: string; makeId?: () => string; now?: number } = {},
): Project {
  const now = opts.now ?? Date.now();
  let counter = 0;
  const makeId = opts.makeId ?? (() => `track-${now.toString(36)}-${(counter++).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`);
  const ids = template.tracks.map(() => makeId());

  const tracks: Track[] = template.tracks.map((t, i) => {
    const track: Track = {
      id: ids[i],
      name: t.name,
      clips: [],
      volume: t.volume,
      pan: t.pan,
      muted: false,
      solo: false,
    };
    if (t.customName) track.customName = true;
    if (t.plugins && t.plugins.length > 0) track.plugins = t.plugins.map((p) => ({ ...p, parameters: { ...p.parameters } }));
    if (t.ducking) {
      const { sourceTrackIndexes, ...rest } = t.ducking;
      const sources = sourceTrackIndexes.filter((idx) => idx !== i && idx >= 0 && idx < ids.length).map((idx) => ids[idx]);
      track.ducking = normalizeDucking({ ...rest, sourceTrackIds: sources });
    }
    return track;
  });

  const project: Project = {
    id: `project-${now}`,
    name: opts.name || template.name,
    tracks,
    sampleRate: 48000,
    settings: { autoRefresh: true, sampleRate: 48000, duckPlayingTracks: true, duckingAmountDb: -12 },
    updatedAt: now,
  };
  if (template.masterPlugins && template.masterPlugins.length > 0) {
    project.masterPlugins = template.masterPlugins.map((p) => ({ ...p, parameters: { ...p.parameters } }));
  }
  return project;
}

// ---------------------------------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------------------------------

export type ParseResult = { ok: true; template: UudaTemplate } | { ok: false; error: string };

/** Older versions are brought up to the current one here. Version 1 is the first, so there is nothing to convert yet. */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

/**
 * Reads a template from text or an object, checking every field. Anything unexpected is dropped or limited, so a
 * damaged or hand-edited file cannot put odd values into a project.
 */
export function parseTemplate(input: unknown): ParseResult {
  let raw: unknown = input;
  if (typeof input === 'string') {
    if (input.length > 2_000_000) return { ok: false, error: 'That file is too large to be a template.' };
    try {
      raw = JSON.parse(input);
    } catch {
      return { ok: false, error: 'That file is not valid JSON.' };
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'That file is not a Uuda template.' };
  let r = raw as Record<string, unknown>;
  if (r.format !== TEMPLATE_FORMAT) return { ok: false, error: 'That file is not a Uuda template.' };

  const version = typeof r.version === 'number' && Number.isInteger(r.version) ? r.version : NaN;
  if (!Number.isFinite(version) || version < 1) return { ok: false, error: 'This template has no valid version number.' };
  if (version > TEMPLATE_VERSION) {
    return { ok: false, error: 'This template was made by a newer version of Uuda Studio. Update the app to open it.' };
  }
  for (let v = version; v < TEMPLATE_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (step) r = step(r);
  }

  if (!Array.isArray(r.tracks)) return { ok: false, error: 'This template has no tracks.' };
  if (r.tracks.length === 0) return { ok: false, error: 'This template has no tracks.' };
  if (r.tracks.length > MAX_TEMPLATE_TRACKS) return { ok: false, error: `Templates are limited to ${MAX_TEMPLATE_TRACKS} tracks.` };

  const count = r.tracks.length;
  const tracks: TemplateTrack[] = r.tracks.map((rawTrack, i) => {
    const t = (rawTrack && typeof rawTrack === 'object' ? rawTrack : {}) as Record<string, unknown>;
    const name = cleanText(t.name, 60) || `Track ${i + 1}`;
    const role = ROLES.includes(t.role as TrackRole) ? (t.role as TrackRole) : guessRole(name);
    const track: TemplateTrack = {
      name,
      role,
      volume: num(t.volume, 0, 1.5, 1),
      pan: num(t.pan, -1, 1, 0),
    };
    if (t.customName) track.customName = true;
    const plugins = cleanPlugins(t.plugins);
    if (plugins) track.plugins = plugins;
    if (t.ducking && typeof t.ducking === 'object') {
      const d = t.ducking as Record<string, unknown>;
      const idx = Array.isArray(d.sourceTrackIndexes) ? d.sourceTrackIndexes : [];
      const sourceTrackIndexes = Array.from(
        new Set(idx.filter((x): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) < count && x !== i)),
      );
      const norm = normalizeDucking({ ...(d as Partial<DuckingSettings>), sourceTrackIds: [] });
      const { sourceTrackIds: _drop, ...rest } = norm;
      track.ducking = { ...rest, sourceTrackIndexes };
    }
    return track;
  });

  const template: UudaTemplate = {
    format: TEMPLATE_FORMAT,
    version: TEMPLATE_VERSION,
    id: cleanText(r.id, 80) || `tpl-${Date.now().toString(36)}`,
    name: cleanText(r.name, 80) || 'Untitled template',
    description: cleanText(r.description, 300),
    tags: Array.isArray(r.tags) ? r.tags.map((x) => cleanText(x, 24)).filter(Boolean).slice(0, 8) : [],
    tracks,
    createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : Date.now(),
  };
  const master = cleanPlugins(r.masterPlugins);
  if (master) template.masterPlugins = master;
  // builtIn is never taken from a file: only the app's own starters are built in
  return { ok: true, template };
}

export function serializeTemplate(template: UudaTemplate): string {
  const { builtIn: _b, ...file } = template;
  return JSON.stringify(file, null, 2);
}

export function templateFileName(template: UudaTemplate): string {
  const base = template.name.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'template';
  return `${base}${TEMPLATE_FILE_SUFFIX}`;
}
