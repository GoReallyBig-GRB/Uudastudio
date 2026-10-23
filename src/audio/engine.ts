/**
 * X-PRO AUDIO - Audio Engine
 * Pure Web Audio API engine. NO UI imports.
 * Manages AudioContext, graph nodes, playback scheduling, metering, and clip fading.
 */

import { Project, Track, Clip, Asset } from '../types';
import { pluginManager } from '../plugins/pluginManager';

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

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private duckingGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
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
  }> = new Map();

  // Active playing source nodes & clip gain nodes to stop on pause/seek
  private activeSources: Array<{
    source: AudioBufferSourceNode;
    gainNode: GainNode;
  }> = [];

  // Playback state
  private isPlaying: boolean = false;
  private playbackRequestId: number = 0;
  private isStartingPlayback: boolean = false;
  private playheadSeconds: number = 0;
  private playStartTimeCtx: number = 0;
  private playheadStartOffset: number = 0;
  private projectEndSeconds: number = 0;
  private scheduledStopTimer: any = null;
  private onPlaybackEndedCallback: (() => void) | null = null;

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
    const nodes = this.trackNodes.get(trackId);
    if (!nodes) return;
    pluginManager.connectPluginChain(trackId, nodes.gainNode, nodes.panNode as unknown as AudioNode);
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

    // Broadcast-ready Compressor
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.setValueAtTime(-24, this.ctx.currentTime);
    this.compressor.knee.setValueAtTime(12, this.ctx.currentTime);
    this.compressor.ratio.setValueAtTime(4, this.ctx.currentTime);
    this.compressor.attack.setValueAtTime(0.005, this.ctx.currentTime);
    this.compressor.release.setValueAtTime(0.25, this.ctx.currentTime);

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
    this.duckingGain.connect(this.compressor);
    this.compressor.connect(this.limiter);
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

  /**
   * Syncs track nodes with the project state
   */
  public syncTracks(tracks: Track[]): void {
    if (!this.ctx || !this.masterGain) return;

    const currentTrackIds = new Set(tracks.map(t => t.id));

    // Remove obsolete track nodes
    for (const [id, nodes] of this.trackNodes.entries()) {
      if (!currentTrackIds.has(id)) {
        try {
          nodes.gainNode.disconnect();
          nodes.panNode.disconnect();
          nodes.analyserNode.disconnect();
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

        // Path: Track Sources -> GainNode -> Plugins -> PanNode -> AnalyserNode -> MasterGain
        pluginManager.connectPluginChain(track.id, gainNode, panNode as unknown as AudioNode);
        (panNode as unknown as AudioNode).connect(analyserNode);
        analyserNode.connect(this.masterGain);

        nodes = { gainNode, panNode, analyserNode };
        this.trackNodes.set(track.id, nodes);
      }

      // Calculate effective volume based on Mute and Solo
      let effectiveVolume = track.volume;
      if (anySolo) {
        if (!track.solo || track.muted) {
          effectiveVolume = 0;
        }
      } else {
        if (track.muted) {
          effectiveVolume = 0;
        }
      }

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

    let effectiveVolume = track.volume;
    if (anySolo) {
      if (!track.solo || track.muted) {
        effectiveVolume = 0;
      }
    } else {
      if (track.muted) {
        effectiveVolume = 0;
      }
    }

    const now = this.ctx.currentTime;
    nodes.gainNode.gain.cancelScheduledValues(now);
    nodes.gainNode.gain.setValueAtTime(nodes.gainNode.gain.value, now);
    nodes.gainNode.gain.linearRampToValueAtTime(effectiveVolume, now + 0.02);

    if (nodes.panNode.pan) {
      nodes.panNode.pan.cancelScheduledValues(now);
      nodes.panNode.pan.setValueAtTime(track.pan, now);
    }
  }

  /**
   * Start playback from given or current position.
   * Enforces projectEnd constraint: stopping at the end of content.
   */
  public async play(project: Project, startPositionSeconds?: number): Promise<void> {
    const requestId = ++this.playbackRequestId;
    this.isStartingPlayback = true;
    let ctx: AudioContext;
    try {
      ctx = await this.init();
    } catch (error) {
      if (requestId === this.playbackRequestId) this.isStartingPlayback = false;
      throw error;
    }
    // A newer seek/pause/stop/play request supersedes this pending start.
    if (requestId !== this.playbackRequestId) return;
    this.isStartingPlayback = false;
    if (this.isPlaying) {
      this.clearScheduledStop();
      this.updateCurrentPosition();
      this.stopSources();
      this.isPlaying = false;
      this.stopPlaybackLoop();
    }

    this.syncTracks(project.tracks);

    // Compute projectEnd = max(clip.start + clip.duration) across all tracks
    let maxEnd = 0;
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        const end = clip.startSeconds + clip.durationSeconds;
        if (end > maxEnd) maxEnd = end;
      }
    }
    this.projectEndSeconds = maxEnd;

    let fromTime = typeof startPositionSeconds === 'number' ? startPositionSeconds : this.playheadSeconds;
    // Pressing Play when playhead is at the end restarts from 0
    if (this.projectEndSeconds > 0 && fromTime >= this.projectEndSeconds - 0.01) {
      fromTime = 0;
    }

    this.playheadSeconds = Math.max(0, fromTime);
    this.playStartTimeCtx = ctx.currentTime;
    this.playheadStartOffset = this.playheadSeconds;
    this.isPlaying = true;

    // Schedule all active clips in all tracks
    for (const track of project.tracks) {
      const trackNode = this.trackNodes.get(track.id);
      if (!trackNode) continue;

      for (const clip of track.clips) {
        this.scheduleClip(clip, trackNode.gainNode, fromTime);
      }
    }

    // Precise stop scheduled on the AudioContext clock
    this.clearScheduledStop();
    if (this.projectEndSeconds > 0) {
      const durationUntilEnd = Math.max(0, this.projectEndSeconds - this.playheadSeconds);
      this.scheduledStopTimer = setTimeout(() => {
        if (this.isPlaying) {
          this.stopSources();
          this.isPlaying = false;
          this.playheadSeconds = this.projectEndSeconds;
          this.stopPlaybackLoop();
          if (this.onTimeUpdateCallback) {
            this.onTimeUpdateCallback(this.projectEndSeconds);
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
    const asset = this.assets.get(clip.assetId);
    if (!asset || !asset.buffer) return;

    const clipEnd = clip.startSeconds + clip.durationSeconds;
    // Check if clip is already passed
    if (clipEnd <= currentPlayhead) return;

    let whenToStartInCtx = 0;
    let offsetInAudioBuffer = 0;
    let durationToPlay = 0;

    if (clip.startSeconds >= currentPlayhead) {
      // Clip starts in the future relative to current playhead
      whenToStartInCtx = this.ctx.currentTime + (clip.startSeconds - currentPlayhead);
      offsetInAudioBuffer = clip.offsetSeconds;
      durationToPlay = clip.durationSeconds;
    } else {
      // Playhead is in the middle of this clip
      const elapsedInClip = currentPlayhead - clip.startSeconds;
      whenToStartInCtx = this.ctx.currentTime;
      offsetInAudioBuffer = clip.offsetSeconds + elapsedInClip;
      durationToPlay = clip.durationSeconds - elapsedInClip;
    }

    if (durationToPlay <= 0) return;

    // Create source and clip-level gain node (for clip gain + fades)
    const source = this.ctx.createBufferSource();
    source.buffer = asset.buffer;

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

    source.connect(clipGain);
    clipGain.connect(destination);

    try {
      source.start(whenToStartInCtx, offsetInAudioBuffer, durationToPlay);
      this.activeSources.push({ source, gainNode: clipGain });
    } catch {
      // Buffer start exception safeguard
    }
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
    this.playbackRequestId++;
    this.isStartingPlayback = false;
    if (!this.isPlaying) return;
    this.clearScheduledStop();
    this.updateCurrentPosition();
    this.stopSources();
    this.isPlaying = false;
    this.stopPlaybackLoop();
  }

  public stop(): void {
    this.playbackRequestId++;
    this.isStartingPlayback = false;
    this.clearScheduledStop();
    this.stopSources();
    this.isPlaying = false;
    this.playheadSeconds = 0;
    this.stopPlaybackLoop();
    if (this.onTimeUpdateCallback) {
      this.onTimeUpdateCallback(0);
    }
  }

  public seek(toSeconds: number, project?: Project): void {
    const wasPlaying = this.isPlaying || this.isStartingPlayback;
    // Invalidate any play() still waiting for AudioContext initialization.
    this.playbackRequestId++;
    this.isStartingPlayback = false;
    this.clearScheduledStop();
    if (this.isPlaying) this.updateCurrentPosition();
    this.stopSources();
    this.isPlaying = false;
    this.stopPlaybackLoop();

    if (project) {
      let projectEnd = 0;
      for (const track of project.tracks) {
        for (const clip of track.clips) {
          projectEnd = Math.max(projectEnd, clip.startSeconds + clip.durationSeconds);
        }
      }
      this.projectEndSeconds = projectEnd;
    }

    const clamped = this.projectEndSeconds > 0
      ? Math.min(Math.max(0, toSeconds), this.projectEndSeconds)
      : Math.max(0, toSeconds);
    this.playheadSeconds = clamped;
    if (this.onTimeUpdateCallback) this.onTimeUpdateCallback(clamped);

    // Each scrub replaces the previous scheduled restart; play() guards async races.
    if (wasPlaying && project) void this.play(project, clamped);
  }

  private stopSources(): void {
    this.clearScheduledStop();
    for (const item of this.activeSources) {
      try {
        item.gainNode.gain.cancelScheduledValues(0);
        item.source.stop();
        item.source.disconnect();
        item.gainNode.disconnect();
      } catch {
        // already stopped
      }
    }
    this.activeSources = [];
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
        if (this.projectEndSeconds > 0 && t >= this.projectEndSeconds) {
          this.stopSources();
          this.isPlaying = false;
          this.playheadSeconds = this.projectEndSeconds;
          this.stopPlaybackLoop();
          this.clearScheduledStop();
          if (this.onTimeUpdateCallback) {
            this.onTimeUpdateCallback(this.projectEndSeconds);
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

  public setMasterCompressor(threshold: number, ratio: number, attackMs: number, releaseMs: number): void {
    if (!this.ctx || !this.compressor) return;
    const now = this.ctx.currentTime;
    this.compressor.threshold.setValueAtTime(threshold, now);
    this.compressor.ratio.setValueAtTime(ratio, now);
    this.compressor.attack.setValueAtTime(attackMs / 1000, now);
    this.compressor.release.setValueAtTime(releaseMs / 1000, now);
  }

  public setMasterLimiterCeiling(ceilingDbTP: number): void {
    if (!this.ctx || !this.limiter) return;
    const now = this.ctx.currentTime;
    this.limiter.threshold.setValueAtTime(ceilingDbTP, now);
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
