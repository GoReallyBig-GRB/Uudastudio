/**
 * A short plain-words name for what a change did, so Undo and Redo can say "Undid delete" or "Redid split" instead of
 * "reverted last change". Worked out by comparing the project before and after, so every edit gets a name without each
 * edit having to supply one. Edits that look the same afterwards (Cut and Delete) are named by the handler that makes them.
 */
import type { Clip, Project } from '../types';

const clipMap = (p: Project): Map<string, Clip> => {
  const m = new Map<string, Clip>();
  for (const t of p.tracks) for (const c of t.clips) m.set(c.id, c);
  return m;
};

export const describeChange = (prev: Project, next: Project): string => {
  const before = clipMap(prev);
  const after = clipMap(next);
  const added = [...after.values()].filter((c) => !before.has(c.id));
  const removed = [...before.values()].filter((c) => !after.has(c.id));
  const common = [...after.values()].filter((c) => before.has(c.id));
  const changed = (key: keyof Clip) => common.filter((c) => c[key] !== before.get(c.id)![key]);

  if (added.length === 0 && removed.length === 0) {
    const assets = changed('assetId');
    if (assets.length > 0) return 'processing';
    const muted = changed('muted');
    if (muted.length > 0) return muted.every((c) => c.muted) ? 'mute' : muted.every((c) => !c.muted) ? 'unmute' : 'mute change';
    if (changed('gain').length > 0) return 'level change';
    const trackOf = (p: Project) => { const m = new Map<string, string>(); for (const t of p.tracks) for (const c of t.clips) m.set(c.id, t.id); return m; };
    const t0 = trackOf(prev); const t1 = trackOf(next);
    if (common.some((c) => t0.get(c.id) !== t1.get(c.id))) return 'move to another track';
    if (changed('startSeconds').length > 0) return 'move';
    if (changed('fadeInSeconds').length + changed('fadeOutSeconds').length + changed('fadeShape').length > 0) return 'fade';
    if (changed('groupId').length > 0) return common.some((c) => c.groupId && !before.get(c.id)!.groupId) ? 'group' : 'ungroup';
    if (changed('locked').length > 0) return common.some((c) => c.locked) ? 'lock' : 'unlock';
    if (changed('name').length > 0) return 'rename';
    if (changed('durationSeconds').length > 0 || changed('offsetSeconds').length > 0) return 'trim';
    if (prev.tracks.length !== next.tracks.length) return 'track change';
    if (prev.name !== next.name) return 'rename project';
    return 'change';
  }
  if (removed.length === 0) {
    // A split makes new pieces from existing audio and shortens the clip it came from
    const reshaped = common.some((c) => c.durationSeconds < before.get(c.id)!.durationSeconds - 1e-6);
    if (reshaped) {
      if (added.some((c) => c.muted) && common.every((c) => !c.muted || before.get(c.id)!.muted)) return 'silence';
      if (changed('gain').length > 0 || added.some((a) => common.some((c) => c.assetId === a.assetId && a.gain !== c.gain))) return 'level change';
      return 'split';
    }
    return added.length > 1 ? 'add clips' : 'add clip';
  }
  if (added.length === 0) return 'delete';
  return 'edit';
};
