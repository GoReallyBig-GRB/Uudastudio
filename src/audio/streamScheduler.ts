/**
 * Plays one clip of a streamed (file-backed) asset: reads short segments ahead of the playhead and schedules them
 * back-to-back, sample-exact, into the same gain node the clip's fades and level use. At most `lookaheadSeconds`
 * of audio is ever in memory per clip, so long files cost the same memory as short ones.
 * The scheduler only needs a tiny slice of the Web Audio API, so it can be driven by a fake clock in tests.
 */
export interface SchedulerContext {
  readonly currentTime: number;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer;
  createBufferSource(): AudioBufferSourceNode;
}

export interface StreamedClipOptions {
  ctx: SchedulerContext;
  destination: AudioNode;
  /** Reads planar channel data for [startFrame, startFrame + frames). May return fewer frames at the end of the file. */
  read: (startFrame: number, frames: number) => Promise<Float32Array[]>;
  channels: number;
  sampleRate: number;
  /** First source frame to play, and how many frames of the clip window to play. */
  startFrame: number;
  frames: number;
  /** AudioContext time at which `startFrame` should sound. */
  when: number;
  /** First segment, if already read (lets playback start without waiting for the disk). */
  preloaded?: Float32Array[] | null;
  /** Whole seconds, so segment boundaries land exactly on the output sample grid for common sample rates. */
  segmentSeconds?: number;
  lookaheadSeconds?: number;
  /** Injected for tests. */
  wait?: (ms: number) => Promise<void>;
  /** Called if reading fails (e.g. the stored files were removed). */
  onError?: (error: unknown) => void;
}

/** A start further behind the clock than this skips audio to stay in sync instead of playing late. */
const LATE_SKIP_THRESHOLD_SECONDS = 0.05;

export class StreamedClipPlayer {
  private stopped = false;
  private sources = new Set<AudioBufferSourceNode>();
  private segments = 0;
  /** Resolves when every segment has been scheduled (or playback was stopped). */
  readonly done: Promise<void>;
  private resolveDone: () => void = () => {};

  constructor(private readonly o: StreamedClipOptions) {
    this.done = new Promise<void>((resolve) => { this.resolveDone = resolve; });
  }

  get scheduledSegmentCount(): number { return this.segments; }
  get liveSourceCount(): number { return this.sources.size; }

  start(): void {
    void this.pump().then(() => this.resolveDone(), (e) => { this.o.onError?.(e); this.resolveDone(); });
  }

  stop(): void {
    this.stopped = true;
    for (const s of this.sources) {
      try { s.onended = null; s.stop(); s.disconnect(); } catch { /* already stopped */ }
    }
    this.sources.clear();
    this.resolveDone();
  }

  private async pump(): Promise<void> {
    const { ctx, read, sampleRate: sr, channels } = this.o;
    const wait = this.o.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const segFrames = Math.max(1, Math.round((this.o.segmentSeconds ?? 10) * sr));
    const lookahead = this.o.lookaheadSeconds ?? 30;
    const end = this.o.startFrame + this.o.frames;
    let frame = this.o.startFrame;
    let when = this.o.when;
    let preloaded = this.o.preloaded ?? null;

    while (!this.stopped && frame < end) {
      if (!preloaded && when - ctx.currentTime > lookahead) { await wait(250); continue; }
      const n = Math.min(segFrames, end - frame);
      const data = preloaded ?? await read(frame, n);
      preloaded = null;
      if (this.stopped) return;
      const got = data.length === 0 ? 0 : Math.min(n, ...data.map((d) => d.length));
      if (got <= 0) return; // end of stored audio

      // If reading made us late by more than a blink, drop the frames that are already in the past so the clip
      // stays in sync with the rest of the mix instead of drifting behind.
      const late = ctx.currentTime - when;
      const skip = late > LATE_SKIP_THRESHOLD_SECONDS ? Math.min(got, Math.ceil(late * sr)) : 0;
      if (skip < got) this.schedule(data, channels, skip, got - skip, sr, when + skip / sr);
      frame += got;
      when += got / sr;
    }
  }

  private schedule(data: Float32Array[], channels: number, offset: number, length: number, sr: number, when: number): void {
    const buffer = this.o.ctx.createBuffer(channels, length, sr);
    for (let c = 0; c < channels; c++) {
      buffer.copyToChannel(data[Math.min(c, data.length - 1)].subarray(offset, offset + length) as Float32Array<ArrayBuffer>, 0 + c);
    }
    const source = this.o.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.o.destination);
    source.onended = () => { this.sources.delete(source); };
    this.sources.add(source);
    this.segments++;
    source.start(when);
  }
}
