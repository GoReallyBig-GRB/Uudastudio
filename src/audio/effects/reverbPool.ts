/**
 * A small pool of reverb workers. `run` hands a block to a free worker and resolves with the reverbed block (plus tail).
 * Throws from `create` if workers cannot be started, so the caller can fall back to the slower built-in path.
 */
import type { ReverbKernel } from './reverbKernel';

interface Slot { worker: Worker; busy: boolean }

export class ReverbPool {
  private slots: Slot[] = [];
  private waiting: Array<() => void> = [];
  private pending = new Map<number, { resolve: (o: Float32Array[]) => void; reject: (e: Error) => void; slot: Slot }>();
  private nextId = 1;
  private dead: Error | null = null;
  readonly size: number;

  private constructor(size: number) {
    this.size = size;
  }

  static async create(size: number, kernel: ReverbKernel, n: number): Promise<ReverbPool> {
    if (typeof Worker === 'undefined') throw new Error('Workers are not available');
    const pool = new ReverbPool(size);
    const ready: Promise<void>[] = [];
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('./reverbWorker.ts', import.meta.url), { type: 'module' });
      const slot: Slot = { worker, busy: false };
      pool.slots.push(slot);
      ready.push(new Promise<void>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent) => {
          const m = e.data as { type: string; id?: number; outs?: Float32Array[]; message?: string };
          if (m.type === 'ready') { resolve(); return; }
          const p = m.id != null ? pool.pending.get(m.id) : undefined;
          if (m.type === 'out' && p) {
            pool.pending.delete(m.id!);
            p.resolve(m.outs ?? []);
            pool.release(p.slot);
          } else if (m.type === 'error') {
            const err = new Error(m.message || 'Reverb processing failed');
            if (p) { pool.pending.delete(m.id!); p.reject(err); pool.release(p.slot); } else reject(err);
          }
        };
        worker.onerror = () => {
          const err = new Error('The reverb processor stopped unexpectedly.');
          pool.dead = err;
          reject(err);
          pool.pending.forEach((p) => p.reject(err));
          pool.pending.clear();
        };
      }));
      // each worker gets its own copy of the response (it is a few hundred KB)
      worker.postMessage({ type: 'init', left: kernel.left.slice(), right: kernel.right.slice(), n, gain: kernel.gain, dry: kernel.dryGain });
    }
    try {
      await Promise.all(ready);
    } catch (e) {
      pool.dispose();
      throw e;
    }
    return pool;
  }

  private release(slot: Slot) {
    slot.busy = false;
    const next = this.waiting.shift();
    if (next) next();
  }

  private async acquire(): Promise<Slot> {
    for (;;) {
      if (this.dead) throw this.dead;
      const free = this.slots.find((s) => !s.busy);
      if (free) { free.busy = true; return free; }
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
  }

  /** Channels in, channels out (one or two); the output is the block plus the decay tail */
  async run(block: Float32Array[]): Promise<Float32Array[]> {
    const slot = await this.acquire();
    const id = this.nextId++;
    const mono = block.length < 2;
    // copy: the input block may be a view onto stored audio that must stay intact
    const l = block[0].slice();
    const r = mono ? l.slice() : block[1].slice();
    return new Promise<Float32Array[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, slot });
      slot.worker.postMessage({ type: 'run', id, l, r, mono }, [l.buffer, r.buffer]);
    });
  }

  dispose() {
    for (const s of this.slots) { try { s.worker.terminate(); } catch { /* gone */ } }
    this.slots = [];
    this.waiting.forEach((w) => w());
    this.waiting = [];
  }
}
