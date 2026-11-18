/**
 * The host's mixing desk for a broadcast. Every guest's incoming sound goes through its own channel strip, then to:
 *  - the host's headphones (monitor),
 *  - the program bus (what goes on air, through the master limiter),
 *  - the private mix of every OTHER guest. A guest's private mix is the host's microphone plus the other guests, never that guest's own voice (mix-minus).
 * Only the Web Audio graph lives here; no screen, no network.
 */

/** The small part of the Web Audio API the desk uses, so the wiring can be tested without a browser */
export interface MixNode { connect(to: MixNode): unknown; disconnect(to?: MixNode): unknown }
export interface MixParam { value: number }
export interface MixGain extends MixNode { gain: MixParam }
export interface MixFilter extends MixNode { type: string; frequency: MixParam; gain: MixParam; Q: MixParam }
export interface MixComp extends MixNode { threshold: MixParam; knee: MixParam; ratio: MixParam; attack: MixParam; release: MixParam }
export interface MixAnalyser extends MixNode { fftSize: number; getFloatTimeDomainData(a: Float32Array): void }
export interface MixDest extends MixNode { stream: MediaStream }
export interface MixCtx {
  destination: MixNode;
  createGain(): MixGain;
  createBiquadFilter(): MixFilter;
  createDynamicsCompressor(): MixComp;
  createAnalyser(): MixAnalyser;
  createMediaStreamSource(s: MediaStream): MixNode;
  createMediaStreamDestination(): MixDest;
}

export interface StripSettings {
  /** Fader, 0 to 2 (1 = as received) */
  volume: number;
  muted: boolean;
  /** Removes rumble and desk thumps below 80 Hz */
  lowCut: boolean;
  /** Evens out loud and soft speech */
  compressor: boolean;
  /** Presence boost around 3.5 kHz in dB, -6 to +6 */
  presence: number;
}
export const DEFAULT_STRIP: StripSettings = { volume: 1, muted: false, lowCut: true, compressor: true, presence: 0 };

export const clampStrip = (p: Partial<StripSettings>): Partial<StripSettings> => {
  const o: Partial<StripSettings> = {};
  if (typeof p.volume === 'number' && Number.isFinite(p.volume)) o.volume = Math.max(0, Math.min(2, p.volume));
  if (typeof p.presence === 'number' && Number.isFinite(p.presence)) o.presence = Math.max(-6, Math.min(6, p.presence));
  if (typeof p.muted === 'boolean') o.muted = p.muted;
  if (typeof p.lowCut === 'boolean') o.lowCut = p.lowCut;
  if (typeof p.compressor === 'boolean') o.compressor = p.compressor;
  return o;
};

interface Strip {
  id: string;
  src: MixNode | null;
  hpf: MixFilter;
  presence: MixFilter;
  comp: MixComp;
  fader: MixGain;
  out: MixGain;
  meter: MixAnalyser;
  /** This guest's private mix (host + the other guests) and where it leaves the desk */
  mixMinus: MixGain;
  dest: MixDest;
  settings: StripSettings;
}

export class HostMixer {
  private strips = new Map<string, Strip>();
  private hostSrc: MixNode | null = null;
  private readonly hostFader: MixGain;
  private readonly monitor: MixGain;
  private readonly programSum: MixGain;
  private readonly master: MixComp;
  private readonly programDest: MixDest;
  private readonly buf = new Float32Array(512);

  constructor(private readonly ctx: MixCtx) {
    this.hostFader = ctx.createGain();
    this.monitor = ctx.createGain();
    this.programSum = ctx.createGain();
    this.master = ctx.createDynamicsCompressor();
    // A brick-wall style safety limiter on the way out
    this.master.threshold.value = -2; this.master.knee.value = 0; this.master.ratio.value = 20; this.master.attack.value = 0.003; this.master.release.value = 0.1;
    this.programDest = ctx.createMediaStreamDestination();
    this.hostFader.connect(this.programSum);
    this.programSum.connect(this.master);
    this.master.connect(this.programDest);
    this.monitor.connect(ctx.destination);
  }

  /** What leaves the desk for the air: the host and every guest, limited */
  get program(): MediaStream { return this.programDest.stream; }

  setHostMic(stream: MediaStream | null): void {
    if (this.hostSrc) { try { this.hostSrc.disconnect(); } catch { /* already apart */ } this.hostSrc = null; }
    if (!stream) return;
    this.hostSrc = this.ctx.createMediaStreamSource(stream);
    this.hostSrc.connect(this.hostFader);
  }

  setHostMuted(m: boolean): void { this.hostFader.gain.value = m ? 0 : 1; }

  private hostOnProgram = true;
  /**
   * Whether the host's own microphone is part of the program. Turn it off when the microphone is wired to a hardware mixer that already
   * puts the host on air: otherwise the host would go out twice, slightly apart, and sound doubled. Guests still hear the host either way.
   */
  setProgramIncludesHost(on: boolean): void {
    if (on === this.hostOnProgram) return;
    this.hostOnProgram = on;
    if (on) this.hostFader.connect(this.programSum);
    else { try { this.hostFader.disconnect(this.programSum); } catch { /* already apart */ } }
  }
  get programIncludesHost(): boolean { return this.hostOnProgram; }

  has(id: string): boolean { return this.strips.has(id); }

  /** The strip and the guest's private mix exist from the moment the guest connects, so the host can start sending that mix before the guest's own sound arrives */
  addGuest(id: string, stream: MediaStream | null, settings: Partial<StripSettings> = {}): void {
    if (this.strips.has(id)) this.removeGuest(id);
    const c = this.ctx;
    const s: Strip = {
      id, src: null, hpf: c.createBiquadFilter(), presence: c.createBiquadFilter(), comp: c.createDynamicsCompressor(),
      fader: c.createGain(), out: c.createGain(), meter: c.createAnalyser(), mixMinus: c.createGain(), dest: c.createMediaStreamDestination(),
      settings: { ...DEFAULT_STRIP, ...clampStrip(settings) },
    };
    s.hpf.type = 'highpass'; s.hpf.Q.value = 0.707;
    s.presence.type = 'peaking'; s.presence.frequency.value = 3500; s.presence.Q.value = 0.8;
    s.comp.knee.value = 12; s.comp.attack.value = 0.005; s.comp.release.value = 0.15;
    s.meter.fftSize = this.buf.length;
    // strip: source -> low cut -> presence -> compressor -> fader -> out
    s.hpf.connect(s.presence); s.presence.connect(s.comp); s.comp.connect(s.fader); s.fader.connect(s.out); s.out.connect(s.meter);
    // this guest's private mix leaves the desk on its own stream
    s.mixMinus.connect(s.dest);
    this.hostFader.connect(s.mixMinus);
    // the strip feeds the host's headphones, the program, and every other guest's private mix, but never its own
    s.out.connect(this.monitor);
    s.out.connect(this.programSum);
    for (const o of this.strips.values()) { s.out.connect(o.mixMinus); o.out.connect(s.mixMinus); }
    this.strips.set(id, s);
    this.apply(s);
    if (stream) this.attachSource(id, stream);
  }

  /** Connects (or replaces) the guest's incoming sound */
  attachSource(id: string, stream: MediaStream): void {
    const s = this.strips.get(id);
    if (!s) return;
    if (s.src) { try { s.src.disconnect(); } catch { /* already apart */ } }
    s.src = this.ctx.createMediaStreamSource(stream);
    s.src.connect(s.hpf);
  }

  removeGuest(id: string): void {
    const s = this.strips.get(id);
    if (!s) return;
    this.strips.delete(id);
    for (const o of this.strips.values()) { try { s.out.disconnect(o.mixMinus); } catch { /* not joined */ } try { o.out.disconnect(s.mixMinus); } catch { /* not joined */ } }
    for (const n of [...(s.src ? [s.src] : []), s.hpf, s.presence, s.comp, s.fader, s.out, s.meter, s.mixMinus]) { try { n.disconnect(); } catch { /* already apart */ } }
    try { this.hostFader.disconnect(s.mixMinus); } catch { /* already apart */ }
  }

  /** The sound this guest should hear: the host and the other guests */
  mixMinusStream(id: string): MediaStream | null { return this.strips.get(id)?.dest.stream ?? null; }

  setStrip(id: string, patch: Partial<StripSettings>): StripSettings | null {
    const s = this.strips.get(id);
    if (!s) return null;
    s.settings = { ...s.settings, ...clampStrip(patch) };
    this.apply(s);
    return s.settings;
  }

  settingsOf(id: string): StripSettings | null { return this.strips.get(id)?.settings ?? null; }

  private apply(s: Strip): void {
    const { settings: v } = s;
    s.hpf.frequency.value = v.lowCut ? 80 : 10;
    s.presence.gain.value = v.presence;
    // "off" for the compressor means a ratio of 1: nothing is squeezed
    s.comp.threshold.value = v.compressor ? -24 : 0; s.comp.ratio.value = v.compressor ? 3 : 1;
    s.fader.gain.value = v.volume;
    s.out.gain.value = v.muted ? 0 : 1;
  }

  /** A 0 to 1 level (about -60 dB to 0 dB) and whether the signal touched full scale since the last read */
  level(id: string): { level: number; clipping: boolean } {
    const s = this.strips.get(id);
    if (!s) return { level: 0, clipping: false };
    const buf = this.buf.length === s.meter.fftSize ? this.buf : new Float32Array(s.meter.fftSize);
    s.meter.getFloatTimeDomainData(buf);
    let sum = 0, peak = 0;
    for (const x of buf) { sum += x * x; peak = Math.max(peak, Math.abs(x)); }
    const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-6);
    return { level: Math.max(0, Math.min(1, (db + 60) / 60)), clipping: peak >= 0.99 };
  }

  close(): void {
    for (const id of [...this.strips.keys()]) this.removeGuest(id);
    this.setHostMic(null);
    for (const n of [this.hostFader, this.monitor, this.programSum, this.master]) { try { n.disconnect(); } catch { /* already apart */ } }
  }
}
