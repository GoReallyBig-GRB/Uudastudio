/**
 * X-PRO AUDIO - DSP Tool Modals
 * Interactive dialogs for Amplify, Dynamics Compressor, Speech Enhancement & Denoise,
 * Change Pitch, and Change Speed with real-time before/after preview.
 */

import React, { useState, useEffect, useRef } from 'react';
import { PresetBar } from './PresetBar';
import { COMPRESS_PRESETS, DENOISE_PRESETS, type DenoisePreset } from './dspPresets';
import { loadCustomPresets, removeCustomPreset, saveCustomPreset } from './customPresets';
import { DEFAULT_GAP_CLEANUP_DB } from '../audio/dsp/denoiseStream';
import {
  Volume2,
  Sliders,
  Scissors,
  Wand2,
  Music,
  Gauge,
  AlertTriangle,
  Check,
  X,
  AudioWaveform,
  Play,
  Square,
  RefreshCw,
  Activity,
  Headphones,
  Repeat,
} from 'lucide-react';
import {
  Clip,
  Asset,
  AmplifyParams,
  CompressorParams,
  DenoiseParams,
  PitchParams,
  SpeedParams,
} from '../types';
import { formatVolumeDb } from '../utils/formatters';
import { processBasicDenoise } from '../audio/dsp/denoiser';
import { processCompression } from '../audio/dsp/compressor';
import { NoisePrint, learnNoisePrint, quietestStretch } from '../audio/dsp/noisePrint';
import { processPitchShift, processTimeStretch } from '../audio/dsp/wsola';
import { PITCH_PRESETS, presetFor } from '../audio/dsp/pitchPresets';
import { ProgressIndicator } from './ui';

export type DspModalType = 'amplify' | 'compress' | 'denoise' | 'pitch' | 'speed' | 'normalize' | 'enhance' | null;

interface DspModalsProps {
  activeModal: DspModalType;
  clip: Clip | null;
  asset: Asset | null;
  onClose: () => void;
  onApplyAmplify: (params: AmplifyParams, bakeBuffer: boolean) => Promise<void>;
  onApplyCompressor: (params: CompressorParams) => Promise<void>;
  onApplyDenoise: (params: DenoiseParams) => Promise<void>;
  onApplyPitch: (params: PitchParams) => Promise<void>;
  onApplySpeed: (params: SpeedParams) => Promise<void>;
  /** Set while a long clip is processed block by block */
  progress?: { fraction: number; label: string } | null;
  /** Stop a running block-by-block job (nothing is changed) */
  onStopProcessing?: () => void;
  /** The dialog previews a short excerpt of a long clip, not the whole clip */
  previewIsExcerpt?: boolean;
  /** Noise print learned from a highlighted range (the Noise sample button) */
  noisePrint?: NoisePrint | null;
  onSetNoisePrint?: (print: NoisePrint | null) => void;
}

const DEFAULT_COMP: CompressorParams = COMPRESS_PRESETS[0].params;
const podcast = DENOISE_PRESETS[1];
const DEFAULT_DENOISE: DenoiseParams = {
  highPassFreq: podcast.highPassFreq,
  noiseFloorThresholdDb: podcast.noiseFloorThresholdDb,
  reductionDb: podcast.reductionDb,
  attackMs: 8,
  releaseMs: 90,
  gapCleanupDb: podcast.gapCleanupDb,
};
const DEFAULT_NOISE_SENSITIVITY = podcast.sensitivity;
const DEFAULT_VOICE_PROTECTION = podcast.voiceProtection;
type DenoiseSetting = Pick<DenoisePreset, 'reductionDb' | 'sensitivity' | 'voiceProtection' | 'gapCleanupDb' | 'highPassFreq' | 'noiseFloorThresholdDb'>;

export const DspModals: React.FC<DspModalsProps> = ({
  activeModal,
  clip,
  asset,
  onClose,
  onApplyAmplify,
  onApplyCompressor,
  onApplyDenoise,
  onApplyPitch,
  onApplySpeed,
  progress = null,
  onStopProcessing,
  previewIsExcerpt = false,
  noisePrint = null,
  onSetNoisePrint,
}) => {
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const startedAtRef = useRef<number>(0);
  useEffect(() => {
    if (isProcessing) startedAtRef.current = Date.now();
  }, [isProcessing]);
  const [processError, setProcessError] = useState<string | null>(null);

  // Clear errors when modal changes
  useEffect(() => {
    setProcessError(null);
    stopPreview();
    // Every opening starts from the defaults, so the last job's settings never carry over to a new track
    if (activeModal) {
      setGainDb(3.0);
      setBakeAmplify(false);
      setCompParams(DEFAULT_COMP);
      setDenoiseParams(DEFAULT_DENOISE);
      setNoiseSensitivity(DEFAULT_NOISE_SENSITIVITY);
      setVoiceProtection(DEFAULT_VOICE_PROTECTION);
      setHearRemoved(false);
      setPitchSemitones(3);
      setSpeedRatio(0.8);
    }
  }, [activeModal]);

  // Amplify State
  const [gainDb, setGainDb] = useState<number>(3.0);
  const [bakeAmplify, setBakeAmplify] = useState<boolean>(false);

  // Compressor State
  const [compParams, setCompParams] = useState<CompressorParams>(DEFAULT_COMP);
  const [customComp, setCustomComp] = useState(() => loadCustomPresets<CompressorParams>('compress'));

  // Denoise State
  const [denoiseParams, setDenoiseParams] = useState<DenoiseParams>(DEFAULT_DENOISE);

  const [noiseSensitivity, setNoiseSensitivity] = useState<number>(DEFAULT_NOISE_SENSITIVITY);
  const [voiceProtection, setVoiceProtection] = useState<number>(DEFAULT_VOICE_PROTECTION);
  const [customDenoise, setCustomDenoise] = useState(() => loadCustomPresets<DenoiseSetting>('denoise'));
  const denoiseSetting = (): DenoiseSetting => ({
    reductionDb: denoiseParams.reductionDb,
    sensitivity: noiseSensitivity,
    voiceProtection,
    gapCleanupDb: denoiseParams.gapCleanupDb ?? DEFAULT_GAP_CLEANUP_DB,
    highPassFreq: denoiseParams.highPassFreq,
    noiseFloorThresholdDb: denoiseParams.noiseFloorThresholdDb,
  });
  const applyDenoiseSetting = (v: DenoiseSetting) => {
    setDenoiseParams({ ...denoiseParams, reductionDb: v.reductionDb, gapCleanupDb: v.gapCleanupDb, highPassFreq: v.highPassFreq, noiseFloorThresholdDb: v.noiseFloorThresholdDb });
    setNoiseSensitivity(v.sensitivity);
    setVoiceProtection(v.voiceProtection);
  };
  const sameDenoise = (a: DenoiseSetting, b: DenoiseSetting) =>
    a.reductionDb === b.reductionDb && a.highPassFreq === b.highPassFreq && a.noiseFloorThresholdDb === b.noiseFloorThresholdDb &&
    (!noisePrint || (a.sensitivity === b.sensitivity && a.voiceProtection === b.voiceProtection && a.gapCleanupDb === b.gapCleanupDb));
  /** Audition only what is being removed, to check that no voice is in it */
  const [hearRemoved, setHearRemoved] = useState<boolean>(false);
  /** What Denoise runs with: the noise print when there is one, else the basic gate */
  const effectiveDenoise: DenoiseParams = noisePrint ? { ...denoiseParams, print: noisePrint, sensitivity: noiseSensitivity, voiceProtection } : denoiseParams;

  // Pitch State
  const [pitchSemitones, setPitchSemitones] = useState<number>(3);

  // Speed State
  const [speedRatio, setSpeedRatio] = useState<number>(0.8);

  // Preview playback state: 'none' | 'before' | 'after'
  const [previewState, setPreviewState] = useState<'none' | 'before' | 'after'>('none');
  const [isLooping, setIsLooping] = useState<boolean>(false);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const previewCtxRef = useRef<AudioContext | null>(null);

  /** Each preview request gets a number; a slow one that finishes after a newer request started is thrown away instead of playing on top of it */
  const previewRequestRef = useRef(0);

  const stopPreview = () => {
    previewRequestRef.current += 1;
    if (previewSourceRef.current) {
      try {
        previewSourceRef.current.stop();
        previewSourceRef.current.disconnect();
      } catch {
        // already stopped
      }
      previewSourceRef.current = null;
    }
    setPreviewState('none');
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopPreview();
      if (previewCtxRef.current && previewCtxRef.current.state !== 'closed') {
        previewCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  /** No highlighted sample: take the quietest second of this clip as the noise sample (in-memory audio only) */
  const handleFindQuietPart = () => {
    if (!asset?.buffer || !clip) {
      setProcessError('Finding the quiet part works on audio that is loaded in memory. For a long track, highlight a stretch with no speech and press Noise sample.');
      return;
    }
    setProcessError(null);
    try {
      const sr = asset.buffer.sampleRate;
      const from = Math.max(0, Math.round((clip.offsetSeconds || 0) * sr));
      const to = Math.min(asset.buffer.length, from + Math.round(clip.durationSeconds * sr));
      const channels = Array.from({ length: Math.min(2, asset.buffer.numberOfChannels) }, (_, c) => asset.buffer!.getChannelData(c).subarray(from, to));
      const spot = quietestStretch(channels, sr, 1);
      if (!spot) throw new Error('This clip is too short to find a quiet part. Highlight a stretch with no speech and press Noise sample.');
      const print = learnNoisePrint(channels.map((ch) => ch.subarray(spot.start, spot.end)), sr, `Quietest second of ${clip.name}`);
      onSetNoisePrint?.(print);
    } catch (err: any) {
      setProcessError(err?.message || 'Could not find a quiet part.');
    }
  };

  const handleTogglePreview = async (mode: 'before' | 'after', isAutoRefresh = false) => {
    if (previewState === mode && !isAutoRefresh) {
      stopPreview();
      return;
    }

    if (!asset?.buffer) {
      setProcessError('No audio available for preview.');
      return;
    }

    stopPreview();
    const requestId = ++previewRequestRef.current;

    try {
      if (!previewCtxRef.current || previewCtxRef.current.state === 'closed') {
        previewCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (previewCtxRef.current.state === 'suspended') {
        await previewCtxRef.current.resume();
      }

      const rawBuffer = asset.buffer;
      // Extract a 6-10 second preview slice for instant responsive auditioning
      const sliceDuration = Math.min(8, rawBuffer.duration);
      const sliceFrames = Math.floor(sliceDuration * rawBuffer.sampleRate);
      const sliceBuffer = previewCtxRef.current.createBuffer(
        rawBuffer.numberOfChannels,
        sliceFrames,
        rawBuffer.sampleRate
      );

      const offsetFrames = Math.floor((clip?.offsetSeconds || 0) * rawBuffer.sampleRate);
      for (let ch = 0; ch < rawBuffer.numberOfChannels; ch++) {
        const fullData = rawBuffer.getChannelData(ch);
        const sliceData = sliceBuffer.getChannelData(ch);
        for (let i = 0; i < sliceFrames; i++) {
          const srcIdx = offsetFrames + i;
          sliceData[i] = srcIdx < fullData.length ? fullData[srcIdx] : 0;
        }
      }

      let bufferToPlay = sliceBuffer;
      if (mode === 'after') {
        if (activeModal === 'amplify') {
          const gainLinear = Math.pow(10, gainDb / 20);
          const outBuf = previewCtxRef.current.createBuffer(
            sliceBuffer.numberOfChannels,
            sliceBuffer.length,
            sliceBuffer.sampleRate
          );
          for (let ch = 0; ch < sliceBuffer.numberOfChannels; ch++) {
            const inData = sliceBuffer.getChannelData(ch);
            const outData = outBuf.getChannelData(ch);
            for (let i = 0; i < inData.length; i++) {
              let s = inData[i] * gainLinear;
              if (s > 1.0) s = 1.0;
              else if (s < -1.0) s = -1.0;
              outData[i] = s;
            }
          }
          bufferToPlay = outBuf;
        } else if (activeModal === 'compress') {
          // The same compressor the Apply button uses, so what you hear is what you get
          bufferToPlay = await processCompression(sliceBuffer, compParams);
        } else if (activeModal === 'pitch') {
          bufferToPlay = await processPitchShift(sliceBuffer, pitchSemitones);
        } else if (activeModal === 'speed') {
          bufferToPlay = await processTimeStretch(sliceBuffer, speedRatio);
        } else if (activeModal === 'denoise') {
          bufferToPlay = await processBasicDenoise(sliceBuffer, noisePrint && hearRemoved ? { ...effectiveDenoise, listenRemoved: true } : effectiveDenoise);
        }
      }

      // A newer request (the sliders moved while this one was rendering) or a Stop has taken over: do not start a second copy
      if (requestId !== previewRequestRef.current) return;
      const source = previewCtxRef.current.createBufferSource();
      source.buffer = bufferToPlay;
      source.loop = isLooping;
      source.connect(previewCtxRef.current.destination);

      source.onended = () => {
        // A source that was replaced (the sliders moved, or Stop) ends later on its own; it must not reset the new one's state
        if (!source.loop && previewSourceRef.current === source) {
          previewSourceRef.current = null;
          setPreviewState('none');
        }
      };

      source.start(0);
      previewSourceRef.current = source;
      setPreviewState(mode);
    } catch (err: any) {
      setProcessError('Audio preview error: ' + (err?.message || 'unknown error'));
      setPreviewState('none');
    }
  };

  // 300ms debounce: update audition when parameters change during playback
  useEffect(() => {
    if (previewState !== 'after') return;
    const timer = setTimeout(() => {
      handleTogglePreview('after', true);
    }, 300);
    return () => clearTimeout(timer);
  }, [gainDb, compParams, pitchSemitones, speedRatio, denoiseParams, noisePrint, noiseSensitivity, voiceProtection, hearRemoved]);

  // Update looping dynamically on active source
  useEffect(() => {
    if (previewSourceRef.current) {
      previewSourceRef.current.loop = isLooping;
    }
  }, [isLooping]);

  // Reusable Preview Audition Bar Component
  const renderPreviewAuditionBar = () => (
    <div className="p-3 rounded bg-surface-1 border border-accent/30 space-y-2 mt-3">
      <div className="flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1.5 font-semibold text-ink">
          <Headphones className="w-3.5 h-3.5 text-accent" />
          <span>Real-time Audio Preview</span>
        </div>
        <div className="flex items-center gap-2">
          {previewState !== 'none' && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-ok animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-ok" />
              Playing {previewState === 'after' ? (activeModal === 'denoise' && noisePrint && hearRemoved ? 'Removed noise only' : 'Processed (B)') : 'Original (A)'}
            </span>
          )}
          <button
            type="button"
            onClick={() => setIsLooping(!isLooping)}
            title={isLooping ? 'Looping enabled' : 'Click to enable loop'}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer border ${
              isLooping
                ? 'bg-accent-soft text-accent border-accent/50'
                : 'bg-surface-2 text-ink-dim border-line-strong/60 hover:text-ink'
            }`}
          >
            <Repeat className="w-3 h-3" />
            <span>Loop</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => handleTogglePreview('before')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded font-medium text-[11px] transition-all cursor-pointer ${
            previewState === 'before'
              ? 'bg-warn text-surface-0 font-bold'
              : 'bg-surface-2 hover:bg-surface-3 text-ink'
          }`}
        >
          {previewState === 'before' ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3" />}
          <span>Audition Original (A)</span>
        </button>

        <button
          type="button"
          onClick={() => handleTogglePreview('after')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded font-medium text-[11px] transition-all cursor-pointer ${
            previewState === 'after'
              ? 'bg-accent text-surface-0 font-bold'
              : 'bg-accent/10 hover:bg-accent/20 text-accent border border-accent/50'
          }`}
        >
          {previewState === 'after' ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
          <span>Audition Processed (B)</span>
        </button>

        {previewState !== 'none' && (
          <button
            type="button"
            onClick={stopPreview}
            title="Stop Preview"
            className="px-2.5 py-1.5 rounded bg-surface-2 hover:bg-surface-3 text-ink-dim cursor-pointer"
          >
            <Square className="w-3 h-3 fill-current" />
          </button>
        )}
      </div>
    </div>
  );

  // Canvas ref for compressor curve
  const compCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Calculate current peak of clip
  const currentPeak = React.useMemo(() => {
    if (!asset || !asset.buffer) return 0.5;
    const ch0 = asset.buffer.getChannelData(0);
    let max = 0;
    const step = Math.max(1, Math.floor(ch0.length / 5000));
    for (let i = 0; i < ch0.length; i += step) {
      const val = Math.abs(ch0[i]);
      if (val > max) max = val;
    }
    return max * (clip?.gain || 1.0);
  }, [asset, clip]);

  // Projected peak after amplification
  const amplifiedPeak = currentPeak * Math.pow(10, gainDb / 20);
  const willClip = amplifiedPeak > 1.0;
  const clipExcessDb = willClip ? (20 * Math.log10(amplifiedPeak)).toFixed(1) : null;

  // Draw compressor transfer curve
  useEffect(() => {
    const canvas = compCanvasRef.current;
    if (!canvas || activeModal !== 'compress') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Grid: -60 dB to 0 dB
    ctx.fillStyle = '#0b0b10';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#222230';
    ctx.lineWidth = 1;
    for (let db = -50; db <= 0; db += 10) {
      const x = ((db + 60) / 60) * w;
      const y = h - ((db + 60) / 60) * h;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // 1:1 diagonal (uncompressed)
    ctx.strokeStyle = '#444455';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(w, 0);
    ctx.stroke();
    ctx.setLineDash([]);

    // Compressed curve
    ctx.strokeStyle = '#00F0FF';
    ctx.lineWidth = 2.5;
    ctx.beginPath();

    const thresh = compParams.thresholdDb;
    const ratio = compParams.ratio;
    const makeup = compParams.makeupGainDb;

    for (let xPx = 0; xPx <= w; xPx++) {
      const inDb = (xPx / w) * 60 - 60;
      let outDb = inDb;
      if (inDb > thresh) {
        outDb = thresh + (inDb - thresh) / ratio;
      }
      outDb += makeup;
      const yPx = h - ((outDb + 60) / 60) * h;

      if (xPx === 0) ctx.moveTo(xPx, yPx);
      else ctx.lineTo(xPx, yPx);
    }
    ctx.stroke();

    // Threshold indicator line
    const threshX = ((thresh + 60) / 60) * w;
    ctx.strokeStyle = '#FF3366';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(threshX, 0);
    ctx.lineTo(threshX, h);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [activeModal, compParams]);

  if (!activeModal) return null;

  const handleAction = async (fn: () => Promise<void>) => {
    setIsProcessing(true);
    setProcessError(null);
    stopPreview();
    try {
      await fn();
      onClose();
    } catch (err: any) {
      setProcessError(err?.message || 'Processing failed. Please check your audio buffer.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-2 sm:p-4">
      <div className="w-full max-w-lg max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] bg-[#0e0e14] border border-accent/30 rounded-xl shadow-2xl overflow-hidden flex flex-col text-xs text-ink animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line bg-surface-2">
          <div className="flex items-center gap-2">
            {activeModal === 'amplify' && <Volume2 className="w-4 h-4 text-accent" />}
            {activeModal === 'compress' && <Sliders className="w-4 h-4 text-accent" />}
            {activeModal === 'denoise' && <AudioWaveform className="w-4 h-4 text-accent" />}
            {activeModal === 'pitch' && <Music className="w-4 h-4 text-accent" />}
            {activeModal === 'speed' && <Gauge className="w-4 h-4 text-accent" />}
            <h2 className="font-bold text-sm tracking-wide text-ink uppercase">
              {activeModal === 'amplify' && 'Amplify / Gain Adjustment'}
              {activeModal === 'compress' && 'Dynamics Compressor'}
              {activeModal === 'denoise' && 'Speech Enhancement & Denoise'}
              {activeModal === 'pitch' && 'Change Pitch (WSOLA)'}
              {activeModal === 'speed' && 'Change Speed / Time-Stretch'}
            </h2>
          </div>
          <button
            onClick={() => {
              stopPreview();
              onClose();
            }}
            disabled={isProcessing}
            className="p-1 rounded hover:bg-surface-2 text-ink-dim hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error message */}
        {processError && (
          <div className="px-5 py-2.5 bg-danger/10 border-b border-danger text-danger text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
            <span>{processError}</span>
          </div>
        )}

        {/* Body */}
        <div className="p-3 sm:p-5 space-y-4 min-h-0 flex-1 overflow-y-auto">
          {/* Target clip banner */}
          <div className="flex items-center justify-between px-3 py-1.5 rounded bg-surface-1/80 border border-line text-[11px] text-ink-dim">
            <span>
              Target: <strong className="text-ink">{clip?.name || 'Selected Clip'}</strong>
            </span>
            <span className="mono-nums">Duration: {clip?.durationSeconds.toFixed(2)}s</span>
          </div>

          {/* 1. AMPLIFY MODAL */}
          {activeModal === 'amplify' && (
            <div className="space-y-3.5">
              <div className="flex justify-between text-ink-dim font-medium">
                <span>Amplification Gain</span>
                <span className={`mono-nums font-bold ${gainDb > 0 ? 'text-accent' : 'text-ink-dim'}`}>
                  {gainDb > 0 ? `+${gainDb.toFixed(1)}` : gainDb.toFixed(1)} dB
                </span>
              </div>
              <input
                type="range"
                min="-24"
                max="24"
                step="0.5"
                value={gainDb}
                onChange={(e) => setGainDb(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-surface-2 rounded appearance-none cursor-pointer"
              />

              {/* Peak meters and clip warnings */}
              <div className="p-3 rounded bg-surface-1 border border-line space-y-2">
                <div className="flex justify-between text-[11px] text-ink-dim">
                  <span>Current Clip Peak:</span>
                  <span className="mono-nums text-ink">{formatVolumeDb(currentPeak)}</span>
                </div>
                <div className="flex justify-between text-[11px] text-ink-dim">
                  <span>New Projected Peak:</span>
                  <span className={`mono-nums font-bold ${willClip ? 'text-danger' : 'text-ok'}`}>
                    {formatVolumeDb(amplifiedPeak)}
                  </span>
                </div>

                {willClip && (
                  <div className="flex items-center gap-2 pt-1 text-danger text-[11px]">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>Warning: Will clip by ~+{clipExcessDb} dB! Reduce gain or allow limiter.</span>
                  </div>
                )}
              </div>

              {/* Quick normalization helper */}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    if (currentPeak > 0) {
                      const targetGain = 20 * Math.log10(0.891 / currentPeak); // peak to -1 dBFS
                      setGainDb(Math.round(targetGain * 10) / 10);
                    }
                  }}
                  className="px-2.5 py-1 rounded bg-surface-2 hover:bg-surface-3 text-[11px] text-ink-dim transition-colors"
                >
                  Peak to -1 dBFS (Broadcast Safe)
                </button>
                <button
                  type="button"
                  onClick={() => setGainDb(0)}
                  className="px-2.5 py-1 rounded bg-surface-2 hover:bg-surface-3 text-[11px] text-ink-dim transition-colors"
                >
                  Reset (0 dB)
                </button>
              </div>

              {/* Bake into buffer vs non-destructive clip gain */}
              <label className="flex items-center gap-2 pt-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={bakeAmplify}
                  onChange={(e) => setBakeAmplify(e.target.checked)}
                  className="rounded border-line-strong bg-surface-1 text-accent focus:ring-0"
                />
                <span className="text-ink-dim">
                  Bake directly into audio buffer (Offline render; irreversible in buffer)
                </span>
              </label>

              {/* Real-Time Preview Audition Bar */}
              {renderPreviewAuditionBar()}
            </div>
          )}

          {/* 2. COMPRESSOR MODAL */}
          {activeModal === 'compress' && (
            <div className="space-y-3.5">
              <PresetBar
                presets={COMPRESS_PRESETS}
                activeIndex={COMPRESS_PRESETS.findIndex((p) => JSON.stringify(p.params) === JSON.stringify(compParams))}
                onPick={(i) => setCompParams(COMPRESS_PRESETS[i].params)}
                custom={customComp}
                activeCustomIndex={customComp.findIndex((p) => JSON.stringify(p.value) === JSON.stringify(compParams))}
                onPickCustom={(i) => setCompParams(customComp[i].value)}
                onRemoveCustom={(n) => setCustomComp(removeCustomPreset<CompressorParams>('compress', n))}
                onSave={(n) => setCustomComp(saveCustomPreset('compress', n, compParams))}
              />
              <div className="flex justify-center">
                <canvas
                  ref={compCanvasRef}
                  width={340}
                  height={130}
                  className="rounded border border-line shadow-inner bg-[#0b0b10]"
                />
              </div>

              <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3 text-[11px]">
                <div>
                  <div className="flex justify-between text-ink-dim mb-0.5">
                    <span>Threshold</span>
                    <span className="mono-nums text-accent font-semibold">{compParams.thresholdDb} dB</span>
                  </div>
                  <input
                    type="range"
                    min="-40"
                    max="0"
                    step="1"
                    value={compParams.thresholdDb}
                    onChange={(e) => setCompParams({ ...compParams, thresholdDb: parseInt(e.target.value) })}
                    className="w-full h-1 bg-surface-2 rounded appearance-none cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-ink-dim mb-0.5">
                    <span>Ratio</span>
                    <span className="mono-nums text-accent font-semibold">{compParams.ratio}:1</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="20"
                    step="0.5"
                    value={compParams.ratio}
                    onChange={(e) => setCompParams({ ...compParams, ratio: parseFloat(e.target.value) })}
                    className="w-full h-1 bg-surface-2 rounded appearance-none cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-ink-dim mb-0.5">
                    <span>Attack</span>
                    <span className="mono-nums text-accent font-semibold">{compParams.attackMs} ms</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    step="1"
                    value={compParams.attackMs}
                    onChange={(e) => setCompParams({ ...compParams, attackMs: parseInt(e.target.value) })}
                    className="w-full h-1 bg-surface-2 rounded appearance-none cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-ink-dim mb-0.5">
                    <span>Release</span>
                    <span className="mono-nums text-accent font-semibold">{compParams.releaseMs} ms</span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="800"
                    step="10"
                    value={compParams.releaseMs}
                    onChange={(e) => setCompParams({ ...compParams, releaseMs: parseInt(e.target.value) })}
                    className="w-full h-1 bg-surface-2 rounded appearance-none cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-ink-dim mb-0.5">
                    <span>Knee</span>
                    <span className="mono-nums text-accent font-semibold">{compParams.kneeDb} dB</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    step="1"
                    value={compParams.kneeDb}
                    onChange={(e) => setCompParams({ ...compParams, kneeDb: parseInt(e.target.value) })}
                    className="w-full h-1 bg-surface-2 rounded appearance-none cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-ink-dim mb-0.5">
                    <span>Makeup Gain</span>
                    <span className="mono-nums text-accent font-semibold">+{compParams.makeupGainDb} dB</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="18"
                    step="0.5"
                    value={compParams.makeupGainDb}
                    onChange={(e) => setCompParams({ ...compParams, makeupGainDb: parseFloat(e.target.value) })}
                    className="w-full h-1 bg-surface-2 rounded appearance-none cursor-pointer"
                  />
                </div>
              </div>

              <div className="text-[10px] text-ink-faint font-mono pt-1">
                Render method: OfflineAudioContext &rarr; high-precision dynamic buffer replacement.
              </div>

              {/* Real-Time Preview Audition Bar */}
              {renderPreviewAuditionBar()}
            </div>
          )}

          {/* 3. SPEECH ENHANCEMENT & DENOISE MODAL */}
          {activeModal === 'denoise' && (
            <div className="space-y-3.5">
              <div className="p-2.5 rounded bg-accent/10 border border-accent/40 text-[11px] text-accent leading-relaxed">
                <div className="font-semibold text-accent flex items-center justify-between gap-1.5 mb-1">
                  <div className="flex items-center gap-1.5">
                    <AudioWaveform className="w-3.5 h-3.5 text-accent" />
                    High-Precision Speech Enhancement & Suppression
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/50">
                    DSP Engine
                  </span>
                </div>
                <span>
                  Remove steady background noise (hiss, hum, air conditioning) without touching the voice. Teach it the noise first, from a stretch with no speech, and it takes out only that noise from the whole track. Passing sounds (a street noise, a mic pump) are not steady: Quiet-gap cleanup below closes the pauses to remove them.
                </span>
              </div>

              <PresetBar
                presets={DENOISE_PRESETS}
                activeIndex={DENOISE_PRESETS.findIndex((p) => sameDenoise(p, denoiseSetting()))}
                onPick={(i) => applyDenoiseSetting(DENOISE_PRESETS[i])}
                custom={customDenoise}
                activeCustomIndex={customDenoise.findIndex((p) => sameDenoise(p.value, denoiseSetting()))}
                onPickCustom={(i) => applyDenoiseSetting(customDenoise[i].value)}
                onRemoveCustom={(n) => setCustomDenoise(removeCustomPreset<DenoiseSetting>('denoise', n))}
                onSave={(n) => setCustomDenoise(saveCustomPreset('denoise', n, denoiseSetting()))}
              />

              {/* Noise print */}
              <div className="p-3 rounded bg-surface-1/90 border border-line space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-ink font-medium text-[11px]">
                    <Activity className="w-3.5 h-3.5 text-accent" />
                    <span>Noise sample</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {noisePrint && (
                      <button
                        type="button"
                        onClick={() => onSetNoisePrint?.(null)}
                        className="px-2 py-1 rounded border border-line-strong text-ink-dim hover:bg-surface-2 text-[10px] cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleFindQuietPart}
                      disabled={!asset?.buffer}
                      title={asset?.buffer ? 'Use the quietest second of this clip as the noise sample' : 'Only for audio held in memory. For a long track, highlight a quiet stretch and press Noise sample.'}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-accent hover:bg-accent text-black font-bold text-[10px] transition-colors cursor-pointer disabled:opacity-40"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>{noisePrint ? 'Use quietest second instead' : 'Find quiet part'}</span>
                    </button>
                  </div>
                </div>

                {noisePrint ? (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex justify-between text-[10px] text-ink-dim">
                      <span>Learned from</span>
                      <span className="mono-nums text-ok font-mono">{noisePrint.label} ({noisePrint.seconds.toFixed(1)} s)</span>
                    </div>
                    {/* What the noise looks like: average level in 24 bands from low to high */}
                    <div className="flex items-end gap-px h-8 pt-1 px-1 bg-black/60 rounded border border-line">
                      {(() => {
                        const bands = 24;
                        const edges = Array.from({ length: bands + 1 }, (_, i) => Math.round(Math.pow(noisePrint.power.length - 1, i / bands)));
                        const levels = Array.from({ length: bands }, (_, b) => {
                          const lo = edges[b], hi = Math.max(edges[b] + 1, edges[b + 1]);
                          let sum = 0;
                          for (let k = lo; k < hi && k < noisePrint.power.length; k++) sum += noisePrint.power[k];
                          return 10 * Math.log10(sum / (hi - lo) + 1e-12);
                        });
                        const top = Math.max(...levels), bottom = top - 50;
                        return levels.map((v, i) => (
                          <div key={i} className="flex-1 h-full flex items-end">
                            <div style={{ height: `${Math.max(6, Math.min(100, ((v - bottom) / 50) * 100))}%` }} className="w-full bg-accent/70 rounded-t-xs" />
                          </div>
                        ));
                      })()}
                    </div>
                    <div className="flex justify-between text-[9px] text-ink-faint font-mono">
                      <span>low</span>
                      <span>frequency</span>
                      <span>high</span>
                    </div>
                    {noisePrint.loudnessSpreadDb > 6 && (
                      <div className="text-[10px] text-warn">
                        This sample has loud moments in it. Speech or other sound in the sample is treated as noise; a stretch with only background noise works best.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-[10px] text-ink-dim leading-relaxed">
                    <span className="text-ink">Best:</span> close this, highlight a few seconds with no speech (Range tool, X), press <span className="text-ink">Noise sample</span> in Quick Actions or the toolbar, then open Denoise again. Or press &ldquo;Find quiet part&rdquo; to pick the quietest second of this clip. With no sample, a basic noise gate is used.
                  </div>
                )}
              </div>

              {/* Sliders */}
              <div className="space-y-3 pt-1">
                {noisePrint ? (
                  <>
                    <div>
                      <div className="flex justify-between text-ink-dim mb-1">
                        <span>Reduction</span>
                        <span className="mono-nums text-accent font-semibold">-{denoiseParams.reductionDb} dB</span>
                      </div>
                      <input
                        type="range" min="3" max="30" step="1"
                        value={denoiseParams.reductionDb}
                        onChange={(e) => setDenoiseParams({ ...denoiseParams, reductionDb: parseInt(e.target.value) })}
                        className="w-full h-1.5 bg-surface-2 rounded appearance-none cursor-pointer"
                      />
                      <div className="text-[10px] text-ink-faint mt-0.5">How far the noise is turned down</div>
                    </div>
                    <div>
                      <div className="flex justify-between text-ink-dim mb-1">
                        <span>Sensitivity</span>
                        <span className="mono-nums text-accent font-semibold">{noiseSensitivity.toFixed(1)}</span>
                      </div>
                      <input
                        type="range" min="1" max="4" step="0.1"
                        value={noiseSensitivity}
                        onChange={(e) => setNoiseSensitivity(parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-surface-2 rounded appearance-none cursor-pointer"
                      />
                      <div className="text-[10px] text-ink-faint mt-0.5">Higher also removes noise a little louder than the sample, but too high makes the voice thin</div>
                    </div>
                    <div>
                      <div className="flex justify-between text-ink-dim mb-1">
                        <span>Voice protection</span>
                        <span className="mono-nums text-accent font-semibold">{Math.round(voiceProtection * 100)}%</span>
                      </div>
                      <input
                        type="range" min="0" max="1" step="0.05"
                        value={voiceProtection}
                        onChange={(e) => setVoiceProtection(parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-surface-2 rounded appearance-none cursor-pointer"
                      />
                      <div className="text-[10px] text-ink-faint mt-0.5">Higher lets the voice through faster and eases the cut where it is unclear whether it is voice or noise</div>
                    </div>
                    <div>
                      <div className="flex justify-between text-ink-dim mb-1">
                        <span>Quiet-gap cleanup</span>
                        <span className="mono-nums text-accent font-semibold">{(denoiseParams.gapCleanupDb ?? DEFAULT_GAP_CLEANUP_DB) === 0 ? 'Off' : `${denoiseParams.gapCleanupDb ?? DEFAULT_GAP_CLEANUP_DB} dB`}</span>
                      </div>
                      <input
                        type="range" min="0" max="40" step="1"
                        value={denoiseParams.gapCleanupDb ?? DEFAULT_GAP_CLEANUP_DB}
                        onChange={(e) => setDenoiseParams({ ...denoiseParams, gapCleanupDb: parseInt(e.target.value) })}
                        className="w-full h-1.5 bg-surface-2 rounded appearance-none cursor-pointer"
                      />
                      <div className="text-[10px] text-ink-faint mt-0.5">The noise sample only removes steady noise. This also closes the pauses between phrases: anything less than this many dB above the sampled noise is turned down, which takes out a passing street sound, a mic pump or a breath. Speech is far above that level. Raise it until you hear the sound go; lower it if word endings are cut.</div>
                    </div>
                    <label className="flex items-start gap-2 text-[11px] text-ink-dim cursor-pointer">
                      <input type="checkbox" checked={hearRemoved} onChange={(e) => setHearRemoved(e.target.checked)} className="mt-0.5" />
                      <span>
                        Hear only what is being removed
                        <span className="block text-[10px] text-ink-faint">If you can hear the voice in it, lower Reduction or Sensitivity, or raise Voice protection. Aim for hearing only noise.</span>
                      </span>
                    </label>
                  </>
                ) : (
                  <>
                <div>
                  <div className="flex justify-between text-ink-dim mb-1">
                    <span>High-Pass Rumble Cut (24dB/oct)</span>
                    <span className="mono-nums text-accent font-semibold">{denoiseParams.highPassFreq} Hz</span>
                  </div>
                  <input
                    type="range"
                    min="40"
                    max="160"
                    step="5"
                    value={denoiseParams.highPassFreq}
                    onChange={(e) => setDenoiseParams({ ...denoiseParams, highPassFreq: parseInt(e.target.value) })}
                    className="w-full h-1.5 bg-surface-2 rounded appearance-none cursor-pointer"
                  />
                  <div className="text-[10px] text-ink-faint mt-0.5">Strips air conditioning rumble and mechanical mic vibrations</div>
                </div>

                <div>
                  <div className="flex justify-between text-ink-dim mb-1">
                    <span>Noise Floor Threshold</span>
                    <span className="mono-nums text-accent font-semibold">{denoiseParams.noiseFloorThresholdDb} dB</span>
                  </div>
                  <input
                    type="range"
                    min="-60"
                    max="-15"
                    step="1"
                    value={denoiseParams.noiseFloorThresholdDb}
                    onChange={(e) => setDenoiseParams({ ...denoiseParams, noiseFloorThresholdDb: parseInt(e.target.value) })}
                    className="w-full h-1.5 bg-surface-2 rounded appearance-none cursor-pointer"
                  />
                  <div className="text-[10px] text-ink-faint mt-0.5">Signals below this energy will be smoothly attenuated</div>
                </div>

                <div>
                  <div className="flex justify-between text-ink-dim mb-1">
                    <span>Reduction Depth</span>
                    <span className="mono-nums text-accent font-semibold">-{denoiseParams.reductionDb} dB</span>
                  </div>
                  <input
                    type="range"
                    min="3"
                    max="30"
                    step="1"
                    value={denoiseParams.reductionDb}
                    onChange={(e) => setDenoiseParams({ ...denoiseParams, reductionDb: parseInt(e.target.value) })}
                    className="w-full h-1.5 bg-surface-2 rounded appearance-none cursor-pointer"
                  />
                  <div className="text-[10px] text-ink-faint mt-0.5">Amount of background attenuation applied between words</div>
                </div>

                <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3 pt-1">
                  <div>
                    <div className="flex justify-between text-ink-dim mb-0.5 text-[10px]">
                      <span>Attack Speed</span>
                      <span className="mono-nums text-accent">{denoiseParams.attackMs ?? 8} ms</span>
                    </div>
                    <input
                      type="range"
                      min="2"
                      max="30"
                      step="1"
                      value={denoiseParams.attackMs ?? 8}
                      onChange={(e) => setDenoiseParams({ ...denoiseParams, attackMs: parseInt(e.target.value) })}
                      className="w-full h-1 bg-surface-2 rounded appearance-none cursor-pointer"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-ink-dim mb-0.5 text-[10px]">
                      <span>Release Smoothing</span>
                      <span className="mono-nums text-accent">{denoiseParams.releaseMs ?? 90} ms</span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="250"
                      step="5"
                      value={denoiseParams.releaseMs ?? 90}
                      onChange={(e) => setDenoiseParams({ ...denoiseParams, releaseMs: parseInt(e.target.value) })}
                      className="w-full h-1 bg-surface-2 rounded appearance-none cursor-pointer"
                    />
                  </div>
                </div>
                  </>
                )}
              </div>

              {/* Real-time Before / After Audio Preview Player */}
              {renderPreviewAuditionBar()}
            </div>
          )}

          {/* 4. CHANGE PITCH MODAL */}
          {activeModal === 'pitch' && (
            <div className="space-y-3.5">
              <div className="flex flex-wrap gap-1.5">
                {PITCH_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    title={`${p.hint} (${p.semitones > 0 ? '+' : ''}${p.semitones} semitones)`}
                    onClick={() => setPitchSemitones(p.semitones)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer ${
                      presetFor(pitchSemitones)?.id === p.id
                        ? 'bg-accent border-accent text-black'
                        : 'bg-surface-1 border-line-strong hover:bg-surface-2 text-ink-dim'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex justify-between text-ink-dim font-medium">
                <span>{presetFor(pitchSemitones)?.label ?? 'Pitch Shift'}</span>
                <span className={`mono-nums font-bold ${pitchSemitones > 0 ? 'text-accent' : 'text-ink-dim'}`}>
                  {pitchSemitones > 0 ? `+${pitchSemitones}` : pitchSemitones} semitones
                </span>
              </div>
              <input
                type="range"
                min="-12"
                max="12"
                step="0.5"
                value={pitchSemitones}
                onChange={(e) => setPitchSemitones(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-surface-2 rounded appearance-none cursor-pointer"
              />

              <div className="flex flex-wrap gap-1.5 pt-1">
                {[-12, -7, -5, -2, 0, 2, 5, 7, 12].map((st) => (
                  <button
                    key={st}
                    onClick={() => setPitchSemitones(st)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                      pitchSemitones === st
                        ? 'bg-accent text-surface-0 font-bold'
                        : 'bg-surface-2 hover:bg-surface-3 text-ink-dim'
                    }`}
                  >
                    {st > 0 ? `+${st}` : st}
                  </button>
                ))}
              </div>

              <div className="p-2.5 rounded bg-surface-1/60 border border-line text-[10px] text-ink-dim leading-relaxed">
                <strong>Algorithm:</strong> WSOLA (Waveform Similarity Overlap-Add) combined with cubic Hermite resampling. The pitch lands on the target (checked to within a few cents), the duration and timing stay exact, and the edges of a range join the audio around it cleanly. Presets move the whole voice, character included.
              </div>

              {/* Real-Time Preview Audition Bar */}
              {renderPreviewAuditionBar()}
            </div>
          )}

          {/* 5. CHANGE SPEED MODAL */}
          {activeModal === 'speed' && (
            <div className="space-y-3.5">
              <div className="flex justify-between text-ink-dim font-medium">
                <span>Playback Speed</span>
                <span className="mono-nums text-accent font-bold text-sm">
                  {speedRatio.toFixed(2)}x ({speedRatio < 1 ? `Slower (-${Math.round((1 - speedRatio) * 100)}%)` : speedRatio > 1 ? `Faster (+${Math.round((speedRatio - 1) * 100)}%)` : 'Original'})
                </span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.05"
                value={speedRatio}
                onChange={(e) => setSpeedRatio(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-surface-2 rounded appearance-none cursor-pointer"
              />

              {/* Speed preset buttons */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[0.5, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 2.0].map((r) => (
                  <button
                    key={r}
                    onClick={() => setSpeedRatio(r)}
                    className={`px-2.5 py-1 rounded text-[10px] font-mono transition-colors ${
                      Math.abs(speedRatio - r) < 0.01
                        ? 'bg-accent text-surface-0 font-bold'
                        : 'bg-surface-2 hover:bg-surface-3 text-ink-dim'
                    }`}
                  >
                    {r.toFixed(2)}x
                  </button>
                ))}
              </div>

              <div className="p-2.5 rounded bg-surface-1/60 border border-line text-[10px] text-ink-dim leading-relaxed">
                <strong>Algorithm:</strong> WSOLA (Waveform Similarity Overlap-Add). Stretches or compresses timing while preserving exact pitch (no chipmunk effect).
              </div>

              {/* Real-Time Preview Audition Bar */}
              {renderPreviewAuditionBar()}
            </div>
          )}
        </div>

        {previewIsExcerpt && !progress && (
          <div className="px-5 py-2 border-t border-line bg-[#12121a] text-[11px] text-ink-dim">
            Long clip: the preview plays a short excerpt. Apply processes the whole clip in blocks.
          </div>
        )}
        {isProcessing && progress && (
          <div className="border-t border-line bg-surface-1 px-5 py-3">
            <ProgressIndicator
              fraction={progress.fraction}
              label={`Processing ${progress.label}`}
              onCancel={onStopProcessing}
              cancelLabel="Stop"
            />
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-line bg-surface-2 flex items-center justify-between">
          <button
            onClick={() => {
              // While a long render runs this button stops it (between blocks); otherwise it closes the dialog
              if (isProcessing) {
                onStopProcessing?.();
                return;
              }
              stopPreview();
              onClose();
            }}
            disabled={isProcessing && !onStopProcessing}
            className="px-3 py-1.5 rounded text-xs text-ink-dim hover:text-ink transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isProcessing && onStopProcessing ? 'Stop' : 'Cancel'}
          </button>

          <button
            disabled={isProcessing}
            onClick={() => {
              if (activeModal === 'amplify') {
                handleAction(() => onApplyAmplify({ gainDb }, bakeAmplify));
              } else if (activeModal === 'compress') {
                handleAction(() => onApplyCompressor(compParams));
              } else if (activeModal === 'denoise') {
                handleAction(() => onApplyDenoise(effectiveDenoise));
              } else if (activeModal === 'pitch') {
                handleAction(() => onApplyPitch({ semitones: pitchSemitones }));
              } else if (activeModal === 'speed') {
                handleAction(() => onApplySpeed({ speedRatio }));
              }
            }}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-accent hover:bg-accent text-black font-bold text-xs transition-all disabled:opacity-50 cursor-pointer"
          >
            {isProcessing ? (
              <span>Processing...</span>
            ) : (
              <>
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Apply {activeModal}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
