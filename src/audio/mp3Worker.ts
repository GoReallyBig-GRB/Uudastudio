/// <reference lib="webworker" />
/**
 * MP3 encoding off the page's main thread, so the export keeps rendering the next block while this one encodes.
 * Protocol: init -> (encode -> data+ack)* -> finish -> data+done. Errors come back as { type: 'error' }.
 */
import { Mp3Core } from './mp3Core';

export type Mp3WorkerIn =
  | { type: 'init'; channels: number; sampleRate: number; kbps: number }
  | { type: 'encode'; id: number; left: Int16Array; right?: Int16Array }
  | { type: 'finish' };
export type Mp3WorkerOut =
  | { type: 'data'; id: number; bytes: Uint8Array }
  | { type: 'done'; bytes: Uint8Array }
  | { type: 'error'; message: string };

let core: Promise<Mp3Core> | null = null;
const post = (m: Mp3WorkerOut, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(m, transfer ?? []);

// Messages are handled strictly in order, even though starting the encoder is asynchronous
let queue: Promise<void> = Promise.resolve();
self.onmessage = (e: MessageEvent<Mp3WorkerIn>) => {
  queue = queue.then(() => handle(e.data));
};

async function handle(m: Mp3WorkerIn): Promise<void> {
  try {
    if (m.type === 'init') {
      core = Mp3Core.create(m.channels, m.sampleRate, m.kbps);
      await core;
    } else if (m.type === 'encode') {
      if (!core) throw new Error('MP3 worker used before init.');
      const bytes = (await core).encode(m.left, m.right);
      post({ type: 'data', id: m.id, bytes }, [bytes.buffer]);
    } else if (m.type === 'finish') {
      if (!core) throw new Error('MP3 worker used before init.');
      const bytes = (await core).finish();
      post({ type: 'done', bytes }, [bytes.buffer]);
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}
