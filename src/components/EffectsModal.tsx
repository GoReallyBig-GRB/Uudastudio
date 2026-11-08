/**
 * X-PRO AUDIO - Professional Audio Effects Suite Rack
 * Implements real-time Web Audio / AudioWorklet DSP & OfflineAudioContext Rendering for:
 * Stereo Delay, 4-Band Parametric EQ, Multi-Voice Chorus, Jet Flanger, Sweeping Phaser, and Algorithmic Reverb.
 */

import { chainsOnTrack } from './spliceChains';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { PresetBar } from './PresetBar';
import { loadCustomPresets, removeCustomPreset, saveCustomPreset } from './customPresets';
import {
  Sparkles,
  Play,
  Square,
  Repeat,
  Check,
  X,
  Sliders,
  Radio,
  Activity,
  Headphones,
} from 'lucide-react';
import {
  Project,
  Clip,
  Asset,
  EffectType,
  TrackEffect,
  DelayParams,
  EqualizerParams,
  ChorusParams,
  FlangerParams,
  PhaserParams,
  ReverbParams,
} from '../types';
import { ProgressIndicator } from './ui';
import { EFFECT_PRESETS } from './effectPresets';
import {
  buildDelayNode,
  buildEqualizerNode,
  buildChorusNode,
  buildFlangerNode,
  buildPhaserNode,
  buildReverbNode,
  renderBufferWithEffect,
} from '../audio/effects/dspChain';
import { audioEngine } from '../audio/engine';
import { pieceFromClip } from '../audio/chunkedJob';
import { formatTimecode } from '../utils/formatters';
import { getTrackLabel } from '../utils/tracks';

interface EffectsModalProps {
  isOpen: boolean;
  initialEffectType?: EffectType;
  project: Project;
  selectedClipId: string | null;
  onSelectClip?: (clipId: string) => void;
  onClose: () => void;
  onApplyEffect: (
    targetClipId: string,
    effect: TrackEffect,
    renderedBuffer: AudioBuffer,
    newDuration: number
  ) => Promise<void>;
  /** Long audio kept on disk, or an edited clip: rendered block by block into one clip */
  onApplyEffectChunked?: (targetClipId: string, effect: TrackEffect, onProgress?: (fraction: number) => void) => Promise<void>;
  /** Set when the rack was opened on a highlighted range: only these pieces are listed and each is processed on its own */
  restrictClipIds?: string[] | null;
  /** Stops a render in progress; nothing is changed */
  onStopProcessing?: () => void;
}


/**
 * Creates a clean 4-second Studio Reference Audio Buffer (48kHz stereo chords + harmonics)
 * for instant live auditioning even when the user hasn't recorded/imported a clip yet.
 */
function createStudioReferenceBuffer(ctx: BaseAudioContext): AudioBuffer {
  const sampleRate = ctx.sampleRate || 48000;
  const duration = 4.0;
  const frames = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(2, frames, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  // Musical chord notes: C3 (130.81Hz), G3 (196Hz), C4 (261.63Hz), E4 (329.63Hz)
  const freqs = [130.81, 196.0, 261.63, 329.63, 392.0];
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    // Envelope: quick attack, sustained body, gentle release
    let env = 1.0;
    if (t < 0.05) env = t / 0.05;
    else if (t > 3.0) env = Math.max(0, (duration - t) / 1.0);

    let sampleL = 0;
    let sampleR = 0;
    for (let f = 0; f < freqs.length; f++) {
      const freq = freqs[f];
      const pan = (f / (freqs.length - 1)) * 0.4 - 0.2; // subtle stereo spread
      const osc = Math.sin(2 * Math.PI * freq * t) * 0.15;
      const harmonic = Math.sin(4 * Math.PI * freq * t) * 0.05;
      sampleL += (osc + harmonic) * (0.5 - pan);
      sampleR += (osc + harmonic) * (0.5 + pan);
    }
    left[i] = sampleL * env;
    right[i] = sampleR * env;
  }
  return buffer;
}

export const EffectsModal: React.FC<EffectsModalProps> = ({
  isOpen,
  initialEffectType = 'reverb',
  project,
  selectedClipId,
  onSelectClip,
  onClose,
  onApplyEffect,
  onApplyEffectChunked,
  restrictClipIds,
  onStopProcessing,
}) => {
  const [activeType, setActiveType] = useState<EffectType>(initialEffectType);
  const [isBypassed, setIsBypassed] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progress, setProgress] = useState<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // List all available clips in project
  const allClips = useMemo(() => {
    const list: { trackId: string; trackName: string; clip: Clip; asset: Asset | null; pieces: number }[] = [];
    for (const [trackIndex, track] of project.tracks.entries()) {
      if (restrictClipIds) {
        // A range: just the piece(s) that were split out, each on its own
        for (const c of track.clips) {
          if (restrictClipIds.includes(c.id)) list.push({ trackId: track.id, trackName: getTrackLabel(track, trackIndex), clip: c, asset: audioEngine.getAsset(c.assetId) || null, pieces: 1 });
        }
        continue;
      }
      // An edited track (spliced pieces) is listed once, as one clip of its full length
      const chainOf = new Map<string, Clip[]>();
      for (const chain of chainsOnTrack(track.clips)) for (const c of chain) chainOf.set(c.id, chain);
      for (const c of track.clips) {
        const chain = chainOf.get(c.id);
        let whole = c;
        let pieces = 1;
        if (chain) {
          pieces = chain.length;
          const sorted = [...chain].sort((x, y) => x.startSeconds - y.startSeconds);
          if (sorted[0].id !== c.id) continue;
          const tail = sorted[sorted.length - 1];
          whole = { ...c, durationSeconds: tail.startSeconds + tail.durationSeconds - c.startSeconds };
        }
        const ast = audioEngine.getAsset(c.assetId) || null;
        list.push({ trackId: track.id, trackName: getTrackLabel(track, trackIndex), clip: whole, asset: ast, pieces });
      }
    }
    return list;
  }, [project.tracks, restrictClipIds]);

  // Target clip selection state
  const [targetClipId, setTargetClipId] = useState<string | null>(selectedClipId || (allClips[0]?.clip.id ?? null));

  // Sync when initialEffectType or isOpen or selectedClipId changes
  useEffect(() => {
    if (isOpen) {
      setActiveType(initialEffectType);
      if (selectedClipId && allClips.some((item) => item.clip.id === selectedClipId)) {
        setTargetClipId(selectedClipId);
      } else if (!targetClipId && allClips.length > 0) {
        setTargetClipId(allClips[0].clip.id);
      }
    }
  }, [isOpen, initialEffectType, selectedClipId, allClips]);

  // Resolve current target item
  const currentItem = allClips.find((item) => item.clip.id === targetClipId) || allClips[0] || null;
  const currentClip = currentItem?.clip || null;
  const currentAsset = currentItem?.asset || null;

  // Parameter states per effect
  const [customEffects, setCustomEffects] = useState<Record<string, { name: string; value: any }[]>>(() =>
    Object.fromEntries((Object.keys(EFFECT_PRESETS) as EffectType[]).map((t) => [t, loadCustomPresets<any>(`effect.${t}`)])),
  );
  const [delayParams, setDelayParams] = useState<DelayParams>(EFFECT_PRESETS.delay[0].params);
  const [eqParams, setEqParams] = useState<EqualizerParams>(EFFECT_PRESETS.equalizer[0].params);
  const [chorusParams, setChorusParams] = useState<ChorusParams>(EFFECT_PRESETS.chorus[0].params);
  const [flangerParams, setFlangerParams] = useState<FlangerParams>(EFFECT_PRESETS.flanger[0].params);
  const [phaserParams, setPhaserParams] = useState<PhaserParams>(EFFECT_PRESETS.phaser[0].params);
  const [reverbParams, setReverbParams] = useState<ReverbParams>(EFFECT_PRESETS.reverb[0].params);

  // Every opening starts from each effect's first preset, so the last job's settings never carry over to a new track
  useEffect(() => {
    if (!isOpen) return;
    setDelayParams(EFFECT_PRESETS.delay[0].params);
    setEqParams(EFFECT_PRESETS.equalizer[0].params);
    setChorusParams(EFFECT_PRESETS.chorus[0].params);
    setFlangerParams(EFFECT_PRESETS.flanger[0].params);
    setPhaserParams(EFFECT_PRESETS.phaser[0].params);
    setReverbParams(EFFECT_PRESETS.reverb[0].params);
    setIsBypassed(false);
  }, [isOpen]);

  // Live Audition State
  const [previewState, setPreviewState] = useState<'none' | 'original' | 'processed'>('none');
  const [isLooping, setIsLooping] = useState<boolean>(true);
  const previewCtxRef = useRef<AudioContext | null>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const referenceBufferRef = useRef<AudioBuffer | null>(null);
  const debounceRestartRef = useRef<any>(null);

  /** Numbers each preview request so a slow one that finishes after Stop or a newer request is dropped */
  const previewRequestRef = useRef(0);
  const stopPreview = () => {
    previewRequestRef.current += 1;
    if (previewSourceRef.current) {
      try {
        previewSourceRef.current.stop();
        previewSourceRef.current.disconnect();
      } catch {}
      previewSourceRef.current = null;
    }
    setPreviewState('none');
  };

  useEffect(() => {
    return () => {
      stopPreview();
      if (previewCtxRef.current && previewCtxRef.current.state !== 'closed') {
        previewCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  const getCurrentEffect = (): TrackEffect => {
    let params: any = reverbParams;
    let name = 'Reverb';
    if (activeType === 'delay') {
      params = delayParams;
      name = 'Stereo Delay';
    } else if (activeType === 'equalizer') {
      params = eqParams;
      name = 'Parametric EQ';
    } else if (activeType === 'chorus') {
      params = chorusParams;
      name = 'Chorus';
    } else if (activeType === 'flanger') {
      params = flangerParams;
      name = 'Flanger';
    } else if (activeType === 'phaser') {
      params = phaserParams;
      name = 'Phaser';
    }
    return {
      id: `eff-${activeType}-${Date.now()}`,
      type: activeType,
      name,
      enabled: !isBypassed,
      params,
    };
  };

  // Live real-time preview player
  const startPreview = async (mode: 'original' | 'processed') => {
    stopPreview();
    const requestId = ++previewRequestRef.current;

    try {
      if (!previewCtxRef.current || previewCtxRef.current.state === 'closed') {
        previewCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (previewCtxRef.current.state === 'suspended') {
        await previewCtxRef.current.resume();
      }

      const ctx = previewCtxRef.current;
      // The clip's own audio (from memory or from disk). The studio chord is only for when there is no clip at all.
      let sliceBuf: AudioBuffer;
      if (currentAsset && currentClip && (currentAsset.buffer || currentAsset.source)) {
        const sr = currentAsset.sampleRate || 48000;
        const offset = Math.max(0, currentClip.offsetSeconds || 0);
        const available = Math.max(0, (currentAsset.durationSeconds || 0) - offset);
        const previewSec = Math.min(8, currentClip.durationSeconds, available);
        const frames = Math.max(1, Math.floor(previewSec * sr));
        const piece = pieceFromClip(currentAsset, { ...currentClip, durationSeconds: Math.min(currentClip.durationSeconds, available) }, false);
        const data = await piece.read(0, frames);
        const n = Math.max(1, data[0]?.length ?? 0);
        sliceBuf = ctx.createBuffer(Math.max(1, data.length), n, sr);
        data.forEach((chData, ch) => sliceBuf.copyToChannel(chData as Float32Array<ArrayBuffer>, ch));
      } else if (allClips.length === 0) {
        if (!referenceBufferRef.current) referenceBufferRef.current = createStudioReferenceBuffer(ctx);
        const ref = referenceBufferRef.current;
        sliceBuf = ref;
      } else {
        setErrorMessage('The audio for this clip is not loaded yet, so it cannot be auditioned.');
        setPreviewState('none');
        return;
      }

      // A newer request started while this one was reading the clip (sliders or presets moved): do not play two copies
      if (requestId !== previewRequestRef.current) return;
      const source = ctx.createBufferSource();
      source.buffer = sliceBuf;
      source.loop = isLooping;

      if (mode === 'original' || isBypassed) {
        source.connect(ctx.destination);
      } else {
        const eff = getCurrentEffect();
        let nodes: { input: AudioNode; output: AudioNode };

        switch (eff.type) {
          case 'delay':
            nodes = buildDelayNode(ctx, eff.params as DelayParams);
            break;
          case 'equalizer':
            nodes = buildEqualizerNode(ctx, eff.params as EqualizerParams);
            break;
          case 'chorus':
            nodes = buildChorusNode(ctx, eff.params as ChorusParams);
            break;
          case 'flanger':
            nodes = buildFlangerNode(ctx, eff.params as FlangerParams);
            break;
          case 'phaser':
            nodes = buildPhaserNode(ctx, eff.params as PhaserParams);
            break;
          case 'reverb':
          default:
            nodes = buildReverbNode(ctx, eff.params as ReverbParams);
            break;
        }

        source.connect(nodes.input);
        nodes.output.connect(ctx.destination);
      }

      source.onended = () => {
        // A replaced source ends on its own later; it must not reset the state of the one that replaced it
        if (!isLooping && previewSourceRef.current === source) {
          previewSourceRef.current = null;
          setPreviewState('none');
        }
      };

      source.start(0);
      previewSourceRef.current = source;
      setPreviewState(mode);
    } catch (err: any) {
      setErrorMessage(`Preview error: ${err?.message || err}`);
      setPreviewState('none');
    }
  };

  // Trigger debounced preview restart when parameters change during live preview
  const handleParamChange = () => {
    if (previewState === 'processed') {
      if (debounceRestartRef.current) clearTimeout(debounceRestartRef.current);
      debounceRestartRef.current = setTimeout(() => {
        startPreview('processed');
      }, 120);
    }
  };

  const handleApply = async () => {
    if (!currentClip || !currentAsset || (!currentAsset.buffer && !currentAsset.source)) {
      setErrorMessage('Please add or record an audio clip to the timeline before applying this effect.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    stopPreview();

    try {
      const eff = getCurrentEffect();
      const edited = (currentItem?.pieces ?? 1) > 1 || !!restrictClipIds;
      if (!currentAsset.buffer || edited) {
        if (!onApplyEffectChunked) throw new Error('This audio is too long to render whole.');
        setProgress(0);
        startedAtRef.current = Date.now();
        await onApplyEffectChunked(currentClip.id, eff, setProgress);
        onClose();
        return;
      }
      const rendered = await renderBufferWithEffect(currentAsset.buffer, eff);
      const newDuration = rendered.duration;

      await onApplyEffect(currentClip.id, eff, rendered, newDuration);
      onClose();
    } catch (err: any) {
      setErrorMessage(`Failed to apply effect: ${err?.message || err}`);
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-2 sm:p-4 select-none animate-in fade-in duration-100">
      <div className="w-full max-w-xl max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] bg-[#101016] border border-accent/50 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.85)] overflow-hidden flex flex-col text-xs text-ink">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line bg-surface-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent" />
            <h2 className="font-extrabold text-sm uppercase tracking-wider text-ink">
              Audio Effects Suite Rack
            </h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-soft text-accent font-mono font-bold">
              Real DSP
            </span>
          </div>

          <button
            onClick={() => {
              stopPreview();
              onClose();
            }}
            className="p-1 rounded-md text-ink-dim hover:text-white hover:bg-surface-2 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error notification */}
        {errorMessage && (
          <div className="px-5 py-2 bg-danger/10 border-b border-danger text-danger text-[11px] flex items-center justify-between">
            <span>{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="text-danger hover:text-white cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Target Audio Strip */}
        <div className="px-4 py-2.5 bg-[#0b0b10] border-b border-line flex items-center justify-between gap-3">
          {allClips.length > 0 ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-ink-dim font-medium text-[11px] shrink-0">Target Clip:</span>
              <select
                value={currentClip?.id || ''}
                onChange={(e) => {
                  stopPreview();
                  setTargetClipId(e.target.value);
                  onSelectClip?.(e.target.value);
                }}
                className="bg-[#14141d] border border-line-strong/80 rounded-md px-2.5 py-1 text-xs text-accent font-medium truncate flex-1 cursor-pointer focus:border-accent"
              >
                {allClips.map(({ trackName, clip: c }) => (
                  <option key={c.id} value={c.id}>
                    {trackName} — {c.name || 'Audio Clip'} ({formatTimecode(c.durationSeconds)})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-accent text-[11px]">
              <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
              <span>Auditioning on <strong>Studio Reference Audio</strong>. Record or import audio to apply directly to timeline clips.</span>
            </div>
          )}
        </div>

        {/* Effect Selector Tabs */}
        <div className="flex items-center px-4 border-b border-line bg-[#0d0d12] gap-1 overflow-x-auto scrollbar-none">
          {([
            { id: 'delay', label: 'Stereo Delay' },
            { id: 'equalizer', label: 'Parametric EQ' },
            { id: 'chorus', label: 'Chorus' },
            { id: 'flanger', label: 'Flanger' },
            { id: 'phaser', label: 'Phaser' },
            { id: 'reverb', label: 'Reverb' },
          ] as const).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => {
                stopPreview();
                setActiveType(id);
              }}
              className={`py-2 px-3.5 border-b-2 font-semibold text-xs transition-all cursor-pointer shrink-0 ${
                activeType === id
                  ? 'border-accent text-accent bg-accent-soft'
                  : 'border-transparent text-ink-dim hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Effect Parameters Body */}
        <div className="p-3 sm:p-5 space-y-4 min-h-0 flex-1 overflow-y-auto">
          {/* Presets as pills (the one matching the current settings is lit, "Custom" otherwise) and the bypass switch */}
          <div className="flex items-start justify-between gap-3 rounded-card border border-line bg-surface-1 p-3">
            <div className="min-w-0 flex-1">
              <span className="mb-1.5 block text-[11px] font-semibold text-ink-dim">Presets</span>
              {(() => {
                const currentParams = activeType === 'delay' ? delayParams : activeType === 'equalizer' ? eqParams : activeType === 'chorus' ? chorusParams : activeType === 'flanger' ? flangerParams : activeType === 'phaser' ? phaserParams : reverbParams;
                const current = JSON.stringify(currentParams);
                const list = EFFECT_PRESETS[activeType] ?? [];
                const customList = customEffects[activeType] ?? [];
                const setParams = (p: any) => {
                  if (activeType === 'delay') setDelayParams({ ...p });
                  else if (activeType === 'equalizer') setEqParams({ ...p });
                  else if (activeType === 'chorus') setChorusParams({ ...p });
                  else if (activeType === 'flanger') setFlangerParams({ ...p });
                  else if (activeType === 'phaser') setPhaserParams({ ...p });
                  else if (activeType === 'reverb') setReverbParams({ ...p });
                  handleParamChange();
                };
                return (
                  <PresetBar
                    presets={list}
                    activeIndex={list.findIndex((pr) => JSON.stringify(pr.params) === current)}
                    onPick={(i) => setParams(list[i].params)}
                    custom={customList}
                    activeCustomIndex={customList.findIndex((pr) => JSON.stringify(pr.value) === current)}
                    onPickCustom={(i) => setParams(customList[i].value)}
                    onRemoveCustom={(n) => setCustomEffects({ ...customEffects, [activeType]: removeCustomPreset<any>(`effect.${activeType}`, n) })}
                    onSave={(n) => setCustomEffects({ ...customEffects, [activeType]: saveCustomPreset(`effect.${activeType}`, n, currentParams) })}
                  />
                );
              })()}
            </div>

            <button
              type="button"
              onClick={() => {
                setIsBypassed(!isBypassed);
                handleParamChange();
              }}
              aria-pressed={isBypassed}
              className={`h-7 shrink-0 cursor-pointer rounded-full border px-3 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
                isBypassed ? 'border-warn/50 bg-warn/15 text-warn' : 'border-line text-ink-dim hover:border-line-strong hover:text-ink'
              }`}
            >
              {isBypassed ? 'Bypassed' : 'Bypass'}
            </button>
          </div>

          {/* DELAY CONTROLS */}
          {activeType === 'delay' && (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-ink-dim mb-1">
                  <span>Delay Time</span>
                  <span className="font-mono text-accent font-bold">{delayParams.timeMs} ms</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="1500"
                  step="10"
                  value={delayParams.timeMs}
                  onChange={(e) => {
                    setDelayParams({ ...delayParams, timeMs: parseInt(e.target.value, 10) });
                    handleParamChange();
                  }}
                  className="w-full h-1.5 bg-surface-2 rounded-xs accent-accent cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-ink-dim mb-1">
                  <span>Feedback (Decay Repetitions)</span>
                  <span className="font-mono text-accent font-bold">{Math.round(delayParams.feedback * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.9"
                  step="0.05"
                  value={delayParams.feedback}
                  onChange={(e) => {
                    setDelayParams({ ...delayParams, feedback: parseFloat(e.target.value) });
                    handleParamChange();
                  }}
                  className="w-full h-1.5 bg-surface-2 rounded-xs accent-accent cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
                <div>
                  <div className="flex justify-between text-ink-dim mb-1 text-[10px]">
                    <span>High-Pass Filter</span>
                    <span className="font-mono text-accent">{delayParams.lowCutHz} Hz</span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="600"
                    step="10"
                    value={delayParams.lowCutHz}
                    onChange={(e) => {
                      setDelayParams({ ...delayParams, lowCutHz: parseInt(e.target.value, 10) });
                      handleParamChange();
                    }}
                    className="w-full h-1 bg-surface-2 rounded-xs accent-accent cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-ink-dim mb-1 text-[10px]">
                    <span>Low-Pass Filter</span>
                    <span className="font-mono text-accent">{delayParams.highCutHz} Hz</span>
                  </div>
                  <input
                    type="range"
                    min="1500"
                    max="18000"
                    step="500"
                    value={delayParams.highCutHz}
                    onChange={(e) => {
                      setDelayParams({ ...delayParams, highCutHz: parseInt(e.target.value, 10) });
                      handleParamChange();
                    }}
                    className="w-full h-1 bg-surface-2 rounded-xs accent-accent cursor-pointer"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={delayParams.pingPong}
                    onChange={(e) => {
                      setDelayParams({ ...delayParams, pingPong: e.target.checked });
                      handleParamChange();
                    }}
                    className="accent-accent"
                  />
                  <span>Ping-Pong Stereo Bouncing</span>
                </label>

                <div className="flex items-center gap-2">
                  <span className="text-ink-dim">Dry/Wet:</span>
                  <span className="text-accent font-bold font-mono">{Math.round(delayParams.dryWet * 100)}%</span>
                </div>
              </div>
            </div>
          )}

          {/* PARAMETRIC EQUALIZER CONTROLS */}
          {activeType === 'equalizer' && (
            <div className="space-y-3">
              {eqParams.bands.map((band, idx) => (
                <div key={band.id} className="p-2 rounded-lg bg-surface-1/60 border border-line flex items-center gap-3">
                  <span className="w-14 text-[10px] font-bold text-accent font-mono">
                    {band.type.toUpperCase().replace('ING', '')}
                  </span>

                  <div className="flex-1">
                    <div className="flex justify-between text-[10px] text-ink-dim mb-0.5">
                      <span>{band.frequency} Hz</span>
                      <span className="font-mono text-accent font-bold">
                        {band.gainDb > 0 ? `+${band.gainDb}` : band.gainDb} dB
                      </span>
                    </div>
                    <input
                      type="range"
                      min="-18"
                      max="18"
                      step="0.5"
                      value={band.gainDb}
                      onChange={(e) => {
                        const newBands = [...eqParams.bands];
                        newBands[idx] = { ...band, gainDb: parseFloat(e.target.value) };
                        setEqParams({ ...eqParams, bands: newBands });
                        handleParamChange();
                      }}
                      className="w-full h-1 bg-surface-2 rounded-xs accent-accent cursor-pointer"
                    />
                  </div>
                </div>
              ))}

              <div className="flex justify-between items-center pt-1 text-ink-dim">
                <span>Master EQ Dry/Wet:</span>
                <span className="text-accent font-bold font-mono">{Math.round(eqParams.dryWet * 100)}%</span>
              </div>
            </div>
          )}

          {/* CHORUS CONTROLS */}
          {activeType === 'chorus' && (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-ink-dim mb-1">
                  <span>Modulation Rate</span>
                  <span className="font-mono text-accent font-bold">{chorusParams.rateHz} Hz</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="5.0"
                  step="0.1"
                  value={chorusParams.rateHz}
                  onChange={(e) => {
                    setChorusParams({ ...chorusParams, rateHz: parseFloat(e.target.value) });
                    handleParamChange();
                  }}
                  className="w-full h-1.5 bg-surface-2 rounded-xs accent-accent cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-ink-dim mb-1">
                  <span>Modulation Depth</span>
                  <span className="font-mono text-accent font-bold">{chorusParams.depthMs} ms</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="0.5"
                  value={chorusParams.depthMs}
                  onChange={(e) => {
                    setChorusParams({ ...chorusParams, depthMs: parseFloat(e.target.value) });
                    handleParamChange();
                  }}
                  className="w-full h-1.5 bg-surface-2 rounded-xs accent-accent cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
                <div>
                  <div className="flex justify-between text-ink-dim mb-1 text-[10px]">
                    <span>Stereo Spread</span>
                    <span className="font-mono text-accent">{Math.round(chorusParams.stereoSpread * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={chorusParams.stereoSpread}
                    onChange={(e) => {
                      setChorusParams({ ...chorusParams, stereoSpread: parseFloat(e.target.value) });
                      handleParamChange();
                    }}
                    className="w-full h-1 bg-surface-2 rounded-xs accent-accent cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-ink-dim mb-1 text-[10px]">
                    <span>Dry/Wet Mix</span>
                    <span className="font-mono text-accent">{Math.round(chorusParams.dryWet * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={chorusParams.dryWet}
                    onChange={(e) => {
                      setChorusParams({ ...chorusParams, dryWet: parseFloat(e.target.value) });
                      handleParamChange();
                    }}
                    className="w-full h-1 bg-surface-2 rounded-xs accent-accent cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {/* FLANGER CONTROLS */}
          {activeType === 'flanger' && (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-ink-dim mb-1">
                  <span>LFO Rate (Sweep Speed)</span>
                  <span className="font-mono text-accent font-bold">{flangerParams.rateHz} Hz</span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="3.0"
                  step="0.05"
                  value={flangerParams.rateHz}
                  onChange={(e) => {
                    setFlangerParams({ ...flangerParams, rateHz: parseFloat(e.target.value) });
                    handleParamChange();
                  }}
                  className="w-full h-1.5 bg-surface-2 rounded-xs accent-accent cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-ink-dim mb-1">
                  <span>Resonance Feedback</span>
                  <span className="font-mono text-accent font-bold">{Math.round(flangerParams.feedback * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="-0.95"
                  max="0.95"
                  step="0.05"
                  value={flangerParams.feedback}
                  onChange={(e) => {
                    setFlangerParams({ ...flangerParams, feedback: parseFloat(e.target.value) });
                    handleParamChange();
                  }}
                  className="w-full h-1.5 bg-surface-2 rounded-xs accent-accent cursor-pointer"
                />
              </div>

              <div className="flex justify-between items-center pt-1 text-ink-dim">
                <span>Flanger Dry/Wet:</span>
                <span className="text-accent font-bold font-mono">{Math.round(flangerParams.dryWet * 100)}%</span>
              </div>
            </div>
          )}

          {/* PHASER CONTROLS */}
          {activeType === 'phaser' && (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-ink-dim mb-1">
                  <span>Sweep Rate</span>
                  <span className="font-mono text-accent font-bold">{phaserParams.rateHz} Hz</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="4.0"
                  step="0.1"
                  value={phaserParams.rateHz}
                  onChange={(e) => {
                    setPhaserParams({ ...phaserParams, rateHz: parseFloat(e.target.value) });
                    handleParamChange();
                  }}
                  className="w-full h-1.5 bg-surface-2 rounded-xs accent-accent cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-ink-dim mb-1">
                  <span>Poles / Stages</span>
                  <span className="font-mono text-accent font-bold">{phaserParams.stages} Stages</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="12"
                  step="2"
                  value={phaserParams.stages}
                  onChange={(e) => {
                    setPhaserParams({ ...phaserParams, stages: parseInt(e.target.value, 10) });
                    handleParamChange();
                  }}
                  className="w-full h-1.5 bg-surface-2 rounded-xs accent-accent cursor-pointer"
                />
              </div>

              <div className="flex justify-between items-center pt-1 text-ink-dim">
                <span>Phaser Dry/Wet:</span>
                <span className="text-accent font-bold font-mono">{Math.round(phaserParams.dryWet * 100)}%</span>
              </div>
            </div>
          )}

          {/* REVERB CONTROLS */}
          {activeType === 'reverb' && (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-ink-dim mb-1">
                  <span>Decay Time</span>
                  <span className="font-mono text-accent font-bold">{reverbParams.decayTimeSec} s</span>
                </div>
                <input
                  type="range"
                  min="0.3"
                  max="8.0"
                  step="0.1"
                  value={reverbParams.decayTimeSec}
                  onChange={(e) => {
                    setReverbParams({ ...reverbParams, decayTimeSec: parseFloat(e.target.value) });
                    handleParamChange();
                  }}
                  className="w-full h-1.5 bg-surface-2 rounded-xs accent-accent cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
                <div>
                  <div className="flex justify-between text-ink-dim mb-1 text-[10px]">
                    <span>Pre-Delay</span>
                    <span className="font-mono text-accent">{reverbParams.preDelayMs} ms</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={reverbParams.preDelayMs}
                    onChange={(e) => {
                      setReverbParams({ ...reverbParams, preDelayMs: parseInt(e.target.value, 10) });
                      handleParamChange();
                    }}
                    className="w-full h-1 bg-surface-2 rounded-xs accent-accent cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-ink-dim mb-1 text-[10px]">
                    <span>Dry/Wet</span>
                    <span className="font-mono text-accent">{Math.round(reverbParams.dryWet * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={reverbParams.dryWet}
                    onChange={(e) => {
                      setReverbParams({ ...reverbParams, dryWet: parseFloat(e.target.value) });
                      handleParamChange();
                    }}
                    className="w-full h-1 bg-surface-2 rounded-xs accent-accent cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Real-time Before/After Audition Deck */}
          <div className="p-3 rounded-xl bg-surface-1 border border-line space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1.5 font-bold text-ink">
                <Headphones className="w-3.5 h-3.5 text-accent" />
                <span>Real-Time Audition (A/B)</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsLooping(!isLooping)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                    isLooping ? 'bg-accent-soft text-accent' : 'text-ink-faint hover:text-ink-dim'
                  }`}
                >
                  <Repeat className="w-3 h-3" />
                  <span>Loop</span>
                </button>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => (previewState === 'original' ? stopPreview() : startPreview('original'))}
                className={`flex-1 py-1.5 rounded-lg font-semibold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  previewState === 'original'
                    ? 'bg-warn text-black font-bold'
                    : 'bg-surface-2 text-ink-dim hover:bg-surface-3'
                }`}
              >
                {previewState === 'original' ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5" />}
                <span>Original (Dry)</span>
              </button>

              <button
                type="button"
                onClick={() => (previewState === 'processed' ? stopPreview() : startPreview('processed'))}
                className={`flex-1 py-1.5 rounded-lg font-semibold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  previewState === 'processed'
                    ? 'bg-accent text-black font-bold'
                    : 'bg-accent/10 hover:bg-accent/20 text-accent border border-accent/60'
                }`}
              >
                {previewState === 'processed' ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                <span>Processed (Wet)</span>
              </button>
            </div>
          </div>
        </div>

        {isProcessing && progress !== null && (
          <div className="border-t border-line bg-surface-1 px-5 py-3">
            <ProgressIndicator
              fraction={progress}
              label={`Rendering${restrictClipIds ? ' the selected range' : ''}`}
              onCancel={onStopProcessing}
              cancelLabel="Stop"
            />
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-line bg-surface-2 flex items-center justify-between">
          <button
            onClick={() => {
              stopPreview();
              onClose();
            }}
            disabled={isProcessing}
            className="px-3 py-1.5 rounded text-xs text-ink-dim hover:text-ink transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            onClick={handleApply}
            disabled={isProcessing || !currentClip}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent hover:bg-accent text-black font-bold text-xs transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isProcessing ? (
              <span>{progress !== null ? `Rendering ${Math.round(progress * 100)}%` : 'Rendering effect tail...'}</span>
            ) : (
              <>
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Apply {activeType.toUpperCase()} (Non-Destructive)</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
