/**
 * Keeps the mastering loudness analysis up to date in the background.
 *
 * While mastering is active, the make-up gain that reaches the target loudness comes from measuring the whole mix.
 * Any change to the settings or the mix makes that measurement out of date; this waits for a quiet moment, measures
 * again (any length, flat memory, cancellable) and hands the result back. Playback keeps using the last good gain
 * in the meantime.
 */
import type { Project } from '../types';
import { analyzeProjectMastering } from './exportProject';
import type { ChainSettings, MasteringAnalysis } from './masteringSettings';

export interface MasteringStatus {
  /** waiting: a change was seen, measuring starts after a short pause */
  state: 'idle' | 'waiting' | 'analyzing' | 'error';
  percent: number;
  error?: string;
}

export interface AnalysisJob {
  project: Project;
  settings: ChainSettings;
  sampleRate: number;
  onDone: (analysis: MasteringAnalysis) => void;
}

const IDLE: MasteringStatus = { state: 'idle', percent: 0 };

class MasteringController {
  private status: MasteringStatus = IDLE;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private token = 0;

  getStatus = (): MasteringStatus => this.status;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  private set(next: MasteringStatus): void {
    this.status = next;
    for (const fn of this.listeners) fn();
  }

  /** Measure after `delayMs` without further requests; a newer request replaces this one. */
  request(job: AnalysisJob, delayMs = 1200): void {
    this.stopTimer();
    const my = ++this.token;
    this.set({ state: 'waiting', percent: 0 });
    this.timer = setTimeout(() => { this.timer = null; void this.run(job, my); }, delayMs);
  }

  /** Start right away (the Analyze button). */
  requestNow(job: AnalysisJob): void { this.request(job, 0); }

  /** Stop waiting or measuring. */
  cancel(): void {
    this.stopTimer();
    this.token++;
    if (this.status.state !== 'idle') this.set(IDLE);
  }

  private stopTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private async run(job: AnalysisJob, my: number): Promise<void> {
    this.set({ state: 'analyzing', percent: 0 });
    try {
      const analysis = await analyzeProjectMastering(job.project, job.settings, {
        sampleRate: job.sampleRate,
        isCancelled: () => this.token !== my,
        onProgress: (p) => { if (this.token === my) this.set({ state: 'analyzing', percent: p.percent }); },
      });
      if (this.token !== my) return;
      this.set(IDLE);
      job.onDone(analysis);
    } catch (err) {
      if (this.token !== my) return; // cancelled or replaced
      this.set({ state: 'error', percent: 0, error: err instanceof Error ? err.message : 'Loudness measurement failed.' });
    }
  }
}

export const masteringController = new MasteringController();
