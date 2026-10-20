/**
 * X-PRO AUDIO - Audio Recorder Engine
 * Pure Web Audio API recording chain with 4-band hardware input EQ, live metering,
 * device selection, and capture to AudioBuffer.
 * NO UI imports.
 */

import { InputEQSettings, RecordingDeviceSettings } from '../types';
import { audioEngine, MeterData } from './engine';

export interface DeviceInfo {
  deviceId: string;
  label: string;
  groupId: string;
  kind: 'built-in' | 'usb' | 'interface' | 'default';
  channels: number; // 1 = mono, 2 = joint stereo
}

export interface StreamStats {
  sampleRate: number;
  channelCount: number;
  latencyMs: number | null;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

export class AudioRecorder {
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;

  // 4-Band Input EQ Filter Nodes
  private lowShelfFilter: BiquadFilterNode | null = null;
  private peak400Filter: BiquadFilterNode | null = null;
  private peak2500Filter: BiquadFilterNode | null = null;
  private highShelfFilter: BiquadFilterNode | null = null;

  // Metering & Destination Nodes
  private inputAnalyser: AnalyserNode | null = null;
  private streamDestination: MediaStreamAudioDestinationNode | null = null;
  private pcmProcessor: ScriptProcessorNode | null = null;

  // MediaRecorder & in-memory PCM buffers
  private mediaRecorder: MediaRecorder | null = null;
  private recordedBlobs: Blob[] = [];
  private pcmChunksLeft: Float32Array[] = [];
  private pcmChunksRight: Float32Array[] = [];
  private totalPcmSamples: number = 0;

  // State
  private isRecording: boolean = false;
  private recordStartTime: number = 0;
  private recordTimerId: number | null = null;
  private meterBuffer: Float32Array = new Float32Array(512);

  // Callbacks
  private onUnexpectedEndCallback: ((recoveredBuffer: AudioBuffer | null) => void) | null = null;

  /**
   * Enumerate available microphone / audio interface input devices
   */
  public async enumerateInputDevices(): Promise<DeviceInfo[]> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return [];
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((d) => d.kind === 'audioinput');

    return audioInputs.map((d, index) => {
      const labelLower = (d.label || '').toLowerCase();
      let kind: 'built-in' | 'usb' | 'interface' | 'default' = 'built-in';

      if (labelLower.includes('interface') || labelLower.includes('focusrite') || labelLower.includes('motu') || labelLower.includes('behringer') || labelLower.includes('scarlett') || labelLower.includes('mixer')) {
        kind = 'interface';
      } else if (labelLower.includes('usb') || labelLower.includes('yeti') || labelLower.includes('rode') || labelLower.includes('shure')) {
        kind = 'usb';
      } else if (d.deviceId === 'default') {
        kind = 'default';
      }

      return {
        deviceId: d.deviceId,
        label: d.label || `Audio Input ${index + 1}`,
        groupId: d.groupId,
        kind,
        channels: kind === 'interface' ? 2 : 1, // Interface defaults to joint stereo if reported
      };
    });
  }

  /**
   * Request microphone stream with studio constraints (default DSP turned off for clean raw audio)
   */
  public async setupStream(
    deviceSettings: RecordingDeviceSettings,
    eqSettings: InputEQSettings
  ): Promise<MediaStream> {
    const ctx = await audioEngine.init();

    // Tear down previous stream if changing devices
    this.teardownStream();

    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: deviceSettings.deviceId ? { exact: deviceSettings.deviceId } : undefined,
        echoCancellation: deviceSettings.echoCancellation,
        noiseSuppression: deviceSettings.noiseSuppression,
        autoGainControl: deviceSettings.autoGainControl,
        channelCount: { ideal: 2 },
      },
      video: false,
    };

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err: unknown) {
      const error = err as { name?: string; message?: string };
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        throw new Error(
          'Microphone permission was denied. Please allow microphone access in your browser site settings (click the lock/tune icon in the address bar) and click Record again.'
        );
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        throw new Error('No audio input device or microphone was detected on this system.');
      } else {
        throw new Error(`Microphone access error: ${error.message || 'Unknown device error'}`);
      }
    }

    // Monitor unexpected stream disconnection (e.g. mic unplugged)
    const track = this.mediaStream.getAudioTracks()[0];
    if (track) {
      track.onended = async () => {
        if (this.isRecording) {
          const recovered = await this.stopAndRecover();
          if (this.onUnexpectedEndCallback) {
            this.onUnexpectedEndCallback(recovered);
          }
        }
      };
    }

    // Build the virtual 4-band hardware input EQ audio graph
    this.setupAudioGraph(ctx, this.mediaStream, eqSettings);
    return this.mediaStream;
  }

  /**
   * Build the 4-band input EQ signal chain:
   * Source -> Low Shelf (80Hz) -> Peaking (400Hz, Q 1.2) -> Peaking (2500Hz, Q 1.5) -> High Shelf (8000Hz) -> Destination
   */
  private setupAudioGraph(ctx: AudioContext, stream: MediaStream, eq: InputEQSettings): void {
    this.sourceNode = ctx.createMediaStreamSource(stream);

    // 1. Low Shelf 80 Hz
    this.lowShelfFilter = ctx.createBiquadFilter();
    this.lowShelfFilter.type = 'lowshelf';
    this.lowShelfFilter.frequency.setValueAtTime(80, ctx.currentTime);

    // 2. Peaking 400 Hz (Q 1.2)
    this.peak400Filter = ctx.createBiquadFilter();
    this.peak400Filter.type = 'peaking';
    this.peak400Filter.frequency.setValueAtTime(400, ctx.currentTime);
    this.peak400Filter.Q.setValueAtTime(1.2, ctx.currentTime);

    // 3. Peaking 2500 Hz (Q 1.5)
    this.peak2500Filter = ctx.createBiquadFilter();
    this.peak2500Filter.type = 'peaking';
    this.peak2500Filter.frequency.setValueAtTime(2500, ctx.currentTime);
    this.peak2500Filter.Q.setValueAtTime(1.5, ctx.currentTime);

    // 4. High Shelf 8000 Hz
    this.highShelfFilter = ctx.createBiquadFilter();
    this.highShelfFilter.type = 'highshelf';
    this.highShelfFilter.frequency.setValueAtTime(8000, ctx.currentTime);

    // Apply current EQ gains
    this.updateEQ(eq);

    // Live Input Analyser for peak and RMS metering
    this.inputAnalyser = ctx.createAnalyser();
    this.inputAnalyser.fftSize = 512;
    this.inputAnalyser.smoothingTimeConstant = 0.6;

    // Stream Destination Node for MediaRecorder
    this.streamDestination = ctx.createMediaStreamDestination();

    // Signal Connection: Source -> LowShelf -> Peak400 -> Peak2500 -> HighShelf -> Analyser & Destination
    this.sourceNode.connect(this.lowShelfFilter);
    this.lowShelfFilter.connect(this.peak400Filter);
    this.peak400Filter.connect(this.peak2500Filter);
    this.peak2500Filter.connect(this.highShelfFilter);

    this.highShelfFilter.connect(this.inputAnalyser);
    this.highShelfFilter.connect(this.streamDestination);

    // Parallel PCM capture processor (guarantees uncompressed pristine buffer recovery)
    const bufferSize = 4096;
    this.pcmProcessor = ctx.createScriptProcessor(bufferSize, 2, 2);
    this.pcmProcessor.onaudioprocess = (e) => {
      if (!this.isRecording) return;
      const inL = e.inputBuffer.getChannelData(0);
      const inR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inL;

      this.pcmChunksLeft.push(new Float32Array(inL));
      this.pcmChunksRight.push(new Float32Array(inR));
      this.totalPcmSamples += inL.length;
    };

    this.highShelfFilter.connect(this.pcmProcessor);
    // Connect to dummy destination so ScriptProcessor keeps firing
    this.pcmProcessor.connect(ctx.destination);
  }

  /**
   * Update 4-band EQ parameters in real time before or during recording
   */
  public updateEQ(eq: InputEQSettings): void {
    const ctx = audioEngine.getContext();
    const now = ctx ? ctx.currentTime : 0;

    const gain1 = eq.bypassed ? 0 : eq.lowShelf80Hz;
    const gain2 = eq.bypassed ? 0 : eq.peak400Hz;
    const gain3 = eq.bypassed ? 0 : eq.peak2500Hz;
    const gain4 = eq.bypassed ? 0 : eq.highShelf8000Hz;

    if (this.lowShelfFilter) this.lowShelfFilter.gain.setValueAtTime(gain1, now);
    if (this.peak400Filter) this.peak400Filter.gain.setValueAtTime(gain2, now);
    if (this.peak2500Filter) this.peak2500Filter.gain.setValueAtTime(gain3, now);
    if (this.highShelfFilter) this.highShelfFilter.gain.setValueAtTime(gain4, now);
  }

  /**
   * Start recording session
   */
  public async startRecording(onTick?: (elapsedSeconds: number) => void): Promise<void> {
    const ctx = await audioEngine.init();

    if (!this.mediaStream || !this.streamDestination) {
      throw new Error('Recording stream is not initialized. Please select an input device.');
    }

    this.recordedBlobs = [];
    this.pcmChunksLeft = [];
    this.pcmChunksRight = [];
    this.totalPcmSamples = 0;
    this.isRecording = true;
    this.recordStartTime = ctx.currentTime;

    // Set up MediaRecorder
    try {
      const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      const supportedMime = mimeTypes.find((m) => MediaRecorder.isTypeSupported(m)) || '';

      this.mediaRecorder = new MediaRecorder(this.streamDestination.stream, supportedMime ? { mimeType: supportedMime } : undefined);
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedBlobs.push(e.data);
        }
      };
      this.mediaRecorder.start(200); // 200ms slice for low memory overhead
    } catch {
      // If MediaRecorder throws, PCM processor fallback handles it cleanly
      this.mediaRecorder = null;
    }

    // Elapsed timer
    if (onTick) {
      this.recordTimerId = window.setInterval(() => {
        if (this.isRecording && ctx) {
          const elapsed = ctx.currentTime - this.recordStartTime;
          onTick(elapsed);
        }
      }, 50);
    }
  }

  /**
   * Stop recording and decode captured audio into an AudioBuffer
   */
  public async stopRecording(): Promise<AudioBuffer> {
    const ctx = await audioEngine.init();
    this.isRecording = false;

    if (this.recordTimerId !== null) {
      clearInterval(this.recordTimerId);
      this.recordTimerId = null;
    }

    // Finalize MediaRecorder if active
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        this.mediaRecorder!.onstop = () => resolve();
        try {
          this.mediaRecorder!.stop();
        } catch {
          resolve();
        }
      });
    }

    // Try decoding MediaRecorder Blobs
    if (this.recordedBlobs.length > 0) {
      try {
        const fullBlob = new Blob(this.recordedBlobs, {
          type: this.mediaRecorder?.mimeType || 'audio/webm',
        });
        const arrayBuffer = await fullBlob.arrayBuffer();
        if (arrayBuffer.byteLength > 0) {
          const decoded = await ctx.decodeAudioData(arrayBuffer);
          return decoded;
        }
      } catch {
        // Fallback to PCM float buffers below
      }
    }

    // PCM Float32Array Fallback (rock-solid, 100% loss-free)
    return this.createBufferFromPCM(ctx);
  }

  /**
   * Emergency recovery when stream ends unexpectedly
   */
  private async stopAndRecover(): Promise<AudioBuffer | null> {
    try {
      return await this.stopRecording();
    } catch {
      return null;
    }
  }

  private createBufferFromPCM(ctx: AudioContext): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const totalSamples = Math.max(1, this.totalPcmSamples);
    const audioBuffer = ctx.createBuffer(2, totalSamples, sampleRate);

    const outL = audioBuffer.getChannelData(0);
    const outR = audioBuffer.getChannelData(1);

    let offset = 0;
    for (let i = 0; i < this.pcmChunksLeft.length; i++) {
      const chunkL = this.pcmChunksLeft[i];
      const chunkR = this.pcmChunksRight[i];
      outL.set(chunkL, offset);
      outR.set(chunkR, offset);
      offset += chunkL.length;
    }

    return audioBuffer;
  }

  /**
   * Read live Peak and RMS input levels
   */
  public getInputMeter(): MeterData {
    if (!this.inputAnalyser) {
      return { peak: 0, rms: 0, clip: false };
    }

    if (this.meterBuffer.length !== this.inputAnalyser.fftSize) {
      this.meterBuffer = new Float32Array(this.inputAnalyser.fftSize);
    }
    (this.inputAnalyser.getFloatTimeDomainData as (arr: Float32Array) => void)(this.meterBuffer);

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

  public getStreamStats(): StreamStats | null {
    if (!this.mediaStream) return null;
    const track = this.mediaStream.getAudioTracks()[0];
    if (!track) return null;

    const settings = track.getSettings();
    const ctx = audioEngine.getContext();
    const trackLatency = (settings as { latency?: number }).latency;

    return {
      sampleRate: settings.sampleRate || (ctx ? ctx.sampleRate : 48000),
      channelCount: settings.channelCount || 1,
      latencyMs: trackLatency ? Math.round(trackLatency * 1000) : (ctx ? Math.round(ctx.baseLatency * 1000) : null),
      echoCancellation: Boolean(settings.echoCancellation),
      noiseSuppression: Boolean(settings.noiseSuppression),
      autoGainControl: Boolean(settings.autoGainControl),
    };
  }

  public getIsRecording(): boolean {
    return this.isRecording;
  }

  public setOnUnexpectedEnd(cb: (recoveredBuffer: AudioBuffer | null) => void): void {
    this.onUnexpectedEndCallback = cb;
  }

  public teardownStream(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {}
      this.sourceNode = null;
    }
    if (this.pcmProcessor) {
      try {
        this.pcmProcessor.disconnect();
      } catch {}
      this.pcmProcessor = null;
    }
  }
}

export const audioRecorder = new AudioRecorder();
