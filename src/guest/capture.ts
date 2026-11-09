/**
 * Records the microphone to 16-bit mono PCM blocks. Each block is handed out as it arrives, so the page can save it to disk and a
 * reload or crash does not lose the take. No effects: no echo cancellation, noise suppression or auto gain, so the producer gets raw audio.
 */
import { floatToInt16, peakOf } from './wavWriter';

const WORKLET = `
class Cap extends AudioWorkletProcessor {
  constructor(){ super(); this.buf = new Float32Array(4096); this.n = 0; }
  process(inputs){
    const ch = inputs[0] && inputs[0][0];
    if (ch) { for (let i = 0; i < ch.length; i++) { this.buf[this.n++] = ch[i]; if (this.n === 4096) { this.port.postMessage(this.buf.slice(0)); this.n = 0; } } }
    return true;
  }
}
registerProcessor('uuda-cap', Cap);`;

export interface CaptureHandlers {
  /** A block of audio, ready to store */
  onBlock: (pcm: Int16Array, index: number) => void;
  /** Peak level 0..1 of the latest block, for the meter */
  onLevel: (peak: number) => void;
  /** The microphone stopped by itself (unplugged, or taken by another app) */
  onLost: () => void;
}

export class MicCapture {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: AudioNode | null = null;
  private wake: { release: () => Promise<void> } | null = null;
  private index = 0;
  private running = false;
  sampleRate = 0;

  async start(h: CaptureHandlers): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.sampleRate = this.ctx.sampleRate;
    const source = this.ctx.createMediaStreamSource(this.stream);
    const gate = this.ctx.createGain();
    gate.gain.value = 0; // keeps the graph running without playing the microphone back
    const push = (f: Float32Array) => {
      if (!this.running) return;
      h.onLevel(peakOf(f));
      h.onBlock(floatToInt16(f), this.index++);
    };
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const w = new AudioWorkletNode(this.ctx, 'uuda-cap', { numberOfOutputs: 1, outputChannelCount: [1] });
      w.port.onmessage = (e: MessageEvent<Float32Array>) => push(e.data);
      source.connect(w);
      w.connect(gate);
      this.node = w;
    } catch {
      // Older browsers: the same thing with a script processor
      const p = this.ctx.createScriptProcessor(4096, 1, 1);
      p.onaudioprocess = (e) => push(new Float32Array(e.inputBuffer.getChannelData(0)));
      source.connect(p);
      p.connect(gate);
      this.node = p;
    }
    gate.connect(this.ctx.destination);
    this.stream.getAudioTracks()[0]?.addEventListener('ended', () => { if (this.running) h.onLost(); });
    this.running = true;
    try { this.wake = await (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null; } catch { this.wake = null; }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    try { await this.ctx?.close(); } catch { /* already closed */ }
    try { await this.wake?.release(); } catch { /* already released */ }
    this.stream = null; this.ctx = null; this.node = null; this.wake = null;
  }
}
