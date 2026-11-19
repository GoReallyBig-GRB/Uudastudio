import { pack24, unpack24, type TakeOffer, type TakeSink } from './transfer';

/** The same size the server uses: a part holds whole frames and is at most 5 MiB */
export const PART_BYTES = 5 * 1024 * 1024;
export const partBytesFor = (channels: number): number => Math.floor(PART_BYTES / (channels * 3)) * channels * 3;

export const sha256Hex = async (b: Uint8Array): Promise<string> => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer))].map((x) => x.toString(16).padStart(2, '0')).join('');

type Fetch = typeof fetch;
export interface DropIO { fetchFn: Fetch; /** e.g. /api/live/drop/<token> */ base: string }

export type UploadResult = 'done' | 'refused' | 'retry' | 'aborted';
export interface UploadOutcome { result: UploadResult; message: string | null }

const text = async (r: Response): Promise<string | null> => ((await r.json().catch(() => ({}))) as { error?: string }).error ?? null;

/** A ticket for this take, good for 8 days. Ask while still in the room. */
export async function getTicket(io: DropIO, takeId: string): Promise<string | null> {
  try {
    const r = await io.fetchFn(`${io.base}/ticket`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ takeId }) });
    return r.ok ? (((await r.json()) as { ticket?: string }).ticket ?? null) : null;
  } catch { return null; }
}

/**
 * Sends one saved recording over HTTPS in parts. Safe to repeat: the server says which parts it already holds. 'retry' means try again later
 * (no connection, server busy); 'refused' means the server will not take it (full, too large) and the message says why.
 */
export async function uploadTake(io: DropIO, ticket: string, from: string, offer: TakeOffer, read: (start: number, frames: number) => Promise<Float32Array[]>, onProgress: (f: number) => void, aborted: () => boolean = () => false): Promise<UploadOutcome> {
  const q = `?take=${encodeURIComponent(offer.takeId)}`;
  const headers = { 'x-drop-ticket': ticket };
  const bytes = offer.frames * offer.channels * 3;
  try {
    const init = await io.fetchFn(`${io.base}/init${q}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ from, name: offer.name, bytes, frames: offer.frames, sampleRate: offer.sampleRate, channels: offer.channels, startAt: offer.startAt, stopAt: offer.stopAt, roomStartMs: offer.roomStartMs }) });
    if (!init.ok) { const m = await text(init); return init.status >= 500 && init.status !== 507 ? { result: 'retry', message: null } : { result: 'refused', message: m }; }
    const { partBytes, parts, received } = (await init.json()) as { partBytes: number; parts: number; received: number[]; ready: boolean };
    const have = new Set(received);
    const fpp = partBytes / (offer.channels * 3);
    for (let n = 0; n < parts; n++) {
      if (aborted()) return { result: 'aborted', message: null };
      if (!have.has(n)) {
        const frames = Math.min(fpp, offer.frames - n * fpp);
        const data = pack24(await read(n * fpp, frames));
        const r = await io.fetchFn(`${io.base}/part${q}&n=${n}`, { method: 'PUT', headers: { ...headers, 'x-sha256': await sha256Hex(data) }, body: data as unknown as BodyInit });
        if (!r.ok) { const m = await text(r); return r.status === 422 || r.status >= 500 ? { result: 'retry', message: null } : { result: 'refused', message: m }; }
      }
      onProgress((n + 1) / parts);
    }
    const done = await io.fetchFn(`${io.base}/complete${q}`, { method: 'POST', headers });
    if (!done.ok) return done.status === 409 || done.status >= 500 ? { result: 'retry', message: null } : { result: 'refused', message: await text(done) };
    return { result: 'done', message: null };
  } catch { return { result: 'retry', message: null }; }
}

export interface HeldTake { takeId: string; from: string; name: string; bytes: number; frames: number; sampleRate: number; channels: number; startAt: number; stopAt: number | null; roomStartMs: number; status: 'uploading' | 'ready'; collectedAt: number | null; partBytes: number; received: number; parts: number }

export async function listHeld(io: DropIO): Promise<HeldTake[] | null> {
  try { const r = await io.fetchFn(`${io.base}/list`); return r.ok ? (((await r.json()) as { takes: HeldTake[] }).takes) : null; } catch { return null; }
}

/** Downloads one held take into `sink`, checking every part, then tells the server so the 24-hour clock starts. Returns false if anything failed (nothing is marked collected). */
export async function collectTake(io: DropIO, t: HeldTake, sink: TakeSink, onProgress: (f: number) => void): Promise<boolean> {
  const q = `?take=${encodeURIComponent(t.takeId)}`;
  try {
    for (let n = 0; n < t.parts; n++) {
      const r = await io.fetchFn(`${io.base}/part${q}&n=${n}`);
      if (!r.ok) return false;
      const data = new Uint8Array(await r.arrayBuffer());
      if ((await sha256Hex(data)) !== r.headers.get('x-sha256')) return false;
      const frames = Math.min(t.partBytes / (t.channels * 3), t.frames - n * (t.partBytes / (t.channels * 3)));
      if (data.length !== frames * t.channels * 3) return false;
      await sink.write(unpack24(data, t.channels, frames));
      onProgress((n + 1) / t.parts);
    }
    const c = await io.fetchFn(`${io.base}/collected${q}`, { method: 'POST' });
    return c.ok;
  } catch { return false; }
}
