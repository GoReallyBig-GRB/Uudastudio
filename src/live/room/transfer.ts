/**
 * Hand-over of a guest's full-quality recording to the host, over a data channel on the call connection.
 * The recording is sent in small numbered pieces (24-bit, so nothing audible is lost), each with its own check.
 * The receiver tells the sender where to continue, so a dropped connection resumes instead of starting again.
 * Nothing here touches the browser: the pieces are tested with a fake connection.
 */
import type { StreamedMeta } from '../../assets/streamedStore';
import { EnvelopeBuilder } from './activity';

export interface TakeOffer { takeId: string; name: string; sampleRate: number; channels: number; frames: number; startAt: number; stopAt: number | null; roomStartMs: number }
export type Control =
  | ({ t: 'offer' } & TakeOffer)
  | { t: 'want'; takeId: string; fromFrame: number }
  | { t: 'end'; takeId: string }
  | { t: 'done'; takeId: string }
  | { t: 'refuse'; takeId: string; reason: string };

// ---- packing -------------------------------------------------------------------------------------------------------------------

const BYTES = 3;
const MAX24 = 8_388_607;

/** Planar float samples to 24-bit little-endian, channel after channel */
export function pack24(planar: Float32Array[]): Uint8Array {
  const n = planar[0]?.length ?? 0;
  const out = new Uint8Array(n * planar.length * BYTES);
  let o = 0;
  for (const ch of planar) {
    for (let i = 0; i < n; i++) {
      const v = Math.round(Math.max(-1, Math.min(1, ch[i])) * MAX24);
      out[o++] = v & 0xff; out[o++] = (v >> 8) & 0xff; out[o++] = (v >> 16) & 0xff;
    }
  }
  return out;
}

export function unpack24(bytes: Uint8Array, channels: number, frames: number): Float32Array[] {
  const out: Float32Array[] = [];
  let o = 0;
  for (let c = 0; c < channels; c++) {
    const ch = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      let v = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
      if (v & 0x800000) v -= 0x1000000;
      ch[i] = v / (MAX24 + 1);
      o += BYTES;
    }
    out.push(ch);
  }
  return out;
}

const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const HEADER_BYTES = 12;
/** One numbered piece: where it starts, how many frames, a check, then the samples */
export function encodeChunk(startFrame: number, planar: Float32Array[]): ArrayBuffer {
  const body = pack24(planar);
  const buf = new ArrayBuffer(HEADER_BYTES + body.length);
  const dv = new DataView(buf);
  dv.setUint32(0, startFrame); dv.setUint32(4, planar[0]?.length ?? 0); dv.setUint32(8, crc32(body));
  new Uint8Array(buf, HEADER_BYTES).set(body);
  return buf;
}

export function decodeChunk(buf: ArrayBuffer, channels: number): { startFrame: number; frames: number; planar: Float32Array[] } | null {
  if (buf.byteLength < HEADER_BYTES) return null;
  const dv = new DataView(buf);
  const startFrame = dv.getUint32(0), frames = dv.getUint32(4), check = dv.getUint32(8);
  const body = new Uint8Array(buf, HEADER_BYTES);
  if (body.length !== frames * channels * BYTES || crc32(body) !== check) return null;
  return { startFrame, frames, planar: unpack24(body, channels, frames) };
}

// ---- receiving (the host) ------------------------------------------------------------------------------------------------------

export interface TakeSink { write(planar: Float32Array[]): Promise<void>; finish(): Promise<StreamedMeta>; abort(): Promise<void> }
export type SinkFactory = (offer: TakeOffer) => Promise<TakeSink>;

const MAX_FRAMES = 192_000 * 3600 * 6;
export const validOffer = (o: TakeOffer): string | null => {
  if (typeof o.takeId !== 'string' || o.takeId.length === 0 || o.takeId.length > 80) return 'Not a valid take.';
  if (!Number.isInteger(o.channels) || o.channels < 1 || o.channels > 2) return 'Unsupported channels.';
  if (!Number.isFinite(o.sampleRate) || o.sampleRate < 8000 || o.sampleRate > 192_000) return 'Unsupported sample rate.';
  if (!Number.isInteger(o.frames) || o.frames <= 0 || o.frames > MAX_FRAMES) return 'Unsupported length.';
  return null;
};

/** One guest's end of the hand-over. Handles one take at a time and remembers where it is, so a returning guest carries on. */
export class TakeReceiver {
  private cur: { offer: TakeOffer; sink: TakeSink; written: number } | null = null;
  private finished = new Set<string>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly makeSink: SinkFactory, private readonly reply: (c: Control) => void, private readonly onTake: (offer: TakeOffer, meta: StreamedMeta) => void) {}

  /** Progress of the take being received, 0 to 1 */
  get progress(): { takeId: string; fraction: number } | null { return this.cur ? { takeId: this.cur.offer.takeId, fraction: this.cur.written / this.cur.offer.frames } : null; }

  private run(fn: () => Promise<void>): Promise<void> { this.queue = this.queue.then(fn, fn); return this.queue; }

  onText(text: string): Promise<void> {
    let m: Control;
    try { m = JSON.parse(text) as Control; } catch { return Promise.resolve(); }
    return this.run(async () => {
      if (m.t === 'offer') return this.offer(m);
      if (m.t === 'end') return this.end(m.takeId);
    });
  }

  onBinary(buf: ArrayBuffer): Promise<void> {
    return this.run(async () => {
      const c = this.cur;
      if (!c) return;
      const chunk = decodeChunk(buf, c.offer.channels);
      if (!chunk || chunk.startFrame !== c.written || c.written + chunk.frames > c.offer.frames) { this.reply({ t: 'want', takeId: c.offer.takeId, fromFrame: c.written }); return; }
      try { await c.sink.write(chunk.planar); } catch { await this.drop(); this.reply({ t: 'refuse', takeId: c.offer.takeId, reason: 'This computer could not save the recording. Check there is free space.' }); return; }
      c.written += chunk.frames;
    });
  }

  private async offer(o: TakeOffer): Promise<void> {
    const bad = validOffer(o);
    if (bad) { this.reply({ t: 'refuse', takeId: String(o.takeId), reason: bad }); return; }
    if (this.finished.has(o.takeId)) { this.reply({ t: 'done', takeId: o.takeId }); return; }
    if (this.cur && this.cur.offer.takeId === o.takeId && this.cur.offer.frames === o.frames) { this.reply({ t: 'want', takeId: o.takeId, fromFrame: this.cur.written }); return; }
    await this.drop();
    try { this.cur = { offer: o, sink: await this.makeSink(o), written: 0 }; } catch { this.reply({ t: 'refuse', takeId: o.takeId, reason: 'This computer cannot keep the recording.' }); return; }
    this.reply({ t: 'want', takeId: o.takeId, fromFrame: 0 });
  }

  private async end(takeId: string): Promise<void> {
    const c = this.cur;
    if (!c || c.offer.takeId !== takeId) { if (this.finished.has(takeId)) this.reply({ t: 'done', takeId }); return; }
    if (c.written !== c.offer.frames) { this.reply({ t: 'want', takeId, fromFrame: c.written }); return; }
    try {
      const meta = await c.sink.finish();
      this.cur = null; this.finished.add(takeId);
      this.onTake(c.offer, meta);
      this.reply({ t: 'done', takeId });
    } catch { await this.drop(); this.reply({ t: 'refuse', takeId, reason: 'The recording could not be finished.' }); }
  }

  private async drop(): Promise<void> { const c = this.cur; this.cur = null; if (c) await c.sink.abort().catch(() => undefined); }
  /** The guest left for good, or the room closed */
  close(): Promise<void> { return this.run(() => this.drop()); }
}

// ---- sending (the guest) -------------------------------------------------------------------------------------------------------

export interface SenderIO { sendText(s: string): void; sendBinary(b: ArrayBuffer): void; buffered(): number }
export interface SenderOptions {
  chunkFrames?: number;
  /** Keeps the hand-over from crowding the voice call */
  maxBytesPerSec?: number;
  highWater?: number;
  /** Return true to hold off (for example while recording or when the call is struggling) */
  paused?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  replyTimeoutMs?: number;
}
export type SendResult = 'done' | 'refused' | 'aborted';

export class TakeSender {
  private waiters: Array<(c: Control) => void> = [];
  private stopped = false;
  private want: number | null = null;
  refusal = '';

  constructor(private readonly io: SenderIO, private readonly read: (startFrame: number, frames: number) => Promise<Float32Array[]>, private readonly o: SenderOptions = {}) {}

  /** Feed in what the receiver sent back */
  onText(text: string): void {
    let m: Control;
    try { m = JSON.parse(text) as Control; } catch { return; }
    const w = this.waiters; this.waiters = [];
    w.forEach((f) => f(m));
    if (m.t === 'want') this.want = m.fromFrame;
  }
  abort(): void { this.stopped = true; const w = this.waiters; this.waiters = []; w.forEach((f) => f({ t: 'refuse', takeId: '', reason: 'stopped' })); }

  private next(takeId: string): Promise<Control | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== fn); resolve(null); }, this.o.replyTimeoutMs ?? 20_000);
      const fn = (c: Control) => { clearTimeout(timer); resolve('takeId' in c && c.takeId !== takeId && c.takeId !== '' ? null : c); };
      this.waiters.push(fn);
    });
  }

  async send(offer: TakeOffer, onProgress: (fraction: number) => void = () => undefined): Promise<SendResult> {
    const sleep = this.o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const chunkFrames = this.o.chunkFrames ?? 8192;
    const bytesPerFrame = offer.channels * BYTES;
    this.stopped = false; this.want = null;
    const first = this.next(offer.takeId);
    this.io.sendText(JSON.stringify({ t: 'offer', ...offer }));
    let reply = await first;
    for (let round = 0; round < 50; round++) {
      if (this.stopped || !reply) return 'aborted';
      if (reply.t === 'done') { onProgress(1); return 'done'; }
      if (reply.t === 'refuse') { this.refusal = reply.reason; return this.stopped ? 'aborted' : 'refused'; }
      if (reply.t !== 'want') return 'aborted';
      this.want = null;
      let from = reply.fromFrame;
      while (from < offer.frames) {
        if (this.stopped) return 'aborted';
        while (this.o.paused?.() && !this.stopped) await sleep(250);
        while (this.io.buffered() > (this.o.highWater ?? 262_144) && !this.stopped) await sleep(50);
        if (this.want !== null) { from = this.want; this.want = null; continue; } // the receiver asked for a different place
        const n = Math.min(chunkFrames, offer.frames - from);
        const planar = await this.read(from, n);
        if (planar.length === 0 || planar[0].length !== n) return 'aborted';
        const t0 = Date.now();
        this.io.sendBinary(encodeChunk(from, planar));
        from += n;
        onProgress(from / offer.frames);
        const wait = (n * bytesPerFrame * 1000) / (this.o.maxBytesPerSec ?? 200_000) - (Date.now() - t0);
        if (wait > 1) await sleep(wait);
      }
      const answer = this.next(offer.takeId);
      this.io.sendText(JSON.stringify({ t: 'end', takeId: offer.takeId }));
      reply = await answer;
    }
    return 'aborted';
  }
}

// ---- placing the file on the host's timeline -----------------------------------------------------------------------------------

/** Room-time difference to frames: positive when the guest's recording began after the host's */
export function padFramesFor(guestStartMs: number, hostStartMs: number | null, sampleRate: number, maxSeconds = 30): number {
  if (hostStartMs === null || !Number.isFinite(guestStartMs) || !Number.isFinite(hostStartMs)) return 0;
  const s = (guestStartMs - hostStartMs) / 1000;
  return Math.abs(s) > maxSeconds ? 0 : Math.round(s * sampleRate);
}

/**
 * Wraps the place the file is written so it lines up with the host's own recording:
 * silence is added at the start when the guest began later, and the start is trimmed when the guest began earlier.
 * It also builds the loudness record of what the guest sent, to compare with what the host heard.
 */
export class AlignedSink implements TakeSink {
  private lead: number;
  private skip: number;
  readonly envelope: EnvelopeBuilder;
  constructor(private readonly inner: TakeSink, padFrames: number, sampleRate: number, private readonly channels: number) {
    this.lead = Math.max(0, padFrames); this.skip = Math.max(0, -padFrames); this.envelope = new EnvelopeBuilder(sampleRate);
  }

  async write(planar: Float32Array[]): Promise<void> {
    this.envelope.push(planar[0]);
    let data = planar;
    if (this.skip > 0) { const cut = Math.min(this.skip, planar[0].length); data = planar.map((c) => c.subarray(cut)); this.skip -= cut; }
    if (data[0].length === 0) return;
    if (this.lead > 0) { const silence = Array.from({ length: this.channels }, () => new Float32Array(this.lead)); this.lead = 0; await this.inner.write(silence); }
    await this.inner.write(data);
  }
  finish(): Promise<StreamedMeta> { return this.inner.finish(); }
  abort(): Promise<void> { return this.inner.abort(); }
}
