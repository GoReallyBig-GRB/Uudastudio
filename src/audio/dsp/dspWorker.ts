/**
 * Web Worker that runs the heavy streaming DSP (denoise, compress, pitch, speed) off the main thread, so the interface stays
 * smooth while a long track is processed. The main thread sends audio in blocks and gets the processed blocks back; the
 * stages are the same code as the in-thread ones (stages.ts), so results are identical.
 */
import { buildStage, StageSpec, SyncStage } from './stages';

type Request =
  | { type: 'open'; id: number; spec: StageSpec }
  | { type: 'push'; id: number; seq: number; chunk: Float32Array[] }
  | { type: 'finish'; id: number; seq: number }
  | { type: 'close'; id: number };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

const stages = new Map<number, SyncStage>();

const reply = (id: number, seq: number, outs: Float32Array[]) => {
  // Copy views that sit on a larger buffer so only what is needed travels
  const owned = outs.map((o) => (o.byteOffset === 0 && o.byteLength === o.buffer.byteLength ? o : o.slice()));
  scope.postMessage({ type: 'out', id, seq, outs: owned }, owned.map((o) => o.buffer as ArrayBuffer));
};

scope.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'open') {
      stages.set(m.id, buildStage(m.spec));
      scope.postMessage({ type: 'opened', id: m.id });
    } else if (m.type === 'push') {
      const st = stages.get(m.id);
      if (!st) throw new Error('No such stage');
      reply(m.id, m.seq, st.push(m.chunk));
    } else if (m.type === 'finish') {
      const st = stages.get(m.id);
      if (!st) throw new Error('No such stage');
      reply(m.id, m.seq, st.finish());
      stages.delete(m.id);
    } else if (m.type === 'close') {
      stages.delete(m.id);
    }
  } catch (err) {
    scope.postMessage({ type: 'error', id: (m as { id: number }).id, message: err instanceof Error ? err.message : String(err) });
  }
};
