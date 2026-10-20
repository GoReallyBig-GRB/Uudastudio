/**
 * X-PRO AUDIO - History & Undo/Redo Layer
 * Maintains immutable history snapshots of project state for multi-level undo/redo.
 */

import { Project } from '../types';

export class HistoryManager {
  private past: Project[] = [];
  private present: Project;
  private future: Project[] = [];
  private maxDepth: number = 60;

  constructor(initialProject: Project) {
    this.present = JSON.parse(JSON.stringify(initialProject));
  }

  public getPresent(): Project {
    return this.present;
  }

  public setPresent(project: Project): void {
    this.present = JSON.parse(JSON.stringify(project));
  }

  public reset(project: Project): void {
    this.past = [];
    this.present = JSON.parse(JSON.stringify(project));
    this.future = [];
  }

  public pushState(nextProject: Project): void {
    // Only push if there's an actual state change
    const nextSerialized = JSON.stringify(nextProject);
    const currSerialized = JSON.stringify(this.present);
    if (nextSerialized === currSerialized) return;

    this.past.push(this.present);
    if (this.past.length > this.maxDepth) {
      this.past.shift();
    }
    this.present = JSON.parse(nextSerialized);
    this.future = [];
  }

  public undo(): Project | null {
    if (this.past.length === 0) return null;
    const previous = this.past.pop()!;
    this.future.unshift(this.present);
    this.present = previous;
    return this.present;
  }

  public redo(): Project | null {
    if (this.future.length === 0) return null;
    const next = this.future.shift()!;
    this.past.push(this.present);
    this.present = next;
    return this.present;
  }

  public canUndo(): boolean {
    return this.past.length > 0;
  }

  public canRedo(): boolean {
    return this.future.length > 0;
  }
}
