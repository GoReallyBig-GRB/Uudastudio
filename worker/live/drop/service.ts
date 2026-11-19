import type { BlobStore } from './blob';
import { PART_BYTES, expiresAt, partsFor, type Backing, type Route } from './plan';

/** What is known about one take being held for the host */
export interface DropTake {
  takeId: string;
  /** Who it is from: the guest's name as the room knew it, or empty */
  from: string;
  name: string;
  backing: Backing;
  handle: string;
  bytes: number;
  frames: number;
  sampleRate: number;
  channels: number;
  startAt: number;
  stopAt: number | null;
  roomStartMs: number;
  partBytes: number;
  status: 'uploading' | 'ready';
  uploadedAt: number;
  collectedAt: number | null;
  /** Tag of each part received, by index */
  tags: Record<number, string>;
}

export interface DropRepo {
  get(takeId: string): DropTake | null;
  put(t: DropTake): void;
  remove(takeId: string): void;
  all(): DropTake[];
}

export class MemoryDropRepo implements DropRepo {
  private m = new Map<string, DropTake>();
  get(id: string) { const t = this.m.get(id); return t ? structuredClone(t) : null; }
  put(t: DropTake) { this.m.set(t.takeId, structuredClone(t)); }
  remove(id: string) { this.m.delete(id); }
  all() { return [...this.m.values()].map((t) => structuredClone(t)); }
}

export interface DropDeps {
  repo: DropRepo;
  /** The two places a take can live; b2 is null until it is configured */
  blobs: { do: BlobStore; b2: BlobStore | null };
  /** Asks the account-wide registry where a new file of this size should go */
  route(size: number): Promise<Route>;
  /** Tells the registry how many bytes a take holds now (a value, not an amount to add) */
  report(backing: Backing, key: string, bytes: number): Promise<void>;
  eventId: string;
  now(): number;
}

export interface InitInput { takeId: string; from: string; name: string; bytes: number; frames: number; sampleRate: number; channels: number; startAt: number; stopAt: number | null; roomStartMs: number }
export type Reply<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

const sha256 = async (b: Uint8Array): Promise<string> => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer))].map((x) => x.toString(16).padStart(2, '0')).join('');

/** The rules for holding a guest's recording until the host collects it. Independent of Cloudflare, so it is tested directly. */
export class DropService {
  constructor(private readonly d: DropDeps) {}
  private key(takeId: string): string { return `${this.d.eventId}/${takeId}`; }
  private store(t: DropTake): BlobStore | null { return t.backing === 'b2' ? this.d.blobs.b2 : this.d.blobs.do; }
  private received(t: DropTake): number[] { return Object.keys(t.tags).map(Number).sort((a, b) => a - b); }
  private heldBytes(t: DropTake): number { return this.received(t).reduce((n, i) => n + Math.min(t.partBytes, t.bytes - i * t.partBytes), 0); }

  async init(i: InitInput): Promise<Reply<{ partBytes: number; parts: number; received: number[]; ready: boolean }>> {
    const bad = !Number.isInteger(i.bytes) || i.bytes <= 0 || i.channels < 1 || i.channels > 2 || i.sampleRate < 8000 || i.sampleRate > 192_000 || i.frames <= 0 || i.bytes !== i.frames * i.channels * 3;
    if (bad) return fail(400, 'That recording does not look right.');
    const have = this.d.repo.get(i.takeId);
    if (have) {
      if (have.bytes !== i.bytes) return fail(409, 'A different recording is already held for this take.');
      return { ok: true, value: { partBytes: have.partBytes, parts: partsFor(have.bytes, have.partBytes), received: this.received(have), ready: have.status === 'ready' } };
    }
    const route = await this.d.route(i.bytes);
    if (!route.backing) return fail(507, route.refusal ?? 'No room.');
    const blob = route.backing === 'b2' ? this.d.blobs.b2 : this.d.blobs.do;
    if (!blob) return fail(507, 'No room.');
    let handle: string;
    try { handle = await blob.begin(this.key(i.takeId)); } catch { return fail(503, 'The store is not available. Your recording is safe on your device.'); }
    const t: DropTake = { ...i, backing: route.backing, handle, partBytes: Math.floor(PART_BYTES / (i.channels * 3)) * i.channels * 3, status: 'uploading', uploadedAt: this.d.now(), collectedAt: null, tags: {} };
    this.d.repo.put(t);
    return { ok: true, value: { partBytes: t.partBytes, parts: partsFor(t.bytes, t.partBytes), received: [], ready: false } };
  }

  async putPart(takeId: string, n: number, data: Uint8Array, sha: string): Promise<Reply<{ received: number }>> {
    const t = this.d.repo.get(takeId);
    if (!t) return fail(404, 'Start the upload first.');
    if (t.status === 'ready') return { ok: true, value: { received: this.received(t).length } };
    const parts = partsFor(t.bytes, t.partBytes);
    if (!Number.isInteger(n) || n < 0 || n >= parts) return fail(400, 'No such part.');
    const want = n === parts - 1 ? t.bytes - n * t.partBytes : t.partBytes;
    if (data.length !== want) return fail(422, 'That part is the wrong size.');
    if ((await sha256(data)) !== sha) return fail(422, 'That part arrived damaged. Send it again.');
    if (t.tags[n] !== undefined) return { ok: true, value: { received: this.received(t).length } };
    const blob = this.store(t);
    if (!blob) return fail(503, 'The store is not available.');
    try { t.tags[n] = await blob.putPart(this.key(takeId), t.handle, n, data); } catch { return fail(503, 'The store could not take that part. Try again.'); }
    this.d.repo.put(t);
    await this.d.report(t.backing, this.key(takeId), this.heldBytes(t)).catch(() => undefined);
    return { ok: true, value: { received: this.received(t).length } };
  }

  async complete(takeId: string): Promise<Reply<{ ready: true }>> {
    const t = this.d.repo.get(takeId);
    if (!t) return fail(404, 'Start the upload first.');
    if (t.status === 'ready') return { ok: true, value: { ready: true } };
    const parts = partsFor(t.bytes, t.partBytes);
    const missing = Array.from({ length: parts }, (_, i) => i).filter((i) => t.tags[i] === undefined);
    if (missing.length) return fail(409, `${missing.length} part${missing.length === 1 ? ' is' : 's are'} still missing.`);
    const blob = this.store(t);
    if (!blob) return fail(503, 'The store is not available.');
    try { await blob.complete(this.key(takeId), t.handle, Array.from({ length: parts }, (_, i) => t.tags[i])); } catch { return fail(503, 'The store could not finish the file. Try again.'); }
    t.status = 'ready'; t.uploadedAt = this.d.now();
    this.d.repo.put(t);
    return { ok: true, value: { ready: true } };
  }

  /** What the host sees: every take held for this event */
  list(): Array<Pick<DropTake, 'takeId' | 'from' | 'name' | 'bytes' | 'frames' | 'sampleRate' | 'channels' | 'startAt' | 'stopAt' | 'roomStartMs' | 'status' | 'collectedAt' | 'partBytes'> & { received: number; parts: number }> {
    return this.d.repo.all().map((t) => ({ takeId: t.takeId, from: t.from, name: t.name, bytes: t.bytes, frames: t.frames, sampleRate: t.sampleRate, channels: t.channels, startAt: t.startAt, stopAt: t.stopAt, roomStartMs: t.roomStartMs, status: t.status, collectedAt: t.collectedAt, partBytes: t.partBytes, received: this.received(t).length, parts: partsFor(t.bytes, t.partBytes) }));
  }

  async getPart(takeId: string, n: number): Promise<Reply<{ data: Uint8Array; sha: string }>> {
    const t = this.d.repo.get(takeId);
    if (!t || t.status !== 'ready') return fail(404, 'That recording is not ready.');
    if (!Number.isInteger(n) || n < 0 || n >= partsFor(t.bytes, t.partBytes)) return fail(400, 'No such part.');
    const blob = this.store(t);
    let data: Uint8Array | null = null;
    try { data = blob ? await blob.getPart(this.key(takeId), t.handle, n, t.partBytes, t.bytes) : null; } catch { data = null; }
    if (!data) return fail(503, 'The store could not give that part. Try again.');
    return { ok: true, value: { data, sha: await sha256(data) } };
  }

  /** The host has the whole file: it will be deleted 24 hours from now */
  collected(takeId: string): Reply<{ deleteAt: number }> {
    const t = this.d.repo.get(takeId);
    if (!t || t.status !== 'ready') return fail(404, 'That recording is not ready.');
    if (t.collectedAt === null) { t.collectedAt = this.d.now(); this.d.repo.put(t); }
    return { ok: true, value: { deleteAt: expiresAt(t.uploadedAt, t.collectedAt) } };
  }

  /** Deletes what has expired and reports the space freed. Returns when to run again, or null when nothing is held. */
  async sweep(): Promise<number | null> {
    const now = this.d.now();
    let next: number | null = null;
    for (const t of this.d.repo.all()) {
      const at = expiresAt(t.uploadedAt, t.collectedAt);
      if (at <= now) {
        const blob = this.store(t);
        await blob?.remove(this.key(t.takeId), t.handle, t.status === 'ready').catch(() => undefined);
        this.d.repo.remove(t.takeId);
        await this.d.report(t.backing, this.key(t.takeId), 0).catch(() => undefined);
      } else next = next === null ? at : Math.min(next, at);
    }
    return next;
  }
}
