/**
 * Runs streaming DSP stages in a Web Worker, falling back to the main thread when a worker cannot be started, so the
 * processing never depends on the worker being available. A remote stage looks like a MultiStage whose calls return promises.
 */
import { StageSpec, SyncStage, buildStage } from './stages';
import { createSegmentedChannel } from './segmentedStretch';
import { pitchStretchParams, speedStretchParams } from './wsola';

type AsyncStage = {
  push(chunk: Float32Array[]): Promise<Float32Array[]>;
  finish(): Promise<Float32Array[]>;
  /** Drop the stage early (cancelled job) */
  close(): void;
};

interface Pending { resolve: (outs: Float32Array[]) => void; reject: (e: Error) => void }

/** Background processors, started when first needed. A stage lives on one of them; stereo audio for tools that treat each
 *  channel on its own (denoise, pitch, speed) runs one channel per processor, so both channels are worked on at once. */
const workers: Worker[] = [];
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
  for (const w of workers) { try { w.terminate(); } catch { /* already gone */ } }
  workers.length = 0;
};

const onWorkerMessage = (e: MessageEvent) => {
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

/** How many processors may run at once: leave a core for the page itself */
const poolLimit = (): number => Math.max(1, Math.min(4, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4) - 1));

/** The processor with this index (0, 1, ...), started on first use; null when workers are not available. */
const getWorker = (index = 0): Worker | null => {
  if (workerBroken || typeof Worker === 'undefined') return null;
  if (workers[index]) return workers[index];
  try {
    while (workers.length <= index) {
      const w = new Worker(new URL('./dspWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = onWorkerMessage;
      w.onerror = () => failAll('The background processor stopped unexpectedly.');
      workers.push(w);
    }
    return workers[index];
  } catch {
    workerBroken = true;
    return null;
  }
};

/** A stage on one given processor (or this thread, when there is none or it cannot start the stage). */
const openOn = async (w: Worker | null, spec: StageSpec): Promise<AsyncStage> => {
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

/** Tools whose channels never influence each other (compression, levelling and enhance link them, so they stay in one piece) */
const channelsAreIndependent = (tool: StageSpec['tool']): boolean => tool.kind !== 'compress' && tool.kind !== 'enhance' && tool.kind !== 'evenout';

/** Speed and pitch on a long track are cut into segments that run on all the processors at once (see segmentedStretch.ts) */
const SEGMENT_MIN_SECONDS = 120;
/** Adapts to the machine: all cores but one for the page (at most 8), fewer on a device that reports little memory.
 *  Below 2 the plain single-run path is used, so a small machine never pays for segmenting. */
const segmentPool = (): number => {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : null;
  const cores = nav?.hardwareConcurrency || 4;
  const memoryCap = nav?.deviceMemory && nav.deviceMemory <= 2 ? 2 : nav?.deviceMemory && nav.deviceMemory <= 4 ? 4 : 8;
  return Math.max(1, Math.min(8, memoryCap, cores - 1));
};

const openSegmented = async (spec: StageSpec, pool: number): Promise<AsyncStage> => {
  const { tool, sampleRate, totalFrames } = spec;
  const ratio = tool.kind === 'speed' ? Math.max(0.2, Math.min(5, Number.isFinite(tool.ratio) ? tool.ratio : 1)) : 1;
  const params = tool.kind === 'speed' ? speedStretchParams(sampleRate) : pitchStretchParams(Math.pow(2, Math.max(-24, Math.min(24, tool.kind === 'pitch' ? tool.semitones : 0)) / 12), sampleRate);
  const segmentFrames = Math.round(Math.max(30, Math.min(120, totalFrames / sampleRate / (pool * 2))) * sampleRate);
  let turn = 0;
  const open: AsyncStage[] = [];
  const runSegment = async (input: Float32Array): Promise<Float32Array> => {
    const st = await openOn(getWorker(turn++ % pool), { ...spec, channels: 1, totalFrames: input.length });
    open.push(st);
    try {
      const a = (await st.push([input]))[0] ?? new Float32Array(0);
      const b = (await st.finish())[0] ?? new Float32Array(0);
      const out = new Float32Array(a.length + b.length);
      out.set(a);
      out.set(b, a.length);
      return out;
    } finally {
      st.close();
      open.splice(open.indexOf(st), 1);
    }
  };
  const chans = Array.from({ length: Math.max(1, spec.channels) }, () => createSegmentedChannel({
    totalFrames, ratio, frame: params.frame, search: params.search, segmentFrames, runSegment, maxInFlight: pool + 1,
  }));
  // The channels run the same plan, so they normally hand back the same amount; keep any difference for the next call
  const carry: Float32Array[] = chans.map(() => new Float32Array(0));
  const common = (outs: Float32Array[]): Float32Array[] => {
    const joined = outs.map((o, c) => {
      const m = new Float32Array(carry[c].length + o.length);
      m.set(carry[c]);
      m.set(o, carry[c].length);
      return m;
    });
    const n = Math.min(...joined.map((j) => j.length));
    joined.forEach((j, c) => { carry[c] = j.subarray(n); });
    return joined.map((j) => j.subarray(0, n));
  };
  const pick = (chunk: Float32Array[], c: number) => chunk[Math.min(c, chunk.length - 1)].slice();
  return {
    push: async (chunk) => common(await Promise.all(chans.map((ch, c) => ch.push(pick(chunk, c))))),
    finish: async () => common(await Promise.all(chans.map((ch) => ch.finish()))),
    close: () => { open.slice().forEach((st) => st.close()); },
  };
};

/** A stage that runs in the worker when one is available, otherwise in this thread. */
export const openStage = async (spec: StageSpec): Promise<AsyncStage> => {
  if ((spec.tool.kind === 'pitch' || spec.tool.kind === 'speed') && spec.totalFrames >= SEGMENT_MIN_SECONDS * spec.sampleRate) {
    const pool = segmentPool();
    if (pool > 1 && getWorker(1)) return openSegmented(spec, pool);
  }
  const limit = Math.min(spec.channels, poolLimit());
  if (spec.channels > 1 && limit > 1 && channelsAreIndependent(spec.tool) && getWorker(1)) {
    // One channel per processor: same results as one stage over both channels, in about half the time
    const subs = await Promise.all(Array.from({ length: spec.channels }, (_, c) => openOn(getWorker(c % limit), { ...spec, channels: 1 })));
    const pick = (chunk: Float32Array[], c: number) => [chunk[Math.min(c, chunk.length - 1)]];
    return {
      push: async (chunk) => (await Promise.all(subs.map((st, c) => st.push(pick(chunk, c))))).map((o) => o[0] ?? new Float32Array(0)),
      finish: async () => (await Promise.all(subs.map((st) => st.finish()))).map((o) => o[0] ?? new Float32Array(0)),
      close: () => subs.forEach((st) => st.close()),
    };
  }
  return openOn(getWorker(0), spec);
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
