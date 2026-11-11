/**
 * Records the microphone to 16-bit mono PCM blocks. Each block is handed out as it arrives, so the page can save it to disk and a
 * reload or crash does not lose the take. No effects: no echo cancellation, noise suppression or auto gain, so the producer gets raw audio.
 */
import { floatToPcm, type Bits, type Pcm } from './wavWriter';
import { blockInfo, type BlockInfo } from './levelMeter';
import { readSettings, type CaptureSettings } from './captureSettings';
import { mixBlock, newMixState, type ChannelMode } from './channels';

const WORKLET = `
class Cap extends AudioWorkletProcessor {
  constructor(){ super(); this.a = new Float32Array(4096); this.b = new Float32Array(4096); this.n = 0; }
  process(inputs){
    const l = inputs[0] && inputs[0][0], r = inputs[0] && inputs[0][1];
    if (l) {
      for (let i = 0; i < l.length; i++) {
        this.a[this.n] = l[i]; this.b[this.n] = r ? r[i] : 0; this.n++;
        if (this.n === 4096) { this.port.postMessage({ a: this.a.slice(0), b: r ? this.b.slice(0) : null }); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('uuda-cap', Cap);`;

export interface CaptureHandlers {
  /** A block of audio, ready to store */
  onBlock: (pcm: Pcm, index: number) => void;
  /** Peak level 0..1 of the latest block, for the meter */
  onLevel: (peak: number) => void;
  /** Peak and a plosive guess for the latest block, for the meter's advice */
  onInfo?: (info: BlockInfo) => void;
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
  /** What the browser actually gave us (it may ignore what was asked) */
  settings: CaptureSettings = {};
  /** Sample size of what is recorded */
  bits: Bits = 16;
  /** Name of the microphone the browser gave us */
  label = '';
  /** How the channels were combined (updates as the take goes) */
  channelMode: ChannelMode = 'mono';
  private mix = newMixState();

  async start(h: CaptureHandlers, deviceId?: string, bits: Bits = 16): Promise<void> {
    this.bits = bits;
    // Two channels are asked for so a USB or lavalier mic that is stereo is seen as it is; they are mixed to one below
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const track = this.stream.getAudioTracks()[0];
    this.label = track?.label ?? '';
    this.settings = track ? readSettings(track) : {};
    this.mix = newMixState();
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.sampleRate = this.ctx.sampleRate;
    const source = this.ctx.createMediaStreamSource(this.stream);
    const gate = this.ctx.createGain();
    gate.gain.value = 0; // keeps the graph running without playing the microphone back
    const push = (left: Float32Array, right: Float32Array | null) => {
      if (!this.running) return;
      const m = mixBlock(left, right, this.mix);
      this.channelMode = m.mode;
      const info = blockInfo(m.out, this.sampleRate);
      h.onLevel(info.peak);
      h.onInfo?.(info);
      h.onBlock(floatToPcm(m.out, this.bits), this.index++);
    };
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const w = new AudioWorkletNode(this.ctx, 'uuda-cap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit', outputChannelCount: [1] });
      w.port.onmessage = (e: MessageEvent<{ a: Float32Array; b: Float32Array | null }>) => push(e.data.a, e.data.b);
      source.connect(w);
      w.connect(gate);
      this.node = w;
    } catch {
      // Older browsers: the same thing with a script processor
      const p = this.ctx.createScriptProcessor(4096, 2, 1);
      p.onaudioprocess = (e) => push(new Float32Array(e.inputBuffer.getChannelData(0)), e.inputBuffer.numberOfChannels > 1 ? new Float32Array(e.inputBuffer.getChannelData(1)) : null);
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
