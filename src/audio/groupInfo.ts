/**
 * What the UI shows about clip groups: a calm colour per group, a name, how many clips it holds and how long it spans.
 * Pure functions over the project, so they are easy to test. Colours and names are given when the group is created
 * (stored in Project.groupSettings) so they stay put when other groups come and go.
 */
import type { Project } from '../types';

export interface GroupColor {
  /** Swatch and clip border */
  border: string;
  /** Clip body: a dark base with a hint of the hue */
  fill: string;
  /** Waveform */
  wave: string;
}

/**
 * Six muted hues at the same lightness and softness, so groups are easy to tell apart without any one of them shouting.
 * Gold (brand) and cyan (interactive accent) are left out on purpose.
 */
export const GROUP_PALETTE: readonly GroupColor[] = [
  { border: '#5fb3a6', fill: 'rgba(26, 44, 44, 0.92)', wave: '#7fd1c4' }, // teal
  { border: '#9b8bd9', fill: 'rgba(36, 32, 52, 0.92)', wave: '#b7a9ee' }, // violet
  { border: '#d68a9c', fill: 'rgba(48, 30, 36, 0.92)', wave: '#efa9ba' }, // rose
  { border: '#a9bb6c', fill: 'rgba(38, 44, 26, 0.92)', wave: '#c4d68a' }, // olive
  { border: '#dba26a', fill: 'rgba(48, 38, 26, 0.92)', wave: '#f0bd88' }, // apricot
  { border: '#6f9fe0', fill: 'rgba(26, 36, 52, 0.92)', wave: '#92bbf2' }, // blue
];

export interface GroupSummary {
  id: string;
  name: string;
  /** Palette index, or -1 for a colour the user picked */
  colorIndex: number;
  color: GroupColor;
  /** Creation number (list order) */
  order: number | undefined;
  clipCount: number;
  trackCount: number;
  /** Where the first clip starts and the last clip ends */
  startSeconds: number;
  endSeconds: number;
  /** Time span from the first clip's start to the last clip's end (not the sum of clip lengths) */
  durationSeconds: number;
  clipIds: string[];
}

export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const toHex = (n: number): string => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** "#rrggbb" plus an alpha as an rgba() string (used for glows and tints). */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(isHexColor(hex) ? hex : '#00f0ff');
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Clip colours from any colour the user picked: the border is the colour itself, the body is a dark base with a hint of it,
 * and the waveform is a lighter tint, so a custom colour sits in the interface the way the built-in ones do.
 */
export function colorFromHex(hex: string): GroupColor {
  const safe = isHexColor(hex) ? hex : '#5fb3a6';
  const rgb = hexToRgb(safe);
  const [fr, fg, fb] = mix([20, 20, 24], rgb, 0.17);
  const [wr, wg, wb] = mix(rgb, [255, 255, 255], 0.28);
  return { border: safe.toLowerCase(), fill: `rgba(${Math.round(fr)}, ${Math.round(fg)}, ${Math.round(fb)}, 0.92)`, wave: `#${toHex(wr)}${toHex(wg)}${toHex(wb)}` };
}

function hashIndex(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % GROUP_PALETTE.length;
}

/** Palette index of a group; -1 when the user picked a colour of their own. */
export function groupColorIndex(project: Pick<Project, 'groupSettings'>, groupId: string): number {
  const c = project.groupSettings?.[groupId]?.color;
  if (isHexColor(c)) return -1;
  return typeof c === 'number' && c >= 0 && c < GROUP_PALETTE.length ? Math.floor(c) : hashIndex(groupId);
}

export function groupColor(project: Pick<Project, 'groupSettings'>, groupId: string): GroupColor {
  const c = project.groupSettings?.[groupId]?.color;
  if (isHexColor(c)) return colorFromHex(c);
  return GROUP_PALETTE[groupColorIndex(project, groupId)];
}

export function groupIdsInProject(project: Pick<Project, 'tracks'>): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const t of project.tracks) for (const c of t.clips) if (c.groupId && !seen.has(c.groupId)) { seen.add(c.groupId); ids.push(c.groupId); }
  return ids;
}

/** The palette entry used by the fewest existing groups (the first unused one while there is one). */
export function nextGroupColorIndex(project: Pick<Project, 'tracks' | 'groupSettings'>): number {
  const counts = new Array<number>(GROUP_PALETTE.length).fill(0);
  for (const id of groupIdsInProject(project)) {
    const i = groupColorIndex(project, id);
    if (i >= 0) counts[i]++;
  }
  let best = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i] < counts[best]) best = i;
  return best;
}

/** Creation number of the next group: one more than the highest in use (renamed groups keep their number in `order`). */
export function nextGroupNumber(project: Pick<Project, 'tracks' | 'groupSettings'>): number {
  let max = 0;
  for (const id of groupIdsInProject(project)) {
    const st = project.groupSettings?.[id];
    if (typeof st?.order === 'number') { max = Math.max(max, st.order); continue; }
    const m = /^Group (\d+)$/.exec(st?.name ?? '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

/** "Group 1", "Group 2", ... */
export function nextGroupName(project: Pick<Project, 'tracks' | 'groupSettings'>): string {
  return `Group ${nextGroupNumber(project)}`;
}

/** One entry per group that still has clips, in the order the groups were created (by name number, then first start). */
export function summarizeGroups(project: Pick<Project, 'tracks' | 'groupSettings'>): GroupSummary[] {
  const map = new Map<string, { clipIds: string[]; tracks: Set<string>; start: number; end: number }>();
  for (const t of project.tracks) {
    for (const c of t.clips) {
      if (!c.groupId) continue;
      let g = map.get(c.groupId);
      if (!g) { g = { clipIds: [], tracks: new Set(), start: Infinity, end: -Infinity }; map.set(c.groupId, g); }
      g.clipIds.push(c.id);
      g.tracks.add(t.id);
      g.start = Math.min(g.start, c.startSeconds);
      g.end = Math.max(g.end, c.startSeconds + c.durationSeconds);
    }
  }
  const out: GroupSummary[] = [];
  for (const [id, g] of map) {
    const colorIndex = groupColorIndex(project, id);
    const color = groupColor(project, id);
    out.push({
      id,
      name: project.groupSettings?.[id]?.name ?? 'Group',
      colorIndex,
      color,
      order: project.groupSettings?.[id]?.order,
      clipCount: g.clipIds.length,
      trackCount: g.tracks.size,
      startSeconds: g.start,
      endSeconds: g.end,
      durationSeconds: Math.max(0, g.end - g.start),
      clipIds: g.clipIds,
    });
  }
  const num = (s: GroupSummary) => {
    if (typeof s.order === 'number') return s.order;
    const m = /^Group (\d+)$/.exec(s.name);
    return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
  };
  return out.sort((a, b) => num(a) - num(b) || a.startSeconds - b.startSeconds);
}

/** "12.4s", "1:05.2", "12:03": short, for list rows. */
export function formatGroupSpan(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0.0s';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return m < 10 ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${m}:${String(Math.floor(s)).padStart(2, '0')}`;
}
