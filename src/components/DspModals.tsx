/**
 * X-PRO AUDIO - DSP Tool Modals
 * Interactive dialogs for Amplify, Dynamics Compressor, Speech Enhancement & Denoise,
 * Change Pitch, and Change Speed with real-time before/after preview.
 */

import React, { useState, useEffect, useRef } from 'react';
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
  Sparkles,
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
import { analyzeNoiseProfile, processBasicDenoise, LearnedNoiseProfile } from '../audio/dsp/denoiser';
import { processPitchShift, processTimeStretch } from '../audio/dsp/wsola';

export type DspModalType = 'amplify' | 'compress' | 'denoise' | 'pitch' | 'speed' | null;

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
}

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
}) => {
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processError, setProcessError] = useState<string | null>(null);

  // Clear errors when modal changes
  useEffect(() => {
    setProcessError(null);
    stopPreview();
  }, [activeModal]);

  // Amplify State
  const [gainDb, setGainDb] = useState<number>(3.0);
  const [bakeAmplify, setBakeAmplify] = useState<boolean>(false);

  // Compressor State
  const [compParams, setCompParams] = useState<CompressorParams>({
    thresholdDb: -20,
    kneeDb: 8,
    ratio: 4,
    attackMs: 15,
    releaseMs: 180,
    makeupGainDb: 3,
  });

  // Denoise State
  const [denoiseParams, setDenoiseParams] = useState<DenoiseParams>({
    highPassFreq: 80,
    noiseFloorThresholdDb: -38,
    reductionDb: 14,
    attackMs: 8,
    releaseMs: 90,
  });

  const [learnedProfile, setLearnedProfile] = useState<LearnedNoiseProfile | null>(null);
  const [isLearning, setIsLearning] = useState<boolean>(false);

  // Pitch State
  const [pitchSemitones, setPitchSemitones] = useState<number>(3);

  // Speed State
  const [speedRatio, setSpeedRatio] = useState<number>(0.8);

  // Preview playback state: 'none' | 'before' | 'after'
  const [previewState, setPreviewState] = useState<'none' | 'before' | 'after'>('none');
  const [isLooping, setIsLooping] = useState<boolean>(false);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const previewCtxRef = useRef<AudioContext | null>(null);

  const stopPreview = () => {
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

  const handleLearnNoiseProfile = () => {
    if (!asset?.buffer) {
      setProcessError('No audio buffer available to analyze.');
      return;
    }
    setIsLearning(true);
    setProcessError(null);
    try {
      const profile = analyzeNoiseProfile(asset.buffer);
      setLearnedProfile(profile);
      setDenoiseParams((prev) => ({
        ...prev,
        noiseFloorThresholdDb: profile.recommendedThresholdDb,
        reductionDb: profile.recommendedReductionDb,
        learnedFloorDb: profile.learnedFloorDb,
      }));
    } catch (err: any) {
      setProcessError('Failed to analyze noise profile: ' + (err?.message || 'unknown error'));
    } finally {
      setIsLearning(false);
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
          const offlineCtx = new OfflineAudioContext(
            sliceBuffer.numberOfChannels,
            sliceBuffer.length,
            sliceBuffer.sampleRate
          );
          const src = offlineCtx.createBufferSource();
          src.buffer = sliceBuffer;
          const comp = offlineCtx.createDynamicsCompressor();
          comp.threshold.setValueAtTime(compParams.thresholdDb, 0);
          comp.ratio.setValueAtTime(compParams.ratio, 0);
          comp.attack.setValueAtTime(compParams.attackMs / 1000, 0);
          comp.release.setValueAtTime(compParams.releaseMs / 1000, 0);
          comp.knee.setValueAtTime(compParams.kneeDb, 0);
          const makeup = offlineCtx.createGain();
          makeup.gain.setValueAtTime(Math.pow(10, compParams.makeupGainDb / 20), 0);
          src.connect(comp);
          comp.connect(makeup);
          makeup.connect(offlineCtx.destination);
          src.start(0);
          bufferToPlay = await offlineCtx.startRendering();
        } else if (activeModal === 'pitch') {
          bufferToPlay = await processPitchShift(sliceBuffer, pitchSemitones);
        } else if (activeModal === 'speed') {
          bufferToPlay = await processTimeStretch(sliceBuffer, speedRatio);
        } else if (activeModal === 'denoise') {
          bufferToPlay = await processBasicDenoise(sliceBuffer, denoiseParams);
        }
      }

      const source = previewCtxRef.current.createBufferSource();
      source.buffer = bufferToPlay;
      source.loop = isLooping;
      source.connect(previewCtxRef.current.destination);

      source.onended = () => {
        if (!source.loop) {
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
  }, [gainDb, compParams, pitchSemitones, speedRatio, denoiseParams]);

  // Update looping dynamically on active source
  useEffect(() => {
    if (previewSourceRef.current) {
      previewSourceRef.current.loop = isLooping;
    }
  }, [isLooping]);

  // Reusable Preview Audition Bar Component
  const renderPreviewAuditionBar = () => (
    <div className="p-3 rounded bg-zinc-900 border border-cyan-500/30 space-y-2 mt-3">
      <div className="flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1.5 font-semibold text-zinc-200">
          <Headphones className="w-3.5 h-3.5 text-cyan-400" />
          <span>Real-time Audio Preview</span>
        </div>
        <div className="flex items-center gap-2">
          {previewState !== 'none' && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Playing {previewState === 'after' ? 'Processed (B)' : 'Original (A)'}
            </span>
          )}
          <button
            type="button"
            onClick={() => setIsLooping(!isLooping)}
            title={isLooping ? 'Looping enabled' : 'Click to enable loop'}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer border ${
              isLooping
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                : 'bg-zinc-800 text-zinc-400 border-zinc-700/60 hover:text-zinc-200'
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
              ? 'bg-amber-500 text-black font-bold shadow-[0_0_10px_rgba(245,158,11,0.4)]'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
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
              ? 'bg-cyan-400 text-black font-bold shadow-[0_0_12px_rgba(0,240,255,0.4)]'
              : 'bg-cyan-950/80 hover:bg-cyan-900/90 text-cyan-300 border border-cyan-600/50'
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
            className="px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer"
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
      <div className="w-full max-w-lg max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] bg-[#0e0e14] border border-cyan-500/30 rounded-xl shadow-2xl overflow-hidden flex flex-col text-xs text-zinc-200 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 bg-[#161622]">
          <div className="flex items-center gap-2">
            {activeModal === 'amplify' && <Volume2 className="w-4 h-4 text-cyan-400" />}
            {activeModal === 'compress' && <Sliders className="w-4 h-4 text-cyan-400" />}
            {activeModal === 'denoise' && <Sparkles className="w-4 h-4 text-cyan-400" />}
            {activeModal === 'pitch' && <Music className="w-4 h-4 text-cyan-400" />}
            {activeModal === 'speed' && <Gauge className="w-4 h-4 text-cyan-400" />}
            <h2 className="font-bold text-sm tracking-wide text-zinc-100 uppercase">
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
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error message */}
        {processError && (
          <div className="px-5 py-2.5 bg-red-950/80 border-b border-red-800 text-red-200 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{processError}</span>
          </div>
        )}

        {/* Body */}
        <div className="p-3 sm:p-5 space-y-4 min-h-0 flex-1 overflow-y-auto">
          {/* Target clip banner */}
          <div className="flex items-center justify-between px-3 py-1.5 rounded bg-zinc-900/80 border border-zinc-800 text-[11px] text-zinc-400">
            <span>
              Target: <strong className="text-zinc-200">{clip?.name || 'Selected Clip'}</strong>
            </span>
            <span className="mono-nums">Duration: {clip?.durationSeconds.toFixed(2)}s</span>
          </div>

          {/* 1. AMPLIFY MODAL */}
          {activeModal === 'amplify' && (
            <div className="space-y-3.5">
              <div className="flex justify-between text-zinc-300 font-medium">
                <span>Amplification Gain</span>
                <span className={`mono-nums font-bold ${gainDb > 0 ? 'text-cyan-400' : 'text-zinc-400'}`}>
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
                className="w-full h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer"
              />

              {/* Peak meters and clip warnings */}
              <div className="p-3 rounded bg-zinc-900 border border-zinc-800 space-y-2">
                <div className="flex justify-between text-[11px] text-zinc-400">
                  <span>Current Clip Peak:</span>
                  <span className="mono-nums text-zinc-200">{formatVolumeDb(currentPeak)}</span>
                </div>
                <div className="flex justify-between text-[11px] text-zinc-400">
                  <span>New Projected Peak:</span>
                  <span className={`mono-nums font-bold ${willClip ? 'text-red-400' : 'text-emerald-400'}`}>
                    {formatVolumeDb(amplifiedPeak)}
                  </span>
                </div>

                {willClip && (
                  <div className="flex items-center gap-2 pt-1 text-red-400 text-[11px]">
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
                  className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-300 transition-colors"
                >
                  Peak to -1 dBFS (Broadcast Safe)
                </button>
                <button
                  type="button"
                  onClick={() => setGainDb(0)}
                  className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-300 transition-colors"
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
                  className="rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-0"
                />
                <span className="text-zinc-300">
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
              <div className="flex justify-center">
                <canvas
                  ref={compCanvasRef}
                  width={340}
                  height={130}
                  className="rounded border border-zinc-800 shadow-inner bg-[#0b0b10]"
                />
              </div>

              <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3 text-[11px]">
                <div>
                  <div className="flex justify-between text-zinc-400 mb-0.5">
                    <span>Threshold</span>
                    <span className="mono-nums text-cyan-400 font-semibold">{compParams.thresholdDb} dB</span>
                  </div>
                  <input
                    type="range"
                    min="-40"
                    max="0"
                    step="1"
                    value={compParams.thresholdDb}
                    onChange={(e) => setCompParams({ ...compParams, thresholdDb: parseInt(e.target.value) })}
                    className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-zinc-400 mb-0.5">
                    <span>Ratio</span>
                    <span className="mono-nums text-cyan-400 font-semibold">{compParams.ratio}:1</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="20"
                    step="0.5"
                    value={compParams.ratio}
                    onChange={(e) => setCompParams({ ...compParams, ratio: parseFloat(e.target.value) })}
                    className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-zinc-400 mb-0.5">
                    <span>Attack</span>
                    <span className="mono-nums text-cyan-400 font-semibold">{compParams.attackMs} ms</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    step="1"
                    value={compParams.attackMs}
                    onChange={(e) => setCompParams({ ...compParams, attackMs: parseInt(e.target.value) })}
                    className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-zinc-400 mb-0.5">
                    <span>Release</span>
                    <span className="mono-nums text-cyan-400 font-semibold">{compParams.releaseMs} ms</span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="800"
                    step="10"
                    value={compParams.releaseMs}
                    onChange={(e) => setCompParams({ ...compParams, releaseMs: parseInt(e.target.value) })}
                    className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-zinc-400 mb-0.5">
                    <span>Knee</span>
                    <span className="mono-nums text-cyan-400 font-semibold">{compParams.kneeDb} dB</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    step="1"
                    value={compParams.kneeDb}
                    onChange={(e) => setCompParams({ ...compParams, kneeDb: parseInt(e.target.value) })}
                    className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-zinc-400 mb-0.5">
                    <span>Makeup Gain</span>
                    <span className="mono-nums text-cyan-400 font-semibold">+{compParams.makeupGainDb} dB</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="18"
                    step="0.5"
                    value={compParams.makeupGainDb}
                    onChange={(e) => setCompParams({ ...compParams, makeupGainDb: parseFloat(e.target.value) })}
                    className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer"
                  />
                </div>
              </div>

              <div className="text-[10px] text-zinc-500 font-mono pt-1">
                Render method: OfflineAudioContext &rarr; high-precision dynamic buffer replacement.
              </div>

              {/* Real-Time Preview Audition Bar */}
              {renderPreviewAuditionBar()}
            </div>
          )}

          {/* 3. SPEECH ENHANCEMENT & DENOISE MODAL */}
          {activeModal === 'denoise' && (
            <div className="space-y-3.5">
              <div className="p-2.5 rounded bg-cyan-950/40 border border-cyan-500/40 text-[11px] text-cyan-200 leading-relaxed">
                <div className="font-semibold text-cyan-100 flex items-center justify-between gap-1.5 mb-1">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                    High-Precision Speech Enhancement & Suppression
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-900/60 text-cyan-300 border border-cyan-700/50">
                    DSP Engine
                  </span>
                </div>
                <span>
                  High-precision dual-stage noise reduction: 24dB/oct Butterworth rumble filter + multi-band downward spectral gating with Hann-windowed smoothing to eliminate HVAC hum, mic hiss, and ambient noise without musical chirping or voice distortion.
                </span>
              </div>

              {/* Noise Profile Learning Section */}
              <div className="p-3 rounded bg-zinc-900/90 border border-zinc-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-zinc-200 font-medium text-[11px]">
                    <Activity className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Noise Profile Learning</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleLearnNoiseProfile}
                    disabled={isLearning}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-black font-bold text-[10px] transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLearning ? 'animate-spin' : ''}`} />
                    <span>{isLearning ? 'Analyzing...' : 'Learn Noise Profile'}</span>
                  </button>
                </div>

                {learnedProfile ? (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex justify-between text-[10px] text-zinc-400">
                      <span>Detected Room Tone / Ambient Floor:</span>
                      <span className="mono-nums text-emerald-400 font-bold font-mono">
                        {learnedProfile.learnedFloorDb} dBFS (Confidence {Math.round(learnedProfile.ambientConfidence * 100)}%)
                      </span>
                    </div>

                    {/* 8-band spectral curve bar visualizer */}
                    <div className="flex items-end gap-1 h-8 pt-1 px-2 bg-black/60 rounded border border-zinc-800">
                      {learnedProfile.noiseProfileCurve.map((val, idx) => {
                        const heightPct = Math.max(10, Math.min(100, ((val + 70) / 55) * 100));
                        return (
                          <div key={idx} className="flex-1 flex flex-col items-center h-full justify-end group">
                            <div
                              style={{ height: `${heightPct}%` }}
                              className="w-full bg-cyan-500/70 hover:bg-cyan-400 rounded-t-xs transition-all"
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-[9px] text-zinc-500 font-mono">
                      <span>80 Hz</span>
                      <span>400 Hz</span>
                      <span>1 kHz</span>
                      <span>2.5 kHz</span>
                      <span>8 kHz</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-[10px] text-zinc-400 italic">
                    Click &ldquo;Learn Noise Profile&rdquo; to analyze background silence and automatically tune threshold and reduction.
                  </div>
                )}
              </div>

              {/* Sliders */}
              <div className="space-y-3 pt-1">
                <div>
                  <div className="flex justify-between text-zinc-300 mb-1">
                    <span>High-Pass Rumble Cut (24dB/oct)</span>
                    <span className="mono-nums text-cyan-400 font-semibold">{denoiseParams.highPassFreq} Hz</span>
                  </div>
                  <input
                    type="range"
                    min="40"
                    max="160"
                    step="5"
                    value={denoiseParams.highPassFreq}
                    onChange={(e) => setDenoiseParams({ ...denoiseParams, highPassFreq: parseInt(e.target.value) })}
                    className="w-full h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer"
                  />
                  <div className="text-[10px] text-zinc-500 mt-0.5">Strips air conditioning rumble and mechanical mic vibrations</div>
                </div>

                <div>
                  <div className="flex justify-between text-zinc-300 mb-1">
                    <span>Noise Floor Threshold</span>
                    <span className="mono-nums text-cyan-400 font-semibold">{denoiseParams.noiseFloorThresholdDb} dB</span>
                  </div>
                  <input
                    type="range"
                    min="-60"
                    max="-15"
                    step="1"
                    value={denoiseParams.noiseFloorThresholdDb}
                    onChange={(e) => setDenoiseParams({ ...denoiseParams, noiseFloorThresholdDb: parseInt(e.target.value) })}
                    className="w-full h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer"
                  />
                  <div className="text-[10px] text-zinc-500 mt-0.5">Signals below this energy will be smoothly attenuated</div>
                </div>

                <div>
                  <div className="flex justify-between text-zinc-300 mb-1">
                    <span>Reduction Depth</span>
                    <span className="mono-nums text-cyan-400 font-semibold">-{denoiseParams.reductionDb} dB</span>
                  </div>
                  <input
                    type="range"
                    min="3"
                    max="30"
                    step="1"
                    value={denoiseParams.reductionDb}
                    onChange={(e) => setDenoiseParams({ ...denoiseParams, reductionDb: parseInt(e.target.value) })}
                    className="w-full h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer"
                  />
                  <div className="text-[10px] text-zinc-500 mt-0.5">Amount of background attenuation applied between words</div>
                </div>

                <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3 pt-1">
                  <div>
                    <div className="flex justify-between text-zinc-400 mb-0.5 text-[10px]">
                      <span>Attack Speed</span>
                      <span className="mono-nums text-cyan-400">{denoiseParams.attackMs ?? 8} ms</span>
                    </div>
                    <input
                      type="range"
                      min="2"
                      max="30"
                      step="1"
                      value={denoiseParams.attackMs ?? 8}
                      onChange={(e) => setDenoiseParams({ ...denoiseParams, attackMs: parseInt(e.target.value) })}
                      className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-zinc-400 mb-0.5 text-[10px]">
                      <span>Release Smoothing</span>
                      <span className="mono-nums text-cyan-400">{denoiseParams.releaseMs ?? 90} ms</span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="250"
                      step="5"
                      value={denoiseParams.releaseMs ?? 90}
                      onChange={(e) => setDenoiseParams({ ...denoiseParams, releaseMs: parseInt(e.target.value) })}
                      className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer"
                    />
                  </div>
                </div>
              </div>

              {/* Real-time Before / After Audio Preview Player */}
              {renderPreviewAuditionBar()}
            </div>
          )}

          {/* 4. CHANGE PITCH MODAL */}
          {activeModal === 'pitch' && (
            <div className="space-y-3.5">
              <div className="flex justify-between text-zinc-300 font-medium">
                <span>Pitch Shift</span>
                <span className={`mono-nums font-bold ${pitchSemitones > 0 ? 'text-cyan-400' : 'text-zinc-400'}`}>
                  {pitchSemitones > 0 ? `+${pitchSemitones}` : pitchSemitones} semitones
                </span>
              </div>
              <input
                type="range"
                min="-12"
                max="12"
                step="1"
                value={pitchSemitones}
                onChange={(e) => setPitchSemitones(parseInt(e.target.value))}
                className="w-full h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer"
              />

              <div className="flex flex-wrap gap-1.5 pt-1">
                {[-12, -7, -5, -2, 0, 2, 5, 7, 12].map((st) => (
                  <button
                    key={st}
                    onClick={() => setPitchSemitones(st)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                      pitchSemitones === st
                        ? 'bg-cyan-500 text-black font-bold'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                    }`}
                  >
                    {st > 0 ? `+${st}` : st}
                  </button>
                ))}
              </div>

              <div className="p-2.5 rounded bg-zinc-900/60 border border-zinc-800 text-[10px] text-zinc-400 leading-relaxed">
                <strong>Algorithm:</strong> WSOLA (Waveform Similarity Overlap-Add) combined with cubic Hermite resampling. Shifts pitch while preserving exact original duration and timing.
              </div>

              {/* Real-Time Preview Audition Bar */}
              {renderPreviewAuditionBar()}
            </div>
          )}

          {/* 5. CHANGE SPEED MODAL */}
          {activeModal === 'speed' && (
            <div className="space-y-3.5">
              <div className="flex justify-between text-zinc-300 font-medium">
                <span>Playback Speed</span>
                <span className="mono-nums text-cyan-400 font-bold text-sm">
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
                className="w-full h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer"
              />

              {/* Speed preset buttons */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[0.5, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 2.0].map((r) => (
                  <button
                    key={r}
                    onClick={() => setSpeedRatio(r)}
                    className={`px-2.5 py-1 rounded text-[10px] font-mono transition-colors ${
                      Math.abs(speedRatio - r) < 0.01
                        ? 'bg-cyan-500 text-black font-bold'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                    }`}
                  >
                    {r.toFixed(2)}x
                  </button>
                ))}
              </div>

              <div className="p-2.5 rounded bg-zinc-900/60 border border-zinc-800 text-[10px] text-zinc-400 leading-relaxed">
                <strong>Algorithm:</strong> WSOLA (Waveform Similarity Overlap-Add). Stretches or compresses timing while preserving exact pitch (no chipmunk effect).
              </div>

              {/* Real-Time Preview Audition Bar */}
              {renderPreviewAuditionBar()}
            </div>
          )}
        </div>

        {previewIsExcerpt && !progress && (
          <div className="px-5 py-2 border-t border-zinc-800 bg-[#12121a] text-[11px] text-zinc-400">
            Long clip: the preview plays a short excerpt. Apply processes the whole clip in blocks.
          </div>
        )}
        {isProcessing && progress && (
          <div className="px-5 py-3 border-t border-zinc-800 bg-[#12121a] space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-zinc-300">
              <span>Processing {progress.label}</span>
              <span className="font-mono">{Math.round(progress.fraction * 100)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full bg-cyan-400 transition-[width] duration-200" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
            </div>
            {onStopProcessing && (
              <button onClick={onStopProcessing} className="text-[11px] text-zinc-400 hover:text-red-300 cursor-pointer">
                Stop (nothing will be changed)
              </button>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-zinc-800 bg-[#161622] flex items-center justify-between">
          <button
            onClick={() => {
              stopPreview();
              onClose();
            }}
            disabled={isProcessing}
            className="px-3 py-1.5 rounded text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>

          <button
            disabled={isProcessing}
            onClick={() => {
              if (activeModal === 'amplify') {
                handleAction(() => onApplyAmplify({ gainDb }, bakeAmplify));
              } else if (activeModal === 'compress') {
                handleAction(() => onApplyCompressor(compParams));
              } else if (activeModal === 'denoise') {
                handleAction(() => onApplyDenoise(denoiseParams));
              } else if (activeModal === 'pitch') {
                handleAction(() => onApplyPitch({ semitones: pitchSemitones }));
              } else if (activeModal === 'speed') {
                handleAction(() => onApplySpeed({ speedRatio }));
              }
            }}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs shadow-[0_0_12px_rgba(0,240,255,0.3)] transition-all disabled:opacity-50 cursor-pointer"
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
