import { createStreamedWriter, type StreamedWriter } from '../../assets/streamedWriter';
import type { StreamedMeta } from '../../assets/streamedStore';

/**
 * The host's own copy of one guest's voice as it arrives in the call, written straight to disk while a take runs.
 * It does not depend on anything the guest does afterwards: the guest cannot delete it, stop it or change it.
 * It is call quality, not studio quality, and it is also the reference the guest's full recording is checked against.
 */
export class SafetyCopy {
  private writer: StreamedWriter | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private chain: Promise<void> = Promise.resolve();
  private frames = 0;
  private rate = 48_000;

  get seconds(): number { return this.frames / this.rate; }

  async begin(stream: MediaStream): Promise<void> {
    const ctx = new AudioContext();
    await ctx.resume().catch(() => undefined);
    this.ctx = ctx; this.rate = ctx.sampleRate;
    this.writer = await createStreamedWriter(`livecopy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, ctx.sampleRate, 1);
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const mute = ctx.createGain(); mute.gain.value = 0;
    node.onaudioprocess = (e) => {
      const block = new Float32Array(e.inputBuffer.getChannelData(0));
      this.frames += block.length;
      const w = this.writer;
      if (w) this.chain = this.chain.then(() => w.write([block])).catch(() => undefined);
    };
    src.connect(node); node.connect(mute); mute.connect(ctx.destination);
    this.node = node;
  }

  async finish(): Promise<StreamedMeta | null> {
    const w = this.writer; this.writer = null;
    if (this.node) { this.node.onaudioprocess = null; try { this.node.disconnect(); } catch { /* done */ } }
    await this.chain;
    void this.ctx?.close().catch(() => undefined); this.ctx = null;
    if (!w) return null;
    if (this.frames === 0) { await w.abort(); return null; }
    return w.finish();
  }
}
