/**
 * Export of just the selected clips (or groups): only those clips are in the mix, and the file runs from where the
 * first of them starts to where the last one ends, so there is no leading silence and nothing else on the timeline.
 * Pure, so the rules can be unit-tested without a browser.
 */
import type { Project } from '../types';

export interface SelectionScope {
  /** The project with every clip that is not part of the selection removed (tracks and settings are kept). */
  project: Project;
  /** Time span of the selected clips on the timeline, or null when nothing is selected. */
  range: { startSeconds: number; endSeconds: number } | null;
  clipCount: number;
  trackCount: number;
}

/** Clips that belong to the selection: the picked clips plus anything grouped with them. */
export function expandSelection(project: Project, selectedClipIds: ReadonlySet<string>): Set<string> {
  const groups = new Set<string>();
  for (const t of project.tracks) for (const c of t.clips) if (selectedClipIds.has(c.id) && c.groupId) groups.add(c.groupId);
  const out = new Set<string>();
  for (const t of project.tracks) {
    for (const c of t.clips) if (selectedClipIds.has(c.id) || (c.groupId && groups.has(c.groupId))) out.add(c.id);
  }
  return out;
}

export function selectionScope(project: Project, selectedClipIds: ReadonlySet<string>): SelectionScope {
  const ids = expandSelection(project, selectedClipIds);
  let start = Infinity;
  let end = 0;
  let trackCount = 0;
  const tracks = project.tracks.map((t) => {
    const clips = t.clips.filter((c) => ids.has(c.id));
    if (clips.length > 0) trackCount++;
    for (const c of clips) {
      start = Math.min(start, c.startSeconds);
      end = Math.max(end, c.startSeconds + c.durationSeconds);
    }
    return { ...t, clips };
  });
  const range = ids.size > 0 && isFinite(start) && end > start ? { startSeconds: start, endSeconds: end } : null;
  return { project: { ...project, tracks }, range, clipCount: ids.size, trackCount };
}
