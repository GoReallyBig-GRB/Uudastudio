/**
 * The voice call: one audio connection to each other person in the call, using the browser's WebRTC. Audio only. Signalling travels
 * through the room. This is for talking and monitoring; recordings are made separately on each device at full quality.
 */
import { callBitrate, isPolite, micConstraints, planConnections, qualityOf, tuneOpus, type CallMode, type LinkStats, type Quality } from './callPlan';
import type { HostMixer } from './hostMixer';
import type { RoomPeer } from './roomState';

export interface CallOptions {
  myId: string;
  role: 'producer' | 'guest';
  mode: CallMode;
  /** In a broadcast a guest on headphones sends a completely untouched microphone */
  headphones: boolean;
  /** Standard or high bit rate (live settings) */
  quality?: 'standard' | 'high';
  /** Where each new guest's channel strip starts (live settings) */
  stripDefaults?: { lowCut: boolean; compressor: boolean; presence: number };
  /** The host's desk in a broadcast: guests' sound goes through it and each guest is sent their own mix-minus */
  mixer?: HostMixer;
  iceServers: RTCIceServer[];
  /** Send call set-up data to one person through the room */
  signal: (to: string, data: unknown) => void;
  onRemote: (id: string, stream: MediaStream | null) => void;
  onQuality: (id: string, q: Quality, s: LinkStats) => void;
  /** The data channel used to hand recordings over opened (or closed, with null) for one person */
  onFiles?: (id: string, channel: RTCDataChannel | null) => void;
  /** The voice arriving from one person, as heard here (null when they leave). The host keeps its own copy of it. */
  onHeard?: (id: string, stream: MediaStream | null) => void;
}

interface Link {
  pc: RTCPeerConnection;
  polite: boolean;
  making: boolean;
  ignore: boolean;
  last: { lost: number; received: number };
  /** Keeps a guest's sound flowing into the desk (some browsers only deliver a remote stream that an audio element holds) */
  keep?: HTMLAudioElement;
  timer: ReturnType<typeof setInterval>;
}

type Description = { description: RTCSessionDescriptionInit } | { candidate: RTCIceCandidateInit | null };

export class CallManager {
  private links = new Map<string, Link>();
  private local: MediaStream | null = null;
  private muted = false;

  constructor(private readonly o: CallOptions) {}

  private get desk(): HostMixer | null { return this.o.mode === 'broadcast' && this.o.role === 'producer' ? this.o.mixer ?? null : null; }

  /** Asks for the microphone. See micConstraints for what is switched on in each kind of session. */
  async start(deviceId?: string): Promise<MediaStream> {
    this.local = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(this.o.mode, this.o.headphones, deviceId) });
    this.local.getAudioTracks().forEach((t) => { t.enabled = !this.muted; });
    this.desk?.setHostMic(this.local);
    return this.local;
  }

  get stream(): MediaStream | null { return this.local; }

  setMuted(m: boolean): void {
    this.muted = m;
    this.local?.getAudioTracks().forEach((t) => { t.enabled = !m; });
    this.desk?.setHostMuted(m);
  }

  /** Brings the connections in line with who is in the call */
  sync(peers: RoomPeer[], meAdmitted: boolean): void {
    if (!this.local) return;
    const plan = planConnections(this.o.myId, peers, meAdmitted, [...this.links.keys()], this.o.mode, this.o.role);
    for (const id of plan.drop) this.drop(id);
    for (const id of plan.connect) this.open(id);
  }

  private open(id: string): Link {
    const pc = new RTCPeerConnection({ iceServers: this.o.iceServers, bundlePolicy: 'max-bundle' });
    const link: Link = { pc, polite: isPolite(this.o.myId, id), making: false, ignore: false, last: { lost: 0, received: 0 }, timer: setInterval(() => { void this.poll(id); }, 2000) };
    this.links.set(id, link);

    // A second path on the same connection, for handing recordings over. Both sides make it with the same number, so it needs no extra set-up.
    const files = pc.createDataChannel('files', { negotiated: true, id: 1, ordered: true });
    files.binaryType = 'arraybuffer';
    files.onopen = () => this.o.onFiles?.(id, files);
    files.onclose = () => this.o.onFiles?.(id, null);

    // The host in a broadcast sends this guest's own mix-minus instead of the raw microphone
    const desk = this.desk;
    let outgoing: MediaStream | null = this.local;
    if (desk) { desk.addGuest(id, null, this.o.stripDefaults); outgoing = desk.mixMinusStream(id); }
    for (const track of outgoing?.getAudioTracks() ?? []) {
      const sender = pc.addTrack(track, outgoing!);
      const p = sender.getParameters();
      if (!p.encodings?.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = callBitrate(this.o.mode, this.o.quality);
      void sender.setParameters(p).catch(() => undefined);
    }
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      this.o.onHeard?.(id, stream);
      if (this.o.mode === 'broadcast') {
        // A small steady buffer: a broadcast prefers smooth sound over the last few milliseconds of delay
        try { (e.receiver as unknown as { jitterBufferTarget?: number }).jitterBufferTarget = 120; } catch { /* not supported */ }
      }
      if (desk) {
        const el = new Audio(); el.srcObject = stream; el.muted = true; void el.play().catch(() => undefined);
        link.keep = el;
        desk.attachSource(id, stream);
        return; // the host hears guests through the desk, not directly
      }
      this.o.onRemote(id, stream);
    };
    pc.onicecandidate = (e) => this.o.signal(id, { candidate: e.candidate ? e.candidate.toJSON() : null });
    pc.onnegotiationneeded = async () => {
      try {
        link.making = true;
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') return;
        await pc.setLocalDescription({ type: 'offer', sdp: tuneOpus(offer.sdp ?? '', callBitrate(this.o.mode, this.o.quality)) });
        this.o.signal(id, { description: pc.localDescription });
      } catch { /* the next change of state tries again */ } finally { link.making = false; }
    };
    pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === 'failed') pc.restartIce(); };
    return link;
  }

  private drop(id: string): void {
    const l = this.links.get(id);
    if (!l) return;
    clearInterval(l.timer);
    if (l.keep) { l.keep.srcObject = null; }
    this.desk?.removeGuest(id);
    this.o.onFiles?.(id, null);
    this.o.onHeard?.(id, null);
    try { l.pc.close(); } catch { /* already closed */ }
    this.links.delete(id);
    this.o.onRemote(id, null);
  }

  /** Call set-up data from another person */
  async handleSignal(from: string, data: unknown): Promise<void> {
    const l = this.links.get(from) ?? (this.local ? this.open(from) : null);
    if (!l) return;
    const m = data as Description;
    const { pc } = l;
    try {
      if ('description' in m && m.description) {
        const collision = m.description.type === 'offer' && (l.making || pc.signalingState !== 'stable');
        l.ignore = !l.polite && collision;
        if (l.ignore) return;
        await pc.setRemoteDescription(m.description);
        if (m.description.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription({ type: 'answer', sdp: tuneOpus(answer.sdp ?? '', callBitrate(this.o.mode, this.o.quality)) });
          this.o.signal(from, { description: pc.localDescription });
        }
      } else if ('candidate' in m) {
        try { if (m.candidate) await pc.addIceCandidate(m.candidate); } catch (e) { if (!l.ignore) throw e; }
      }
    } catch { /* a stale or crossed message; the connection recovers on the next negotiation */ }
  }

  private async poll(id: string): Promise<void> {
    const l = this.links.get(id);
    if (!l) return;
    try {
      const report = await l.pc.getStats();
      let rtt: number | null = null, jitter: number | null = null, relayed = false, lost = 0, received = 0;
      const locals = new Map<string, { candidateType?: string }>();
      report.forEach((r) => { if (r.type === 'local-candidate') locals.set(r.id, r as { candidateType?: string }); });
      report.forEach((r) => {
        if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
          if (typeof r.currentRoundTripTime === 'number') rtt = r.currentRoundTripTime * 1000;
          relayed = locals.get(r.localCandidateId)?.candidateType === 'relay';
        }
        if (r.type === 'inbound-rtp' && r.kind === 'audio') {
          lost = r.packetsLost ?? 0; received = r.packetsReceived ?? 0;
          if (typeof r.jitter === 'number') jitter = r.jitter * 1000;
        }
      });
      const dLost = lost - l.last.lost, dRecv = received - l.last.received;
      l.last = { lost, received };
      const lossPct = dLost + dRecv > 0 ? (Math.max(0, dLost) / (dLost + dRecv)) * 100 : null;
      const stats: LinkStats = { rttMs: rtt, lossPct, relayed, jitterMs: jitter };
      this.o.onQuality(id, qualityOf(stats), stats);
    } catch { /* connection closing */ }
  }

  /** Stops the microphone and the sound but keeps the connections, so recordings still being handed over can finish */
  closeAudio(): void {
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
    this.desk?.setHostMuted(true);
  }

  close(): void {
    for (const id of [...this.links.keys()]) this.drop(id);
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
  }
}

/** A 0 to 1 level for a meter, read from a stream a few times a second */
export function watchLevel(ctx: AudioContext, stream: MediaStream, onLevel: (v: number) => void): () => void {
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  const id = setInterval(() => {
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-6);
    onLevel(Math.max(0, Math.min(1, (db + 60) / 60)));
  }, 100);
  return () => { clearInterval(id); try { src.disconnect(); } catch { /* done */ } };
}
