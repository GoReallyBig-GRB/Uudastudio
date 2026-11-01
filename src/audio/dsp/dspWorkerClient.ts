/**
 * Runs streaming DSP stages in a Web Worker, falling back to the main thread when a worker cannot be started, so the
 * processing never depends on the worker being available. A remote stage looks like a MultiStage whose calls return promises.
 */
import { StageSpec, SyncStage, buildStage } from './stages';

type AsyncStage = {
  push(chunk: Float32Array[]): Promise<Float32Array[]>;
  finish(): Promise<Float32Array[]>;
  /** Drop the stage early (cancelled job) */
  close(): void;
};

interface Pending { resolve: (outs: Float32Array[]) => void; reject: (e: Error) => void }

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<string, Pending>();
const openWaiters = new Map<number, Pending & { opened: () => void }>();

const failAll = (message: string) => {
  workerBroken = true;
  const err = new Error(message);
  pending.forEach((p) => p.reject(err));
  pending.clear();
  openWaiters.forEach((w) => w.reject(err));
  openWaiters.clear();
  try { worker?.terminate(); } catch { /* already gone */ }
  worker = null;
};

const getWorker = (): Worker | null => {
  if (workerBroken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    const w = new Worker(new URL('./dspWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; id: number; seq?: number; outs?: Float32Array[]; message?: string };
      if (m.type === 'opened') {
        openWaiters.get(m.id)?.opened();
        openWaiters.delete(m.id);
      } else if (m.type === 'out') {
        const key = `${m.id}:${m.seq}`;
        pending.get(key)?.resolve(m.outs ?? []);
        pending.delete(key);
      } else if (m.type === 'error') {
        const err = new Error(m.message || 'Processing failed');
        for (const [key, p] of pending) if (key.startsWith(`${m.id}:`)) { p.reject(err); pending.delete(key); }
        openWaiters.get(m.id)?.reject(err);
        openWaiters.delete(m.id);
      }
    };
    w.onerror = () => failAll('The background processor stopped unexpectedly.');
    worker = w;
    return w;
  } catch {
    workerBroken = true;
    return null;
  }
};

/** A stage that runs in the worker when one is available, otherwise in this thread. */
export const openStage = async (spec: StageSpec): Promise<AsyncStage> => {
  const w = getWorker();
  if (!w) return localStage(buildStage(spec));
  const id = nextId++;
  try {
    await new Promise<void>((resolve, reject) => {
      openWaiters.set(id, { resolve: () => undefined, reject, opened: resolve });
      w.postMessage({ type: 'open', id, spec });
    });
  } catch {
    // The worker could not start this stage: carry on in this thread rather than failing the job
    return localStage(buildStage(spec));
  }
  let seq = 0;
  const call = (message: Record<string, unknown>, transfer: Transferable[]) =>
    new Promise<Float32Array[]>((resolve, reject) => {
      const n = seq++;
      pending.set(`${id}:${n}`, { resolve, reject });
      w.postMessage({ ...message, id, seq: n }, transfer);
    });
  return {
    push: (chunk) => {
      // The caller keeps its audio: send copies, which are handed over to the worker
      const copies = chunk.map((c) => c.slice());
      return call({ type: 'push', chunk: copies }, copies.map((c) => c.buffer as ArrayBuffer));
    },
    finish: () => call({ type: 'finish' }, []),
    close: () => { try { w.postMessage({ type: 'close', id }); } catch { /* worker gone */ } },
  };
};

const localStage = (stage: SyncStage): AsyncStage => ({
  push: async (chunk) => stage.push(chunk),
  finish: async () => stage.finish(),
  close: () => undefined,
});

/** Block size for sending audio to the worker: small enough to keep each message light and progress smooth */
export const WORKER_BLOCK_SECONDS = 10;

/** Run a whole in-memory clip through a stage off the main thread; returns the processed channels. */
export const processChannelsOffThread = async (channels: Float32Array[], sampleRate: number, tool: StageSpec['tool']): Promise<Float32Array[]> => {
  const total = channels[0]?.length ?? 0;
  const stage = await openStage({ tool, channels: channels.length, totalFrames: total, sampleRate });
  const block = Math.max(1, Math.round(WORKER_BLOCK_SECONDS * sampleRate));
  const parts: Float32Array[][] = channels.map(() => []);
  const keep = (outs: Float32Array[]) => outs.forEach((o, c) => { if (o.length) parts[c].push(o); });
  try {
    for (let i = 0; i < total; i += block) {
      keep(await stage.push(channels.map((c) => c.subarray(i, Math.min(total, i + block)))));
    }
    keep(await stage.finish());
  } catch (e) {
    stage.close();
    throw e;
  }
  return parts.map((p) => {
    const out = new Float32Array(p.reduce((n, x) => n + x.length, 0));
    let o = 0;
    for (const x of p) { out.set(x, o); o += x.length; }
    return out;
  });
};
