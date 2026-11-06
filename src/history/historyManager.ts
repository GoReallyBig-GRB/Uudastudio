/**
 * X-PRO AUDIO - History & Undo/Redo Layer
 * Maintains immutable history snapshots of project state for multi-level undo/redo.
 */

import { Project } from '../types';
import { assetIdsOf, pastStatesToDrop } from './historyLimits';

/** Lets the history know which assets are processed copies of long audio, so it can limit and clean them up. */
export interface HistoryAssetPolicy {
  /** Length in minutes when the asset is a processed copy kept on disk, otherwise undefined */
  processedMinutes(assetId: string): number | undefined;
  /** Undo limit for that length (null = none) */
  limitFor(minutes: number): number | null;
  /** Processed copies no state refers to any more: the owner may delete them from disk */
  onUnreferenced?(assetIds: string[]): void;
  /** The history was shortened to this many processed copies */
  onLimited?(limit: number): void;
}

export class HistoryManager {
  private past: Project[] = [];
  /** Name of the step that led from past[i] to the state after it (same length as past) */
  private pastLabels: string[] = [];
  private futureLabels: string[] = [];
  /** Name of the step the last undo() or redo() went over, for the Undo / Redo message */
  public lastStepLabel = '';
  private present: Project;
  private future: Project[] = [];
  private maxDepth: number = 60;

  private policy: HistoryAssetPolicy | null = null;
  /**
   * When the history is shortened, the state just before the first processing step is kept apart, so the last Undo can
   * return to it. It never refers to a processed copy, so keeping it costs no disk.
   */
  private anchor: Project | null = null;
  /** Processed copies seen so far that have not been reported as unreferenced */
  private tracked = new Set<string>();

  constructor(initialProject: Project) {
    this.present = JSON.parse(JSON.stringify(initialProject));
  }

  public setPolicy(policy: HistoryAssetPolicy | null): void {
    this.policy = policy;
  }

  /** Drops the oldest states when processed copies of long audio exceed the limit, then reports copies nothing refers to */
  private enforce(report = true): void {
    const policy = this.policy;
    if (!policy) return;
    const isProcessed = (id: string) => policy.processedMinutes(id) !== undefined;
    const all = [...this.past, this.present, ...this.future];
    let longest = 0;
    for (const p of all) for (const id of assetIdsOf(p)) {
      const m = policy.processedMinutes(id);
      if (m !== undefined) { this.tracked.add(id); longest = Math.max(longest, m); }
    }
    const limit = longest > 0 ? policy.limitFor(longest) : null;
    const drop = pastStatesToDrop(this.past, this.present, limit, isProcessed);
    if (drop > 0) {
      // The state to fall back on is the one just BEFORE the first processed copy appeared: every edit made up to then
      // (cuts, deletes, silence) is kept, and only the processing and what followed it is given up. It is kept apart only
      // when it is itself about to be dropped; otherwise Undo reaches it in the normal way.
      if (!this.anchor) {
        const first = this.past.findIndex((p) => [...assetIdsOf(p)].some(isProcessed));
        if (first > 0 && first - 1 < drop) this.anchor = this.past[first - 1];
      }
      this.past = this.past.slice(drop);
      this.pastLabels = this.pastLabels.slice(drop);
      if (limit !== null) policy.onLimited?.(limit);
    }
    const alive = new Set<string>();
    for (const p of [...this.past, this.present, ...this.future, ...(this.anchor ? [this.anchor] : [])]) for (const id of assetIdsOf(p)) alive.add(id);
    const gone = [...this.tracked].filter((id) => !alive.has(id));
    if (gone.length > 0) {
      for (const id of gone) this.tracked.delete(id);
      if (report) policy.onUnreferenced?.(gone);
    }
  }

  public getPresent(): Project {
    return this.present;
  }

  public setPresent(project: Project): void {
    this.present = JSON.parse(JSON.stringify(project));
  }

  public reset(project: Project): void {
    this.past = [];
    this.pastLabels = [];
    this.futureLabels = [];
    this.present = JSON.parse(JSON.stringify(project));
    this.future = [];
    this.anchor = null;
    // A new or loaded project: copies of the previous one are not ours to delete (they belong to its saved state)
    this.tracked.clear();
    this.enforce(false);
  }

  public pushState(nextProject: Project, label = ''): void {
    // Only push if there's an actual state change
    const nextSerialized = JSON.stringify(nextProject);
    const currSerialized = JSON.stringify(this.present);
    if (nextSerialized === currSerialized) return;

    this.past.push(this.present);
    this.pastLabels.push(label);
    if (this.past.length > this.maxDepth) {
      this.past.shift();
      this.pastLabels.shift();
    }
    this.present = JSON.parse(nextSerialized);
    this.future = [];
    this.futureLabels = [];
    this.enforce();
  }

  public undo(): Project | null {
    if (this.past.length === 0) {
      // Out of steps: the last Undo returns to the state the history began with, if one was kept
      if (this.anchor && this.present !== this.anchor) {
        this.future.unshift(this.present);
        this.futureLabels.unshift('processing');
        this.lastStepLabel = 'processing';
        this.present = this.anchor;
        return this.present;
      }
      return null;
    }
    const previous = this.past.pop()!;
    this.lastStepLabel = this.pastLabels.pop() ?? '';
    this.futureLabels.unshift(this.lastStepLabel);
    this.future.unshift(this.present);
    this.present = previous;
    return this.present;
  }

  public redo(): Project | null {
    if (this.future.length === 0) return null;
    const next = this.future.shift()!;
    this.lastStepLabel = this.futureLabels.shift() ?? '';
    this.pastLabels.push(this.lastStepLabel);
    this.past.push(this.present);
    this.present = next;
    return this.present;
  }

  public canUndo(): boolean {
    return this.past.length > 0 || (!!this.anchor && this.present !== this.anchor);
  }

  /** True when the project now shown is the original the history began with, reached because the steps ran out */
  public isAtOriginalAnchor(): boolean {
    return !!this.anchor && this.present === this.anchor;
  }

  /** True when the next Undo skips the shortened steps and returns to the original */
  public nextUndoIsOriginal(): boolean {
    return this.past.length === 0 && !!this.anchor && this.present !== this.anchor;
  }

  public canRedo(): boolean {
    return this.future.length > 0;
  }
}
