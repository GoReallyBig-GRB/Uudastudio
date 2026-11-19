import { EnvelopeBuilder } from './activity';

/** Keeps a loudness record of each guest's voice as it arrives in the call. It stores ten numbers a second and no audio. */
export class ActivityWatch {
  private ctx: AudioContext | null = null;
  private items = new Map<string, { src: MediaStreamAudioSourceNode; node: ScriptProcessorNode; mute: GainNode; env: EnvelopeBuilder; startMs: number }>();

  async add(id: string, stream: MediaStream, startMs: number): Promise<void> {
    if (this.items.has(id)) return;
    if (!this.ctx) { this.ctx = new AudioContext(); await this.ctx.resume().catch(() => undefined); }
    const ctx = this.ctx;
    const env = new EnvelopeBuilder(ctx.sampleRate);
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const mute = ctx.createGain(); mute.gain.value = 0;
    node.onaudioprocess = (e) => env.push(e.inputBuffer.getChannelData(0));
    src.connect(node); node.connect(mute); mute.connect(ctx.destination);
    this.items.set(id, { src, node, mute, env, startMs });
  }

  has(id: string): boolean { return this.items.has(id); }

  stop(id: string): { bins: Uint8Array; seconds: number; startMs: number } | null {
    const it = this.items.get(id);
    if (!it) return null;
    this.items.delete(id);
    it.node.onaudioprocess = null;
    try { it.src.disconnect(); it.node.disconnect(); it.mute.disconnect(); } catch { /* done */ }
    return { bins: it.env.bins, seconds: it.env.seconds, startMs: it.startMs };
  }

  stopAll(): Map<string, { bins: Uint8Array; seconds: number; startMs: number }> {
    const out = new Map<string, { bins: Uint8Array; seconds: number; startMs: number }>();
    for (const id of [...this.items.keys()]) { const r = this.stop(id); if (r) out.set(id, r); }
    void this.ctx?.close().catch(() => undefined); this.ctx = null;
    return out;
  }
}
