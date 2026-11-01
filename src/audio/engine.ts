/**
 * X-PRO AUDIO - Audio Engine
 * Pure Web Audio API engine. NO UI imports.
 * Manages AudioContext, graph nodes, playback scheduling, metering, and clip fading.
 */

import { Project, Track, Clip, Asset } from '../types';
import { pluginManager, MASTER_TRACK_ID } from '../plugins/pluginManager';
import { groupChainId, groupIdOfChain, isGroupChainId } from '../plugins/groupChain';
import { DEFAULT_GROUP_SETTINGS, groupOutputGain, groupPan } from './groupSettings';
import type { GroupSettings } from '../types';
import { buildDuckCurve, duckCurveKey, scheduleDuckCurve, clearDuck, normalizeDucking } from './ducking';
import { StreamedClipPlayer } from './streamScheduler';
import {
  CHAIN_COMPRESSOR_KNEE_DB, CHAIN_COMPRESSOR_THRESHOLD_DB, CHAIN_PRESENCE_Q, type MasteringSettings,
} from './masteringSettings';
import { readStreamedFrames } from '../assets/streamedStore';

/** Where a clip's audio starts: when (AudioContext time), which source second, and how long to play. */
export function clipPlaybackWindow(clip: Clip, currentPlayhead: number, ctxNow: number): { when: number; offsetSeconds: number; durationSeconds: number } | null {
  const clipEnd = clip.startSeconds + clip.durationSeconds;
  if (clipEnd <= currentPlayhead) return null;
  let when: number;
  let offsetSeconds: number;
  let durationSeconds: number;
  if (clip.startSeconds >= currentPlayhead) {
    when = ctxNow + (clip.startSeconds - currentPlayhead);
    offsetSeconds = clip.offsetSeconds;
    durationSeconds = clip.durationSeconds;
  } else {
    const elapsedInClip = currentPlayhead - clip.startSeconds;
    when = ctxNow;
    offsetSeconds = clip.offsetSeconds + elapsedInClip;
    durationSeconds = clip.durationSeconds - elapsedInClip;
  }
  return durationSeconds > 0 ? { when, offsetSeconds, durationSeconds } : null;
}

export interface MeterData {
  peak: number; // 0 to 1+
  rms: number;  // 0 to 1
  clip: boolean;
}

export interface MasterLiveMetering {
  peakL: number;
  peakR: number;
  rmsL: number;
  rmsR: number;
  truePeakDbTP: number;
  momentaryLUFS: number;
  shortTermLUFS: number;
  integratedLUFS: number;
  gainReductionDb: number;
  clip: boolean;
}

/** Longest stretch the rack preview loops */
const PREVIEW_MAX_SECONDS = 20;

/** Length of the short fade that removes the click when a clip starts or stops mid-wave */
const DECLICK_SECONDS = 0.008;

const clamp01to15 = (v: number): number => (Number.isFinite(v) ? Math.min(1.5, Math.max(0, v)) : 0);

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private duckingGain: GainNode | null = null;
  /** Entry point of the master plugin chain (ducking -> masterFxIn -> master plugins -> mastering stage) */
  private masterFxIn: GainNode | null = null;
  // Mastering stage of the master bus (presence EQ -> compressor -> make-up gain -> limiter); see setMastering()
  private masterEq: BiquadFilterNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private masterMakeup: GainNode | null = null;
  private mastering: { settings: MasteringSettings | null; makeupGainDb: number } = { settings: null, makeupGainDb: 0 };
  private limiter: DynamicsCompressorNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private isDucked: boolean = false;
  private isMasterMuted: boolean = false;
  private masterVolumeValue: number = 1.0;

  // Stereo L/R analysis
  private masterSplitter: ChannelSplitterNode | null = null;
  private masterLeftAnalyser: AnalyserNode | null = null;
  private masterRightAnalyser: AnalyserNode | null = null;

  // Real-time K-weighting filter branch for live BS.1770 LUFS during playback
  private kHighShelf: BiquadFilterNode | null = null;
  private kHighPass: BiquadFilterNode | null = null;
  private kWeightAnalyser: AnalyserNode | null = null;

  // Live LUFS energy rolling buffers
  private liveShortTermHistory: Array<{ time: number; power: number }> = [];
  private liveIntegratedEnergy: number[] = [];
  private leftBuffer: Float32Array = new Float32Array(512);
  private rightBuffer: Float32Array = new Float32Array(512);
  private kBuffer: Float32Array = new Float32Array(2048);

  // Track nodes: trackId -> { gainNode, panNode, analyserNode }
  private trackNodes: Map<string, {
    gainNode: GainNode;
    panNode: StereoPannerNode;
    analyserNode: AnalyserNode;
    /** Automatic ducking under other tracks (unity unless the track has it switched on) */
    duckNode: GainNode;
  }> = new Map();

  /** One bus per clip group: grouped clips are summed here, then the group's plugin chain runs once, then the master. */
  private groupBuses: Map<string, { input: GainNode; output: GainNode; level: GainNode; pan: StereoPannerNode | null; analyser: AnalyserNode }> = new Map();
  private groupSettings: Record<string, GroupSettings> = {};
  /** Group being auditioned alone: everything else is silent (monitoring only; never saved, never exported) */
  private soloGroupId: string | null = null;
  /** Single-track view with solo: only this track is heard (monitoring only; export is not affected) */
  private focusSoloTrackId: string | null = null;
  private lastTracks: Track[] = [];
  /** Temporary per-clip level multipliers (group mastering). Never saved; see audio/tempClipLevels.ts */
  private tempClipFactors: Record<string, number> = {};
  private clipTrims: Array<{ clipId: string; node: GainNode }> = [];
  /** Per-track volume/pan stages feeding the group buses for the current playback (disconnected when it stops) */

  /** Duck curves already worked out, by track, so playing again does not re-measure the audio */
  private duckCache: Map<string, { key: string; curve: Float32Array | null }> = new Map();
  /** Curve key each track currently has scheduled, so a live refresh only touches tracks that changed */
  private duckApplied: Map<string, string> = new Map();

  // Active playing source nodes & clip gain nodes to stop on pause/seek
  private activeSources: Array<{
    source: AudioBufferSourceNode;
    gainNode: GainNode;
    /** Short ramp stage after the clip gain: fades in a clip that starts mid-wave and out when stopped, so neither clicks */
    declick?: GainNode;
  }> = [];
  // Clips of long (file-backed) assets: each reads and schedules short segments ahead of the playhead
  private activeStreams: Array<{ player: StreamedClipPlayer; gainNode: GainNode; declick?: GainNode }> = [];
  // First segments read before the transport clock starts, so streamed clips begin in sync
  private streamPreload: Map<string, Float32Array[]> = new Map();
  private playToken = 0;

  // Rack preview: plays one track (or the whole mix) in isolation, looping, without touching the timeline transport
  private previewTargetId: string | null = null;
  private previewRange: { start: number; end: number } | null = null;
  private previewProject: Project | null = null;
  private previewSaved: { playhead: number; end: number } | null = null;

  // Playback state
  private isPlaying: boolean = false;
  private playheadSeconds: number = 0;
  private playStartTimeCtx: number = 0;
  private playheadStartOffset: number = 0;
  private projectEndSeconds: number = 0;
  private scheduledStopTimer: any = null;
  private onPlaybackEndedCallback: (() => void) | null = null;
  /** End of the highlighted range being played, or null to play on to the end of the project */
  private playWindowEnd: number | null = null;
  /** Where playback stops by itself: the window end, else the end of the project */
  private stopAtSeconds = 0;

  // Cache for assets (assetId -> Asset)
  private assets: Map<string, Asset> = new Map();

  // Time update callback for UI synchronization
  private onTimeUpdateCallback: ((timeSeconds: number) => void) | null = null;
  private animFrameId: number | null = null;

  // Peak metering buffers
  private meterBuffer: Float32Array = new Float32Array(512);

  public setOnPlaybackEnded(cb: () => void): void {
    this.onPlaybackEndedCallback = cb;
  }

  public getProjectEnd(): number {
    return this.projectEndSeconds;
  }

  public setProjectEnd(endSec: number): void {
    this.projectEndSeconds = Math.max(0, endSec);
  }

  private clearScheduledStop(): void {
    if (this.scheduledStopTimer !== null) {
      clearTimeout(this.scheduledStopTimer);
      this.scheduledStopTimer = null;
    }
  }

  constructor() {
    // Lazily initialized on first user gesture to comply with browser autoplay policies
    if (typeof window !== 'undefined') {
      window.addEventListener('uuda:rebuild-track-plugins', (e: Event) => {
        const trackId = (e as CustomEvent).detail?.trackId;
        if (trackId) {
          this.rewireTrackPlugins(trackId);
        }
      });
    }
  }

  public rewireTrackPlugins(trackId: string): void {
    if (trackId === MASTER_TRACK_ID) {
      this.rewireMasterPlugins();
      return;
    }
    if (isGroupChainId(trackId)) {
      const bus = this.groupBuses.get(groupIdOfChain(trackId));
      if (bus) pluginManager.connectPluginChain(trackId, bus.input, bus.output);
      return;
    }
    const nodes = this.trackNodes.get(trackId);
    if (!nodes) return;
    pluginManager.connectPluginChain(trackId, nodes.gainNode, nodes.panNode as unknown as AudioNode);
  }

  private ensureGroupBus(groupId: string): { input: GainNode; output: GainNode; level: GainNode; pan: StereoPannerNode | null; analyser: AnalyserNode } | null {
    if (!this.ctx || !this.masterGain) return null;
    let bus = this.groupBuses.get(groupId);
    if (!bus) {
      // input -> group plugins -> output -> level (group fader / mute) -> pan -> master
      const input = this.ctx.createGain();
      const output = this.ctx.createGain();
      const level = this.ctx.createGain();
      const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      pluginManager.connectPluginChain(groupChainId(groupId), input, output);
      output.connect(level);
      if (pan) {
        level.connect(pan);
        pan.connect(this.masterGain);
      } else {
        level.connect(this.masterGain);
      }
      // Meter tap: listens to the group's output without being part of the signal path
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.7;
      (pan ?? level).connect(analyser);
      bus = { input, output, level, pan, analyser };
      this.groupBuses.set(groupId, bus);
      this.applyGroupSettings(groupId);
    }
    return bus;
  }

  private applyGroupSettings(groupId: string): void {
    const bus = this.groupBuses.get(groupId);
    if (!bus || !this.ctx) return;
    const s = { ...DEFAULT_GROUP_SETTINGS, ...(this.groupSettings[groupId] ?? {}) };
    const t = this.ctx.currentTime;
    bus.level.gain.cancelScheduledValues(t);
    // While a group is soloed, the others are silent and the soloed one is heard even if it was muted
    const gain = this.soloGroupId ? (this.soloGroupId === groupId ? clamp01to15(s.volume) : 0) : groupOutputGain(s);
    bus.level.gain.setTargetAtTime(gain, t, 0.015);
    if (bus.pan) bus.pan.pan.setTargetAtTime(groupPan(s), t, 0.015);
  }

  /** Audition one group alone (null = back to the normal mix). Applies live, with a short smoothing so nothing clicks. */
  public setSoloGroup(groupId: string | null): void {
    this.soloGroupId = groupId;
    if (!this.ctx) return;
    if (this.lastTracks.length > 0) this.syncTracks(this.lastTracks);
    for (const id of this.groupBuses.keys()) this.applyGroupSettings(id);
  }

  /** Temporary per-clip levels as linear multipliers (clip id -> factor). Applies live to clips that are playing. */
  public setTempClipLevels(factors: Record<string, number>): void {
    this.tempClipFactors = factors;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const { clipId, node } of this.clipTrims) node.gain.setTargetAtTime(factors[clipId] ?? 1, t, 0.015);
  }

  /** Hear only one track (single-track view with solo). null = the normal mix. Applies live to the track; grouped clips on other tracks stop at the next play. */
  public setFocusSolo(trackId: string | null): void {
    this.focusSoloTrackId = trackId;
    if (!this.ctx) return;
    if (this.lastTracks.length > 0) this.syncTracks(this.lastTracks);
  }

  public getSoloGroup(): string | null {
    return this.soloGroupId;
  }

  /** Replace all group settings (called when playback starts and whenever the project's groups change). */
  public syncGroupSettings(settings: Record<string, GroupSettings> | undefined): void {
    this.groupSettings = settings ?? {};
    for (const id of this.groupBuses.keys()) this.applyGroupSettings(id);
  }

  /** Master bus effects: the whole mix passes through them before the compressor and limiter */
  public rewireMasterPlugins(): void {
    if (!this.masterFxIn || !this.masterEq) return;
    pluginManager.connectPluginChain(MASTER_TRACK_ID, this.masterFxIn, this.masterEq);
  }

  public async init(): Promise<AudioContext> {
    if (!this.ctx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      try {
        this.ctx = new AudioCtxClass({
          latencyHint: 'interactive',
          sampleRate: 48000,
        });
      } catch {
        // Fallback if 48000Hz is rejected by OS hardware
        this.ctx = new AudioCtxClass({
          latencyHint: 'interactive',
        });
      }

      this.setupMasterBus();
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    return this.ctx;
  }

  public getContext(): AudioContext | null {
    return this.ctx;
  }

  public async decodeAudio(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = await this.init();
    try {
      // Clone buffer because decodeAudioData detaches the input ArrayBuffer
      const copy = arrayBuffer.slice(0);
      return await ctx.decodeAudioData(copy);
    } catch (err) {
      console.warn('Standard ctx.decodeAudioData failed, attempting PCM recovery fallback:', err);
      return this.decodePcmFallback(arrayBuffer, ctx);
    }
  }

  private decodePcmFallback(buffer: ArrayBuffer, ctx: AudioContext): AudioBuffer {
    const uint8 = new Uint8Array(buffer);
    let sampleRate = 24000;
    let numChannels = 1;
    let pcmOffset = 0;

    // Check if it's a RIFF WAVE container
    if (
      uint8.length >= 44 &&
      String.fromCharCode(uint8[0], uint8[1], uint8[2], uint8[3]) === 'RIFF'
    ) {
      const view = new DataView(buffer);
      numChannels = view.getUint16(22, true) || 1;
      sampleRate = view.getUint32(24, true) || 24000;
      for (let i = 12; i < uint8.length - 8; i++) {
        if (
          uint8[i] === 0x64 &&
          uint8[i + 1] === 0x61 &&
          uint8[i + 2] === 0x74 &&
          uint8[i + 3] === 0x61
        ) {
          pcmOffset = i + 8;
          break;
        }
      }
      if (pcmOffset === 0) pcmOffset = 44;
    }

    const pcmByteLength = Math.max(0, buffer.byteLength - pcmOffset);
    const numSamples = Math.floor(pcmByteLength / (2 * numChannels));
    const safeSamples = Math.max(1, numSamples);
    const audioBuf = ctx.createBuffer(numChannels, safeSamples, sampleRate);

    if (numSamples > 0) {
      const int16View = new Int16Array(buffer, pcmOffset, numSamples * numChannels);
      for (let ch = 0; ch < numChannels; ch++) {
        const channelData = audioBuf.getChannelData(ch);
        for (let i = 0; i < numSamples; i++) {
          channelData[i] = int16View[i * numChannels + ch] / 32768.0;
        }
      }
    }
    return audioBuf;
  }

  public getSampleRate(): number {
    return this.ctx ? this.ctx.sampleRate : 48000;
  }

  private setupMasterBus(): void {
    if (!this.ctx) return;

    // Master Gain (Master Fader)
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.isMasterMuted ? 0 : this.masterVolumeValue, this.ctx.currentTime);

    // Ducking Gain (applied to playing tracks when recording)
    this.duckingGain = this.ctx.createGain();
    this.duckingGain.gain.setValueAtTime(1.0, this.ctx.currentTime);

    // Mastering stage. Neutral until setMastering() switches it on: flat EQ, no compression, unity gain.
    this.masterEq = this.ctx.createBiquadFilter();
    this.masterEq.type = 'peaking';
    this.masterEq.frequency.setValueAtTime(3000, this.ctx.currentTime);
    this.masterEq.Q.setValueAtTime(CHAIN_PRESENCE_Q, this.ctx.currentTime);
    this.masterEq.gain.setValueAtTime(0, this.ctx.currentTime);

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.setValueAtTime(CHAIN_COMPRESSOR_THRESHOLD_DB, this.ctx.currentTime);
    this.compressor.knee.setValueAtTime(CHAIN_COMPRESSOR_KNEE_DB, this.ctx.currentTime);
    this.compressor.ratio.setValueAtTime(1, this.ctx.currentTime);
    this.compressor.attack.setValueAtTime(0.02, this.ctx.currentTime);
    this.compressor.release.setValueAtTime(0.12, this.ctx.currentTime);

    this.masterMakeup = this.ctx.createGain();
    this.masterMakeup.gain.setValueAtTime(1, this.ctx.currentTime);

    // Transparent Brickwall Limiter (fast attack compressor)
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.setValueAtTime(-1.0, this.ctx.currentTime);
    this.limiter.knee.setValueAtTime(0, this.ctx.currentTime);
    this.limiter.ratio.setValueAtTime(20, this.ctx.currentTime);
    this.limiter.attack.setValueAtTime(0.001, this.ctx.currentTime);
    this.limiter.release.setValueAtTime(0.05, this.ctx.currentTime);

    // Master Stereo Splitter & Analysers for independent L and R metering
    this.masterSplitter = this.ctx.createChannelSplitter(2);
    this.masterLeftAnalyser = this.ctx.createAnalyser();
    this.masterLeftAnalyser.fftSize = 1024;
    this.masterLeftAnalyser.smoothingTimeConstant = 0.8;

    this.masterRightAnalyser = this.ctx.createAnalyser();
    this.masterRightAnalyser.fftSize = 1024;
    this.masterRightAnalyser.smoothingTimeConstant = 0.8;

    this.masterSplitter.connect(this.masterLeftAnalyser, 0);
    this.masterSplitter.connect(this.masterRightAnalyser, 1);

    // Master Analyser
    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 1024;
    this.masterAnalyser.smoothingTimeConstant = 0.8;

    // K-Weighting Filter Branch for Live ITU-R BS.1770 LUFS during playback
    // Stage 1: High shelf filter ~1.5kHz (+4dB)
    this.kHighShelf = this.ctx.createBiquadFilter();
    this.kHighShelf.type = 'highshelf';
    this.kHighShelf.frequency.setValueAtTime(1500, this.ctx.currentTime);
    this.kHighShelf.gain.setValueAtTime(4.0, this.ctx.currentTime);

    // Stage 2: High pass filter ~100Hz
    this.kHighPass = this.ctx.createBiquadFilter();
    this.kHighPass.type = 'highpass';
    this.kHighPass.frequency.setValueAtTime(100, this.ctx.currentTime);
    this.kHighPass.Q.setValueAtTime(0.707, this.ctx.currentTime);

    this.kWeightAnalyser = this.ctx.createAnalyser();
    this.kWeightAnalyser.fftSize = 2048;

    // Connect chain: Track -> MasterGain -> DuckingGain -> Compressor -> Limiter -> Splitter & Analyser -> Destination
    this.masterGain.connect(this.duckingGain);
    this.masterFxIn = this.ctx.createGain();
    this.duckingGain.connect(this.masterFxIn);
    this.rewireMasterPlugins();
    this.masterEq.connect(this.compressor);
    this.compressor.connect(this.masterMakeup);
    this.masterMakeup.connect(this.limiter);
    this.applyMastering();
    this.limiter.connect(this.masterAnalyser);
    this.limiter.connect(this.masterSplitter);
    this.limiter.connect(this.kHighShelf);
    this.kHighShelf.connect(this.kHighPass);
    this.kHighPass.connect(this.kWeightAnalyser);
    this.masterAnalyser.connect(this.ctx.destination);
  }

  /**
   * Smoothly ducks or restores playing tracks by a specified dB amount
   */
  public setDucking(active: boolean, duckAmountDb: number = -12): void {
    if (!this.ctx || !this.duckingGain) return;
    this.isDucked = active;
    const now = this.ctx.currentTime;
    const targetLinear = active ? Math.pow(10, duckAmountDb / 20) : 1.0;

    this.duckingGain.gain.cancelScheduledValues(now);
    this.duckingGain.gain.setValueAtTime(this.duckingGain.gain.value, now);
    this.duckingGain.gain.linearRampToValueAtTime(targetLinear, now + 0.05); // 50ms short fade
  }

  public getIsDucked(): boolean {
    return this.isDucked;
  }

  public registerAsset(asset: Asset): void {
    this.assets.set(asset.id, asset);
  }

  public unregisterAsset(assetId: string): void {
    this.assets.delete(assetId);
  }

  public getAsset(assetId: string): Asset | undefined {
    return this.assets.get(assetId);
  }

  public async decodeAudioFile(file: File): Promise<AudioBuffer> {
    const ctx = await this.init();
    const arrayBuffer = await file.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuffer);
  }

  public async decodeArrayBuffer(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = await this.init();
    // Copy array buffer before decodeAudioData since it detaches the buffer
    const copy = arrayBuffer.slice(0);
    return await ctx.decodeAudioData(copy);
  }

  /** Gain a track should have right now, honouring mute/solo and an active rack preview */
  private effectiveVolume(track: Track, anySolo: boolean): number {
    if (this.soloGroupId) return 0; // loose clips are silent while a group is auditioned
    if (this.focusSoloTrackId) return track.id === this.focusSoloTrackId ? track.volume : 0; // heard even if the track was muted
    if (this.previewTargetId && this.previewTargetId !== MASTER_TRACK_ID && !isGroupChainId(this.previewTargetId)) {
      return track.id === this.previewTargetId ? track.volume : 0;
    }
    if (anySolo) return !track.solo || track.muted ? 0 : track.volume;
    return track.muted ? 0 : track.volume;
  }

  /**
   * Syncs track nodes with the project state
   */
  public syncTracks(tracks: Track[]): void {
    this.lastTracks = tracks;
    if (!this.ctx || !this.masterGain) return;

    const currentTrackIds = new Set(tracks.map(t => t.id));

    // Remove obsolete track nodes
    for (const [id, nodes] of this.trackNodes.entries()) {
      if (!currentTrackIds.has(id)) {
        try {
          nodes.gainNode.disconnect();
          nodes.panNode.disconnect();
          nodes.analyserNode.disconnect();
          nodes.duckNode.disconnect();
        } catch {
          // ignore disconnect errors
        }
        this.trackNodes.delete(id);
      }
    }

    const anySolo = tracks.some(t => t.solo);

    // Create or update nodes for each track
    for (const track of tracks) {
      let nodes = this.trackNodes.get(track.id);
      if (!nodes) {
        const gainNode = this.ctx.createGain();
        const panNode = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : (this.ctx.createGain() as unknown as StereoPannerNode);
        const analyserNode = this.ctx.createAnalyser();
        analyserNode.fftSize = 512;
        analyserNode.smoothingTimeConstant = 0.7;

        const duckNode = this.ctx.createGain();

        // Path: Track Sources -> GainNode -> Plugins -> PanNode -> DuckNode -> AnalyserNode -> MasterGain
        pluginManager.connectPluginChain(track.id, gainNode, panNode as unknown as AudioNode);
        (panNode as unknown as AudioNode).connect(duckNode);
        duckNode.connect(analyserNode);
        analyserNode.connect(this.masterGain);

        nodes = { gainNode, panNode, analyserNode, duckNode };
        this.trackNodes.set(track.id, nodes);
      }

      const effectiveVolume = this.effectiveVolume(track, anySolo);

      // Smooth volume transition to prevent clicks
      const now = this.ctx.currentTime;
      nodes.gainNode.gain.cancelScheduledValues(now);
      nodes.gainNode.gain.setValueAtTime(nodes.gainNode.gain.value, now);
      nodes.gainNode.gain.linearRampToValueAtTime(effectiveVolume, now + 0.02);

      if (nodes.panNode.pan) {
        nodes.panNode.pan.cancelScheduledValues(now);
        nodes.panNode.pan.setValueAtTime(track.pan, now);
      }
    }
  }

  /**
   * Real-time update for a single track's volume, pan, mute or solo
   */
  public updateSingleTrack(track: Track, anySolo: boolean): void {
    if (!this.ctx) return;
    const nodes = this.trackNodes.get(track.id);
    if (!nodes) return;

    const effectiveVolume = this.effectiveVolume(track, anySolo);

    const now = this.ctx.currentTime;
    nodes.gainNode.gain.cancelScheduledValues(now);
    nodes.gainNode.gain.setValueAtTime(nodes.gainNode.gain.value, now);
    nodes.gainNode.gain.linearRampToValueAtTime(effectiveVolume, now + 0.02);

    if (nodes.panNode.pan) {
      nodes.panNode.pan.cancelScheduledValues(now);
      nodes.panNode.pan.setValueAtTime(track.pan, now);
    }
  }

  private getChannelsForDuck = (assetId: string): { channels: Float32Array[]; sampleRate: number } | null => {
    const buf = this.assets.get(assetId)?.buffer;
    if (!buf || typeof buf.getChannelData !== 'function') return null;
    const channels: Float32Array[] = [];
    for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
    return { channels, sampleRate: buf.sampleRate };
  };

  /** Applies each ducking track's gain curve from the given project time */
  private scheduleDucking(project: Project, fromSeconds: number, onlyChanged = false): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const track of project.tracks) {
      const nodes = this.trackNodes.get(track.id);
      if (!nodes) continue;
      if (!normalizeDucking(track.ducking).enabled) {
        if (!onlyChanged || this.duckApplied.has(track.id)) clearDuck(nodes.duckNode.gain, now);
        this.duckApplied.delete(track.id);
        this.duckCache.delete(track.id);
        continue;
      }
      const key = duckCurveKey(project, track);
      if (onlyChanged && this.duckApplied.get(track.id) === key) continue;
      this.duckApplied.set(track.id, key);
      let entry = this.duckCache.get(track.id);
      if (!entry || entry.key !== key) {
        entry = { key, curve: buildDuckCurve(project, track, this.getChannelsForDuck) };
        this.duckCache.set(track.id, entry);
      }
      if (entry.curve) scheduleDuckCurve(nodes.duckNode.gain, entry.curve, fromSeconds, now);
      else clearDuck(nodes.duckNode.gain, now);
    }
  }

  private clearAllDucks(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const nodes of this.trackNodes.values()) clearDuck(nodes.duckNode.gain, now);
    this.duckApplied.clear();
  }

  /** Call after ducking settings or source clips change: re-applies the curves from the current position */
  public refreshDucking(project: Project): void {
    if (!this.ctx || !this.isPlaying) return;
    this.scheduleDucking(project, this.updateCurrentPosition(), true);
  }

  /**
   * Start playback from given or current position.
   * Enforces projectEnd constraint: stopping at the end of content.
   */
  public async play(project: Project, startPositionSeconds?: number, stopAtSeconds?: number): Promise<void> {
    if (this.previewTargetId) this.endPreview();
    // A play window (the highlighted range) stops playback at its end; a seek during playback keeps the window
    if (typeof stopAtSeconds === 'number') this.playWindowEnd = stopAtSeconds;
    else if (!this.isPlaying) this.playWindowEnd = null;
    await this.playInternal(project, startPositionSeconds);
  }

  private async playInternal(project: Project, startPositionSeconds?: number): Promise<void> {
    const ctx = await this.init();
    if (this.isPlaying) {
      if (this.previewTargetId) {
        this.stop();
      } else {
        // Restarting (e.g. a seek while playing): tear down quietly. stop() would report position 0 to the UI,
        // making the playhead dash to the start before landing on the new position.
        this.clearScheduledStop();
        this.stopSources();
        this.isPlaying = false;
        this.stopPlaybackLoop();
      }
    }

    this.syncTracks(project.tracks);
    const token = ++this.playToken;

    // Compute projectEnd = max(clip.start + clip.duration) across all tracks
    let maxEnd = 0;
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        const end = clip.startSeconds + clip.durationSeconds;
        if (end > maxEnd) maxEnd = end;
      }
    }
    this.projectEndSeconds = this.previewRange ? this.previewRange.end : maxEnd;
    this.stopAtSeconds = !this.previewRange && this.playWindowEnd !== null ? Math.min(maxEnd, this.playWindowEnd) : this.projectEndSeconds;

    let fromTime = typeof startPositionSeconds === 'number' ? startPositionSeconds : this.playheadSeconds;
    // Pressing Play when playhead is at the end restarts from 0
    if (this.previewRange) {
      fromTime = this.previewRange.start;
    } else if (this.stopAtSeconds > 0 && fromTime >= this.stopAtSeconds - 0.01) {
      fromTime = this.playWindowEnd !== null ? fromTime : 0;
    }

    await this.preloadStreamedStarts(project, Math.max(0, fromTime));
    if (token !== this.playToken) { this.streamPreload.clear(); return; } // stopped or restarted while reading

    this.playheadSeconds = Math.max(0, fromTime);
    this.playStartTimeCtx = ctx.currentTime;
    this.playheadStartOffset = this.playheadSeconds;
    this.isPlaying = true;

    this.scheduleDucking(project, fromTime);

    this.syncGroupSettings(project.groupSettings);

    // Schedule all active clips in all tracks. Grouped clips go straight to their group's bus: they ignore their track's
    // fader, pan and mute/solo, and the group's own plugins, level and pan process them as one unit.
    const previewGroup = this.previewTargetId && isGroupChainId(this.previewTargetId) ? groupIdOfChain(this.previewTargetId) : null;
    for (const track of project.tracks) {
      const trackNode = this.trackNodes.get(track.id);
      if (!trackNode) continue;

      for (const clip of track.clips) {
        if (previewGroup && clip.groupId !== previewGroup) continue;
        if (clip.groupId) {
          const bus = this.ensureGroupBus(clip.groupId);
          if (!bus) continue;
          this.scheduleClip(clip, bus.input, fromTime);
        } else {
          this.scheduleClip(clip, trackNode.gainNode, fromTime);
        }
      }
    }

    // Precise stop scheduled on the AudioContext clock
    this.clearScheduledStop();
    // Previews loop from the animation-frame loop instead of a one-shot stop timer
    if (this.stopAtSeconds > 0 && !this.previewRange) {
      const durationUntilEnd = Math.max(0, this.stopAtSeconds - this.playheadSeconds);
      this.scheduledStopTimer = setTimeout(() => {
        if (this.isPlaying) {
          this.stopSources();
          this.isPlaying = false;
          this.playheadSeconds = this.stopAtSeconds;
          this.stopPlaybackLoop();
          if (this.onTimeUpdateCallback) {
            this.onTimeUpdateCallback(this.stopAtSeconds);
          }
          if (this.onPlaybackEndedCallback) {
            this.onPlaybackEndedCallback();
          }
        }
      }, durationUntilEnd * 1000);
    }

    this.startPlaybackLoop();
  }

  private scheduleClip(clip: Clip, destination: AudioNode, currentPlayhead: number): void {
    if (!this.ctx) return;
    if (clip.muted) return; // Muted clip produces no sound
    // Single-track solo: a grouped clip plays on its group's channel, not its track's, so it is skipped here when it belongs to another track
    if (this.focusSoloTrackId && clip.groupId && !this.lastTracks.find((t) => t.id === this.focusSoloTrackId)?.clips.some((c) => c.id === clip.id)) return;
    const asset = this.assets.get(clip.assetId);
    if (!asset || (!asset.buffer && !asset.source)) return;

    const window = clipPlaybackWindow(clip, currentPlayhead, this.ctx.currentTime);
    if (!window) return;
    const whenToStartInCtx = window.when;
    const offsetInAudioBuffer = window.offsetSeconds;
    const durationToPlay = window.durationSeconds;

    // Clip-level gain node (for clip gain + fades)
    const clipGain = this.ctx.createGain();
    clipGain.gain.setValueAtTime(clip.gain, whenToStartInCtx);

    // Apply fade-in if applicable
    if (clip.fadeInSeconds > 0) {
      const fadeInStart = this.ctx.currentTime + Math.max(0, clip.startSeconds - currentPlayhead);
      const fadeInDuration = clip.fadeInSeconds;
      
      if (currentPlayhead <= clip.startSeconds) {
        // Complete fade-in curve
        clipGain.gain.setValueAtTime(0, fadeInStart);
        this.applyFadeCurve(clipGain.gain, 0, clip.gain, fadeInStart, fadeInDuration, clip.fadeShape);
      } else if (currentPlayhead < clip.startSeconds + clip.fadeInSeconds) {
        // In the middle of fade-in
        const elapsedFade = currentPlayhead - clip.startSeconds;
        const progress = elapsedFade / clip.fadeInSeconds;
        const startGain = clip.gain * (clip.fadeShape === 'linear' ? progress : Math.pow(progress, 2));
        clipGain.gain.setValueAtTime(startGain, this.ctx.currentTime);
        this.applyFadeCurve(clipGain.gain, startGain, clip.gain, this.ctx.currentTime, fadeInDuration - elapsedFade, clip.fadeShape);
      }
    }

    // Apply fade-out if applicable
    if (clip.fadeOutSeconds > 0) {
      const fadeOutStart = this.ctx.currentTime + Math.max(0, (clip.startSeconds + clip.durationSeconds - clip.fadeOutSeconds) - currentPlayhead);
      const fadeOutDuration = clip.fadeOutSeconds;

      if (currentPlayhead < clip.startSeconds + clip.durationSeconds - clip.fadeOutSeconds) {
        this.applyFadeCurve(clipGain.gain, clip.gain, 0, fadeOutStart, fadeOutDuration, clip.fadeShape);
      } else if (currentPlayhead < clip.startSeconds + clip.durationSeconds) {
        // In the middle of fade-out
        const remainingTime = clip.startSeconds + clip.durationSeconds - currentPlayhead;
        const progress = 1 - (remainingTime / clip.fadeOutSeconds);
        const startGain = clip.gain * (1 - (clip.fadeShape === 'linear' ? progress : Math.pow(progress, 2)));
        clipGain.gain.setValueAtTime(startGain, this.ctx.currentTime);
        this.applyFadeCurve(clipGain.gain, startGain, 0, this.ctx.currentTime, remainingTime, clip.fadeShape);
      }
    }

    // Declick stage: a clip that begins right now (playing from the middle of it, or straight after an edit) starts at
    // the wave's current value, which is a click unless it is faded in over a few milliseconds.
    const declick = this.ctx.createGain();
    if (whenToStartInCtx <= this.ctx.currentTime + 0.02) {
      declick.gain.setValueAtTime(0, whenToStartInCtx);
      declick.gain.linearRampToValueAtTime(1, whenToStartInCtx + DECLICK_SECONDS);
    }
    clipGain.connect(declick);
    // Trim stage: the temporary per-clip level used while mastering a group (1 = no change). It sits after the clip's own
    // gain and fades, so it can change while playing without disturbing them.
    const trim = this.ctx.createGain();
    trim.gain.value = this.tempClipFactors[clip.id] ?? 1;
    declick.connect(trim);
    trim.connect(destination);
    this.clipTrims.push({ clipId: clip.id, node: trim });

    if (asset.buffer) {
      const source = this.ctx.createBufferSource();
      source.buffer = asset.buffer;
      source.connect(clipGain);
      try {
        source.start(whenToStartInCtx, offsetInAudioBuffer, durationToPlay);
        this.activeSources.push({ source, gainNode: clipGain, declick });
      } catch {
        // Buffer start exception safeguard
      }
      return;
    }

    // Long audio on disk: read and schedule short segments ahead of the playhead instead of holding it all.
    const stored = asset.source!;
    const sr = asset.sampleRate;
    const startFrame = Math.max(0, Math.round(offsetInAudioBuffer * sr));
    const frames = Math.max(0, Math.min(Math.floor(durationToPlay * sr), stored.frames - startFrame));
    if (frames <= 0) { clipGain.disconnect(); return; }
    const channels = Math.max(1, asset.numberOfChannels);
    const player = new StreamedClipPlayer({
      ctx: this.ctx,
      destination: clipGain,
      read: (start, count) => readStreamedFrames(stored.storeId, channels, start, count),
      channels,
      sampleRate: sr,
      startFrame,
      frames,
      when: whenToStartInCtx,
      preloaded: this.streamPreload.get(clip.id) ?? null,
      onError: (e) => console.warn('Streamed playback stopped:', e),
    });
    this.activeStreams.push({ player, gainNode: clipGain, declick });
    player.start();
  }

  /**
   * Reads the first segment of every streamed clip that will sound, before the transport clock starts,
   * so long clips begin exactly in sync with the rest of the mix instead of arriving a moment late.
   */
  private async preloadStreamedStarts(project: Project, fromTime: number): Promise<void> {
    this.streamPreload.clear();
    const jobs: Array<Promise<void>> = [];
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        if (clip.muted) continue;
        const asset = this.assets.get(clip.assetId);
        if (!asset?.source || asset.buffer) continue;
        const win = clipPlaybackWindow(clip, fromTime, 0);
        // Only clips that start within the first segment's reach need a preloaded start.
        if (!win || win.when > 5) continue;
        const sr = asset.sampleRate;
        const startFrame = Math.max(0, Math.round(win.offsetSeconds * sr));
        const frames = Math.max(0, Math.min(Math.floor(win.durationSeconds * sr), asset.source.frames - startFrame, 10 * sr));
        if (frames <= 0) continue;
        const clipId = clip.id;
        jobs.push(readStreamedFrames(asset.source.storeId, Math.max(1, asset.numberOfChannels), startFrame, frames)
          .then((data) => { this.streamPreload.set(clipId, data); })
          .catch(() => undefined));
      }
    }
    await Promise.all(jobs);
  }

  private applyFadeCurve(
    param: AudioParam,
    fromVal: number,
    toVal: number,
    startTime: number,
    duration: number,
    shape: 'linear' | 'exponential'
  ): void {
    if (!this.ctx || duration <= 0) return;
    const steps = 32;
    const curve = new Float32Array(steps);
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const factor = shape === 'exponential' 
        ? (fromVal < toVal ? Math.pow(t, 2) : 1 - Math.pow(1 - t, 2))
        : t;
      curve[i] = fromVal + (toVal - fromVal) * factor;
    }
    try {
      param.setValueCurveAtTime(curve, startTime, duration);
    } catch {
      // Fallback to linear ramp if curve scheduling overlaps
      param.setValueAtTime(fromVal, startTime);
      param.linearRampToValueAtTime(toVal, startTime + duration);
    }
  }

  public pause(): void {
    if (this.previewTargetId) {
      this.endPreview();
      return;
    }
    if (!this.isPlaying) return;
    this.clearScheduledStop();
    this.updateCurrentPosition();
    this.stopSources();
    this.isPlaying = false;
    this.stopPlaybackLoop();
  }

  public stop(): void {
    if (this.previewTargetId) {
      this.endPreview();
      return;
    }
    this.clearScheduledStop();
    this.stopSources();
    this.isPlaying = false;
    this.playWindowEnd = null;
    this.playheadSeconds = 0;
    this.stopPlaybackLoop();
    if (this.onTimeUpdateCallback) {
      this.onTimeUpdateCallback(0);
    }
  }

  public seek(toSeconds: number, project?: Project): void {
    if (this.previewTargetId) this.endPreview();
    this.clearScheduledStop();
    const wasPlaying = this.isPlaying;
    if (this.isPlaying) {
      this.stopSources();
    }
    const clamped = this.projectEndSeconds > 0
      ? Math.min(Math.max(0, toSeconds), this.projectEndSeconds)
      : Math.max(0, toSeconds);
    this.playheadSeconds = clamped;
    if (this.onTimeUpdateCallback) {
      this.onTimeUpdateCallback(this.playheadSeconds);
    }

    if (wasPlaying && project) {
      this.play(project, this.playheadSeconds);
    }
  }

  private stopSources(): void {
    this.playToken++;
    this.clearScheduledStop();
    this.clearAllDucks();
    // Stopping dead in the middle of a wave is a click, so each clip is faded out over a few milliseconds first and
    // only then stopped and disconnected. A new playback can start straight away; the old tail overlaps it harmlessly.
    const now = this.ctx ? this.ctx.currentTime : 0;
    const fadeOut = (declick: GainNode | undefined) => {
      if (!declick || !this.ctx) return false;
      try {
        declick.gain.cancelScheduledValues(now);
        declick.gain.setValueAtTime(declick.gain.value, now);
        declick.gain.linearRampToValueAtTime(0, now + DECLICK_SECONDS);
        return true;
      } catch {
        return false;
      }
    };
    const later = (fn: () => void, faded: boolean) => {
      if (faded && typeof setTimeout !== 'undefined') setTimeout(fn, DECLICK_SECONDS * 1000 + 30);
      else fn();
    };
    for (const item of this.activeStreams) {
      const faded = fadeOut(item.declick);
      later(() => {
        try {
          item.player.stop();
          item.gainNode.gain.cancelScheduledValues(0);
          item.gainNode.disconnect();
          item.declick?.disconnect();
        } catch {
          // already stopped
        }
      }, faded);
    }
    this.activeStreams = [];
    this.streamPreload.clear();
    for (const item of this.activeSources) {
      const faded = fadeOut(item.declick);
      later(() => {
        try {
          item.gainNode.gain.cancelScheduledValues(0);
          item.source.stop();
          item.source.disconnect();
          item.gainNode.disconnect();
          item.declick?.disconnect();
        } catch {
          // already stopped
        }
      }, faded);
    }
    this.activeSources = [];
    for (const t of this.clipTrims) {
      try { t.node.disconnect(); } catch { /* already disconnected */ }
    }
    this.clipTrims = [];
  }

  private updateCurrentPosition(): number {
    if (this.isPlaying && this.ctx) {
      const elapsed = this.ctx.currentTime - this.playStartTimeCtx;
      this.playheadSeconds = this.playheadStartOffset + elapsed;
    }
    return this.playheadSeconds;
  }

  public getCurrentTime(): number {
    return this.updateCurrentPosition();
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public setOnTimeUpdate(cb: (timeSeconds: number) => void): void {
    this.onTimeUpdateCallback = cb;
  }

  private startPlaybackLoop(): void {
    const loop = () => {
      if (this.isPlaying) {
        const t = this.updateCurrentPosition();
        if (this.previewRange && this.previewProject) {
          if (t >= this.previewRange.end) {
            // Loop the preview window
            const project = this.previewProject;
            this.stopSources();
            this.isPlaying = false;
            void this.playInternal(project, this.previewRange.start);
          } else {
            this.animFrameId = requestAnimationFrame(loop);
          }
          return;
        }
        if (this.stopAtSeconds > 0 && t >= this.stopAtSeconds) {
          this.stopSources();
          this.isPlaying = false;
          this.playheadSeconds = this.stopAtSeconds;
          this.stopPlaybackLoop();
          this.clearScheduledStop();
          if (this.onTimeUpdateCallback) {
            this.onTimeUpdateCallback(this.stopAtSeconds);
          }
          if (this.onPlaybackEndedCallback) {
            this.onPlaybackEndedCallback();
          }
          return;
        }

        if (this.onTimeUpdateCallback) {
          this.onTimeUpdateCallback(t);
        }
        this.animFrameId = requestAnimationFrame(loop);
      }
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  private stopPlaybackLoop(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  /**
   * Metering: calculates live peak and RMS for a given track
   */
  public getTrackMeter(trackId: string): MeterData {
    const nodes = this.trackNodes.get(trackId);
    if (!nodes || !this.isPlaying) {
      return { peak: 0, rms: 0, clip: false };
    }
    return this.calculateMeterFromAnalyser(nodes.analyserNode);
  }

  /** Live peak and level of a group channel (zero when stopped or the group has not played yet). */
  public getGroupMeter(groupId: string): MeterData {
    const bus = this.groupBuses.get(groupId);
    if (!bus || !this.isPlaying) return { peak: 0, rms: 0, clip: false };
    return this.calculateMeterFromAnalyser(bus.analyser);
  }

  /**
   * Master bus meter
   */
  public getMasterMeter(): MeterData {
    if (!this.masterAnalyser || !this.isPlaying) {
      return { peak: 0, rms: 0, clip: false };
    }
    return this.calculateMeterFromAnalyser(this.masterAnalyser);
  }

  private calculateMeterFromAnalyser(analyser: AnalyserNode): MeterData {
    if (this.meterBuffer.length !== analyser.fftSize) {
      this.meterBuffer = new Float32Array(analyser.fftSize);
    }
    (analyser.getFloatTimeDomainData as (arr: Float32Array) => void)(this.meterBuffer);

    let sumSquares = 0;
    let peak = 0;
    for (let i = 0; i < this.meterBuffer.length; i++) {
      const val = Math.abs(this.meterBuffer[i]);
      if (val > peak) peak = val;
      sumSquares += val * val;
    }

    const rms = Math.sqrt(sumSquares / this.meterBuffer.length);
    return {
      peak,
      rms,
      clip: peak >= 0.99,
    };
  }

  public setMasterVolume(val: number): void {
    this.masterVolumeValue = Math.max(0, val);
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.isMasterMuted ? 0 : this.masterVolumeValue, now);
    }
  }

  public getMasterVolume(): number {
    return this.masterVolumeValue;
  }

  public setMasterMute(muted: boolean): void {
    this.isMasterMuted = muted;
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(muted ? 0 : this.masterVolumeValue, now);
    }
  }

  public getMasterMute(): boolean {
    return this.isMasterMuted;
  }

  /**
   * Mastering works like a plugin on the master bus. Active: presence EQ, compressor, make-up gain (to the target
   * loudness, from the analysis) and a limiter at the ceiling. Inactive: the plain mix, with only a safety limiter
   * at -1 dB. Changes glide, so switching A/B while playing does not click.
   */
  public setMastering(settings: MasteringSettings | null, makeupGainDb: number): void {
    this.mastering = { settings, makeupGainDb: Number.isFinite(makeupGainDb) ? makeupGainDb : 0 };
    this.applyMastering();
  }

  private applyMastering(): void {
    if (!this.ctx || !this.masterEq || !this.compressor || !this.masterMakeup || !this.limiter) return;
    const now = this.ctx.currentTime;
    const glide = 0.03;
    const { settings, makeupGainDb } = this.mastering;
    const on = !!settings?.active;
    this.masterEq.frequency.setTargetAtTime(on ? settings!.midPresenceFreqHz : 3000, now, glide);
    this.masterEq.gain.setTargetAtTime(on ? settings!.midPresenceGainDb : 0, now, glide);
    this.compressor.ratio.setTargetAtTime(on ? Math.max(1, settings!.compressionRatio) : 1, now, glide);
    this.compressor.attack.setTargetAtTime(on ? settings!.attackMs / 1000 : 0.02, now, glide);
    this.compressor.release.setTargetAtTime(on ? settings!.releaseMs / 1000 : 0.12, now, glide);
    this.masterMakeup.gain.setTargetAtTime(on ? Math.pow(10, makeupGainDb / 20) : 1, now, glide);
    this.limiter.threshold.setTargetAtTime(on ? settings!.ceilingDbTP : -1, now, glide);
  }

  public getMasterGainReduction(): number {
    if (!this.compressor) return 0;
    return typeof this.compressor.reduction === 'number' ? this.compressor.reduction : 0;
  }

  public resetLiveIntegratedLoudness(): void {
    this.liveShortTermHistory = [];
    this.liveIntegratedEnergy = [];
  }

  private computeIntegratedFromHistory(): number {
    if (this.liveIntegratedEnergy.length === 0) return -70;
    const avg = this.liveIntegratedEnergy.reduce((a, b) => a + b, 0) / this.liveIntegratedEnergy.length;
    return avg > 1e-12 ? -0.691 + 10 * Math.log10(avg) : -70;
  }

  public getMasterLiveMetering(): MasterLiveMetering {
    if (!this.isPlaying) {
      return {
        peakL: 0,
        peakR: 0,
        rmsL: 0,
        rmsR: 0,
        truePeakDbTP: -70,
        momentaryLUFS: -70,
        shortTermLUFS: -70,
        integratedLUFS: Math.round(this.computeIntegratedFromHistory() * 10) / 10,
        gainReductionDb: 0,
        clip: false,
      };
    }

    let peakL = 0, sumSqL = 0;
    let peakR = 0, sumSqR = 0;

    if (this.masterLeftAnalyser) {
      if (this.leftBuffer.length !== this.masterLeftAnalyser.fftSize) {
        this.leftBuffer = new Float32Array(this.masterLeftAnalyser.fftSize);
      }
      (this.masterLeftAnalyser.getFloatTimeDomainData as (arr: Float32Array) => void)(this.leftBuffer);
      for (let i = 0; i < this.leftBuffer.length; i++) {
        const v = Math.abs(this.leftBuffer[i]);
        if (v > peakL) peakL = v;
        sumSqL += v * v;
      }
    }

    if (this.masterRightAnalyser) {
      if (this.rightBuffer.length !== this.masterRightAnalyser.fftSize) {
        this.rightBuffer = new Float32Array(this.masterRightAnalyser.fftSize);
      }
      (this.masterRightAnalyser.getFloatTimeDomainData as (arr: Float32Array) => void)(this.rightBuffer);
      for (let i = 0; i < this.rightBuffer.length; i++) {
        const v = Math.abs(this.rightBuffer[i]);
        if (v > peakR) peakR = v;
        sumSqR += v * v;
      }
    }

    const rmsL = Math.sqrt(sumSqL / (this.leftBuffer.length || 1));
    const rmsR = Math.sqrt(sumSqR / (this.rightBuffer.length || 1));
    const maxPeak = Math.max(peakL, peakR);
    const truePeakDbTP = maxPeak > 0 ? 20 * Math.log10(maxPeak) : -70;

    // K-Weighted Power for live LUFS
    let kPower = 0;
    if (this.kWeightAnalyser) {
      if (this.kBuffer.length !== this.kWeightAnalyser.fftSize) {
        this.kBuffer = new Float32Array(this.kWeightAnalyser.fftSize);
      }
      (this.kWeightAnalyser.getFloatTimeDomainData as (arr: Float32Array) => void)(this.kBuffer);
      let sumSqK = 0;
      for (let i = 0; i < this.kBuffer.length; i++) {
        const v = this.kBuffer[i];
        sumSqK += v * v;
      }
      kPower = sumSqK / (this.kBuffer.length || 1);
    }

    const momentaryLUFS = kPower > 1e-12 ? -0.691 + 10 * Math.log10(kPower) : -70;

    const nowMs = Date.now();
    if (kPower > 1e-8) {
      this.liveShortTermHistory.push({ time: nowMs, power: kPower });
      this.liveIntegratedEnergy.push(kPower);
    }
    this.liveShortTermHistory = this.liveShortTermHistory.filter((item) => nowMs - item.time <= 3000);

    let shortTermLUFS = -70;
    if (this.liveShortTermHistory.length > 0) {
      const avgShort = this.liveShortTermHistory.reduce((acc: number, item: { time: number; power: number }) => acc + item.power, 0) / this.liveShortTermHistory.length;
      shortTermLUFS = avgShort > 1e-12 ? -0.691 + 10 * Math.log10(avgShort) : -70;
    }

    const integratedLUFS = this.computeIntegratedFromHistory();
    const gr = this.getMasterGainReduction();

    return {
      peakL,
      peakR,
      rmsL,
      rmsR,
      truePeakDbTP: Math.round(truePeakDbTP * 10) / 10,
      momentaryLUFS: Math.round(momentaryLUFS * 10) / 10,
      shortTermLUFS: Math.round(shortTermLUFS * 10) / 10,
      integratedLUFS: Math.round(integratedLUFS * 10) / 10,
      gainReductionDb: Math.round(gr * 10) / 10,
      clip: maxPeak >= 0.99,
    };
  }

  /** Which target the rack preview is playing (a track id or MASTER_TRACK_ID), or null */
  public getPreviewTarget(): string | null {
    return this.previewTargetId;
  }

  /**
   * Rack preview: loops up to PREVIEW_MAX_SECONDS of the target's own audio through its plugin chain.
   * A track target is heard alone (even if muted or not soloed); MASTER_TRACK_ID plays the whole mix.
   * The timeline playhead and transport are left alone and restored afterwards.
   */
  public async startPreview(project: Project, targetId: string): Promise<{ ok: boolean; reason?: string }> {
    const groupTarget = isGroupChainId(targetId) ? groupIdOfChain(targetId) : null;
    const tracks = targetId === MASTER_TRACK_ID || groupTarget ? project.tracks : project.tracks.filter(t => t.id === targetId);
    let start = Infinity;
    let end = 0;
    for (const track of tracks) {
      for (const clip of track.clips) {
        if (clip.muted) continue;
        if (groupTarget && clip.groupId !== groupTarget) continue;
        const asset = this.assets.get(clip.assetId);
        if (!asset || !asset.buffer) continue;
        start = Math.min(start, clip.startSeconds);
        end = Math.max(end, clip.startSeconds + clip.durationSeconds);
      }
    }
    if (!isFinite(start) || end <= start) {
      return { ok: false, reason: targetId === MASTER_TRACK_ID ? 'The timeline has no audio to preview.' : groupTarget ? 'This group has no audio to preview.' : 'This track has no audio to preview.' };
    }

    if (this.previewTargetId) {
      this.endPreview();
    } else if (this.isPlaying) {
      // Timeline is playing: pause it where it is and let the app's transport catch up
      this.pause();
      if (this.onPlaybackEndedCallback) this.onPlaybackEndedCallback();
    }

    // Start from the playhead when it sits inside the audio, otherwise from where the audio begins
    const head = this.playheadSeconds;
    const from = head >= start && head < end - 0.05 ? head : start;
    this.previewSaved = { playhead: this.playheadSeconds, end: this.projectEndSeconds };
    this.previewTargetId = targetId;
    this.previewProject = project;
    this.previewRange = { start: from, end: Math.min(end, from + PREVIEW_MAX_SECONDS) };
    this.emitPreviewChanged();
    try {
      await this.playInternal(project, from);
    } catch (err) {
      this.endPreview();
      return { ok: false, reason: 'Audio could not be started.' };
    }
    return { ok: true };
  }

  public stopPreview(): void {
    this.endPreview();
  }

  private endPreview(): void {
    if (!this.previewTargetId) return;
    const project = this.previewProject;
    const saved = this.previewSaved;
    this.clearScheduledStop();
    this.stopSources();
    this.isPlaying = false;
    this.stopPlaybackLoop();
    this.previewTargetId = null;
    this.previewRange = null;
    this.previewProject = null;
    this.previewSaved = null;
    if (saved) {
      this.playheadSeconds = saved.playhead;
      this.projectEndSeconds = saved.end;
    }
    if (project) this.syncTracks(project.tracks); // put the track faders back
    this.emitPreviewChanged();
  }

  private emitPreviewChanged(): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('uuda:preview-changed', { detail: { target: this.previewTargetId } }));
    }
  }

  public destroy(): void {
    this.stop();
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch {
        // ignore
      }
      this.ctx = null;
    }
    this.trackNodes.clear();
    this.assets.clear();
  }
}

// Global audio engine singleton
export const audioEngine = new AudioEngine();
