/**
 * Undo history and long processed audio.
 *
 * Cuts, deletes, silence, level changes and pastes cost nothing to undo: they only change clip settings. A processed copy
 * (Compress, Denoise, Pitch, Speed, an effect) of long audio is different: each one is a full-length copy on disk. So the
 * number of processed copies the undo history keeps alive depends on how long the audio is (`processedUndoLimit`).
 * The state before the first processing (the original audio) is always kept, so you can always undo back to the original.
 */
import type { Project } from '../types';

/** Ids of every asset a project's clips point at */
export const assetIdsOf = (project: Project): Set<string> => {
  const ids = new Set<string>();
  for (const t of project.tracks) for (const c of t.clips) ids.add(c.assetId);
  return ids;
};

/**
 * How many of the OLDEST past states must be dropped so that, walking back from the present, no more than `limit` distinct
 * processed copies are referenced. `isProcessed` says whether an asset id is a processed copy. `limit` null = no limit.
 */
export const pastStatesToDrop = (
  past: readonly Project[],
  present: Project,
  limit: number | null,
  isProcessed: (assetId: string) => boolean,
): number => {
  if (limit === null) return 0;
  const seen = new Set<string>();
  for (const id of assetIdsOf(present)) if (isProcessed(id)) seen.add(id);
  for (let i = past.length - 1; i >= 0; i--) {
    for (const id of assetIdsOf(past[i])) {
      if (isProcessed(id)) seen.add(id);
    }
    if (seen.size > limit) return i + 1; // this state and everything older go
  }
  return 0;
};

/**
 * True when an Undo changed something but left processed audio (an effect, Compress, Denoise, Pitch or Speed result) in
 * place: the same processed copies are used before and after. The Undo then only reverted a lighter edit (a cut, a level
 * change), so the effect is still there and the user needs to Undo again to remove it.
 */
export const undoLeftProcessingInPlace = (
  before: Project,
  after: Project,
  isProcessed: (assetId: string) => boolean,
): boolean => {
  const processedBefore = [...assetIdsOf(before)].filter(isProcessed).sort();
  const processedAfter = [...assetIdsOf(after)].filter(isProcessed).sort();
  return processedAfter.length > 0 && processedBefore.join('|') === processedAfter.join('|');
};
