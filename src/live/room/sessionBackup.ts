import { createStreamedWriter, type StreamedWriter } from '../../assets/streamedWriter';
import type { StreamedMeta } from '../../assets/streamedStore';

/**
 * One file of the whole session, kept on the host's computer: the host's microphone plus every guest, mixed together and written straight to disk.
 * It is its own mix. It is never played, and it does not depend on what Program contains, so the host is always in it and never doubled on air.
 * It is call quality for the guests, and it exists in case something happens to the individual recordings.
 */
export class SessionBackup {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private node: ScriptProcessorNode | null = null;
  private writer: StreamedWriter | null = null;
  private chain: Promise<void> = Promise.resolve();
  private sources = new Map<string, { src: MediaStreamAudioSourceNode; gain: GainNode }>();
  private frames = 0;
  private rate = 48_000;

  get seconds(): number { return this.frames / this.rate; }

  async begin(): Promise<void> {
    const ctx = new AudioContext();
    await ctx.resume().catch(() => undefined);
    this.ctx = ctx; this.rate = ctx.sampleRate;
    this.writer = await createStreamedWriter(`livebackup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, ctx.sampleRate, 1);
    const master = ctx.createGain();
    // Several voices added together can pass full scale; a gentle limiter keeps the sum clean
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.003; limiter.release.value = 0.15;
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const mute = ctx.createGain(); mute.gain.value = 0;
    node.onaudioprocess = (e) => {
      const block = new Float32Array(e.inputBuffer.getChannelData(0));
      this.frames += block.length;
      const w = this.writer;
      if (w) this.chain = this.chain.then(() => w.write([block])).catch(() => undefined);
    };
    master.connect(limiter); limiter.connect(node); node.connect(mute); mute.connect(ctx.destination);
    this.master = master; this.node = node;
  }

  /** id is the host's own id or a guest's. A stream that is already there is left alone. */
  add(id: string, stream: MediaStream | null): void {
    const ctx = this.ctx, master = this.master;
    if (!ctx || !master || !stream || this.sources.has(id) || stream.getAudioTracks().length === 0) return;
    const src = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain(); gain.gain.value = 0.8;
    src.connect(gain); gain.connect(master);
    this.sources.set(id, { src, gain });
  }

  remove(id: string): void {
    const s = this.sources.get(id);
    if (!s) return;
    this.sources.delete(id);
    try { s.src.disconnect(); s.gain.disconnect(); } catch { /* done */ }
  }

  ids(): string[] { return [...this.sources.keys()]; }

  async finish(): Promise<StreamedMeta | null> {
    const w = this.writer; this.writer = null;
    if (this.node) { this.node.onaudioprocess = null; try { this.node.disconnect(); } catch { /* done */ } }
    for (const id of [...this.sources.keys()]) this.remove(id);
    await this.chain;
    void this.ctx?.close().catch(() => undefined); this.ctx = null;
    if (!w) return null;
    if (this.frames === 0) { await w.abort(); return null; }
    return w.finish();
  }
}
