/**
 * Uuda Studio - Voiceover Studio Panel
 * Professional voice synthesis powered by Gemini TTS.
 * Minimalist studio UI featuring custom instruction precepts, instant talent audition,
 * delivery directives, and direct timeline placement.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  Play,
  Pause,
  Volume2,
  FileText,
  Sparkles,
  Bookmark,
  Trash2,
  Plus,
  Loader2,
  Check,
  X,
  Sliders,
} from 'lucide-react';
import { Asset, VoiceMetadata } from '../types';
import { audioEngine } from '../audio/engine';
import { saveAssetToDB } from '../storage/db';
import { authService } from '../services/authService';
import { useVoiceSession, CustomPrecept } from '../voice/voiceSession';

export type { CustomPrecept };

interface VoiceOption {
  name: string;
  gender: string;
  descriptor: string;
}

interface VoiceModelOption {
  id: string;
  name: string;
  tier: string;
}

interface VoicePanelProps {
  onAddVoiceTrack: (asset: Asset, metadata: VoiceMetadata) => void;
  onClose?: () => void;
  existingMetadata?: VoiceMetadata | null;
}

export const VoicePanel: React.FC<VoicePanelProps> = ({
  onAddVoiceTrack,
  onClose,
  existingMetadata,
}) => {
  const {
    script,
    setScript,
    deliveryInstruction,
    setDeliveryInstruction,
    selectedVoice,
    setSelectedVoice,
    selectedModel,
    setSelectedModel,
    customPrecepts,
    savePrecept,
    clearPrecept,
  } = useVoiceSession();

  // Initialize from existingMetadata if provided (e.g. re-editing a track)
  useEffect(() => {
    if (existingMetadata) {
      if (existingMetadata.script) setScript(existingMetadata.script);
      if (existingMetadata.voiceName) setSelectedVoice(existingMetadata.voiceName);
      if (existingMetadata.model) setSelectedModel(existingMetadata.model);
      if (existingMetadata.deliveryInstruction) setDeliveryInstruction(existingMetadata.deliveryInstruction);
    }
  }, [existingMetadata]);

  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [models, setModels] = useState<VoiceModelOption[]>([
    { id: 'gemini-3.8-flash-tts', name: 'Quality (gemini-3.8-flash-tts)', tier: 'Flagship' },
    { id: 'gemini-3.8-flash-lite-tts', name: 'Fast (gemini-3.8-flash-lite-tts)', tier: 'Fast' },
  ]);

  // State for saving a new precept into a slot
  const [savingSlotIndex, setSavingSlotIndex] = useState<number | null>(null);
  const [newPreceptTitle, setNewPreceptTitle] = useState<string>('');
  const [slotNotice, setSlotNotice] = useState<string | null>(null);

  // Audition audio player state
  const [auditioningVoice, setAuditioningVoice] = useState<string | null>(null);
  const [isAuditionLoading, setIsAuditionLoading] = useState<boolean>(false);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Generation status
  const [status, setStatus] = useState<'idle' | 'sending' | 'synthesizing' | 'decoding'>('idle');
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch voice list on mount
  useEffect(() => {
    let isMounted = true;
    const fetchVoices = async () => {
      try {
        const res = await fetch('/api/voice/voices');
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            if (data.voices && Array.isArray(data.voices)) {
              setVoices(data.voices);
            }
            if (data.models && Array.isArray(data.models)) {
              setModels(data.models);
            }
          }
        }
      } catch (err) {
        console.warn('Could not load dynamic voices list:', err);
      }
    };
    fetchVoices();
    return () => {
      isMounted = false;
    };
  }, []);

  // Cleanup audio preview on unmount
  useEffect(() => {
    return () => {
      if (previewSourceRef.current) {
        try {
          previewSourceRef.current.stop();
        } catch {}
        previewSourceRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleAuditionVoice = async (voiceName: string) => {
    if (auditioningVoice === voiceName) {
      if (previewSourceRef.current) {
        try {
          previewSourceRef.current.stop();
        } catch {}
        previewSourceRef.current = null;
      }
      setAuditioningVoice(null);
      setIsAuditionLoading(false);
      return;
    }

    if (previewSourceRef.current) {
      try {
        previewSourceRef.current.stop();
      } catch {}
      previewSourceRef.current = null;
    }

    setAuditioningVoice(voiceName);
    setIsAuditionLoading(true);

    const safetyTimer = window.setTimeout(() => {
      setIsAuditionLoading(false);
      setAuditioningVoice(null);
    }, 40000);

    try {
      const res = await fetch(`/api/voice/preview?voice=${encodeURIComponent(voiceName)}`, {
        headers: authService.getAuthHeaders(),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to load audition sample (${res.status})`);
      }
      const data = await res.json();
      if (!data.audioBase64) {
        throw new Error('No audio returned for sample.');
      }

      const binaryStr = atob(data.audioBase64);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const decodedBuffer = await audioEngine.decodeAudio(bytes.buffer);
      const ctx = await audioEngine.init();

      const src = ctx.createBufferSource();
      src.buffer = decodedBuffer;
      src.connect(ctx.destination);

      src.onended = () => {
        window.clearTimeout(safetyTimer);
        setAuditioningVoice(null);
        setIsAuditionLoading(false);
      };

      previewSourceRef.current = src;
      src.start();
      window.clearTimeout(safetyTimer);
      setIsAuditionLoading(false);
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.warn('Audition error:', msg);
      setErrorMessage(msg);
      window.clearTimeout(safetyTimer);
      setAuditioningVoice(null);
      setIsAuditionLoading(false);
    }
  };

  // Precept Slot Handlers
  const handleSlotClick = (index: number) => {
    setSlotNotice(null);
    const existing = customPrecepts[index];
    if (existing) {
      // Load saved instruction into input box
      setDeliveryInstruction(existing.instruction);
    } else {
      // Prompt to save current instruction into this slot
      if (!deliveryInstruction.trim()) {
        setSlotNotice('Type an instruction in the box first to save it as a precept.');
        setTimeout(() => setSlotNotice(null), 3500);
        return;
      }
      setSavingSlotIndex(index);
      setNewPreceptTitle('');
    }
  };

  const handleConfirmSavePrecept = (e: React.FormEvent) => {
    e.preventDefault();
    if (savingSlotIndex === null) return;
    const title = newPreceptTitle.trim() || `Precept ${savingSlotIndex + 1}`;
    savePrecept(savingSlotIndex, {
      id: `precept-${Date.now()}-${savingSlotIndex}`,
      title,
      instruction: deliveryInstruction.trim(),
    });
    setSavingSlotIndex(null);
    setNewPreceptTitle('');
  };

  const handleClearPreceptSlot = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    clearPrecept(index);
    if (savingSlotIndex === index) {
      setSavingSlotIndex(null);
    }
  };

  // Generation Handler
  const handleGenerate = async () => {
    if (!script.trim() || status !== 'idle') return;

    setErrorMessage(null);
    setStatus('sending');
    setProgressMsg('Connecting to Gemini TTS...');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/voice/generate', {
        method: 'POST',
        headers: authService.getAuthHeaders(),
        signal: controller.signal,
        body: JSON.stringify({
          script: script.trim(),
          voiceName: selectedVoice,
          modelId: selectedModel,
          instruction: deliveryInstruction.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 401) {
          throw new Error('Sign in with Google is required to generate voiceovers.');
        }
        if (response.status === 403) {
          throw new Error(errorData.error || 'This account has been blocked. Contact support.');
        }
        if (response.status === 429) {
          throw new Error(
            errorData.error ||
              'Gemini TTS quota limit reached (429). Please wait a moment and retry.'
          );
        }
        throw new Error(errorData.error || `Voice synthesis failed (${response.status})`);
      }

      setStatus('decoding');
      setProgressMsg('Decoding audio to timeline...');

      const result = await response.json();
      const base64Data = result.audioBase64;
      if (!base64Data) {
        throw new Error('Engine returned empty audio payload.');
      }

      const binaryStr = atob(base64Data);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const decodedBuffer = await audioEngine.decodeAudio(bytes.buffer);
      if (!decodedBuffer || decodedBuffer.duration <= 0.2) {
        throw new Error('The voice engine returned empty audio. Nothing was added to the timeline. Please try again.');
      }

      const newAssetId = `vo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const voiceMeta: VoiceMetadata = {
        script: script.trim(),
        voiceName: selectedVoice,
        model: selectedModel,
        deliveryInstruction: deliveryInstruction.trim(),
      };

      const newAsset: Asset = {
        id: newAssetId,
        name: `VO - ${selectedVoice}`,
        kind: 'voice',
        buffer: decodedBuffer,
        sampleRate: decodedBuffer.sampleRate,
        durationSeconds: decodedBuffer.duration,
        numberOfChannels: decodedBuffer.numberOfChannels,
        voiceMetadata: voiceMeta,
      };

      audioEngine.registerAsset(newAsset);
      await saveAssetToDB(newAsset);

      // Add to timeline on new top track
      onAddVoiceTrack(newAsset, voiceMeta);

      setStatus('idle');
      setProgressMsg('');
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        setStatus('idle');
        setProgressMsg('');
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setStatus('idle');
      setProgressMsg('');
    } finally {
      abortControllerRef.current = null;
    }
  };

  const femaleVoices = voices.filter((v) => v.gender === 'Female');
  const maleVoices = voices.filter((v) => v.gender === 'Male');

  const wordCount = script.trim() ? script.trim().split(/\s+/).length : 0;
  const estimatedSeconds = (wordCount / 2.5).toFixed(1);

  return (
    <div className="flex flex-col h-full bg-[#0D0D12] border-r border-zinc-800 text-zinc-200 select-text">
      {/* Minimalist Panel Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-zinc-800/80 bg-[#121218] shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
            <Mic className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-100">
            Voiceover Studio
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('uuda:open-voiceover-modal'))}
            title="Expand to Full Voiceover Workspace Modal"
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-800/80 transition-colors cursor-pointer"
          >
            <Sparkles className="w-3 h-3 text-cyan-400" />
            <span>Expand Studio</span>
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-200 p-1 rounded hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Content Body */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
        {/* Error notification */}
        {errorMessage && (
          <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/60 text-xs text-rose-200 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <span className="leading-relaxed text-[11px]">{errorMessage}</span>
              <button
                onClick={() => setErrorMessage(null)}
                className="text-zinc-400 hover:text-white p-0.5 rounded cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {errorMessage.includes('Sign in') && (
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('uuda:open-signin'))}
                className="self-start px-2.5 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-[11px] cursor-pointer"
              >
                Sign in with Google
              </button>
            )}
          </div>
        )}

        {/* 1. Voice Talent Selection + Instant Audition */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider flex items-center gap-1">
              <Volume2 className="w-3 h-3 text-cyan-400" />
              <span>Voice Talent</span>
            </label>
            <button
              type="button"
              onClick={() => handleAuditionVoice(selectedVoice)}
              disabled={isAuditionLoading}
              title={`Audition sample for ${selectedVoice}`}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold transition-all border cursor-pointer ${
                auditioningVoice === selectedVoice
                  ? 'bg-amber-500 text-black border-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.4)]'
                  : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border-zinc-700/80 hover:text-cyan-300'
              }`}
            >
              {isAuditionLoading && auditioningVoice === selectedVoice ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : auditioningVoice === selectedVoice ? (
                <Pause className="w-3 h-3 fill-current" />
              ) : (
                <Play className="w-3 h-3 fill-current" />
              )}
              <span>{auditioningVoice === selectedVoice ? 'Stop' : 'Audition'}</span>
            </button>
          </div>

          <select
            value={selectedVoice}
            onChange={(e) => {
              setSelectedVoice(e.target.value);
              if (auditioningVoice) {
                handleAuditionVoice(e.target.value);
              }
            }}
            className="w-full bg-[#09090d] border border-zinc-700/80 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-cyan-500 font-medium cursor-pointer"
          >
            <optgroup label="Female Voices" className="bg-[#121216] text-zinc-300 font-semibold">
              {femaleVoices.length > 0
                ? femaleVoices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} — {v.descriptor}
                    </option>
                  ))
                : [
                    <option key="Zephyr" value="Zephyr">Zephyr — Bright, upbeat & clear</option>,
                    <option key="Kore" value="Kore">Kore — Calm, balanced & articulate</option>,
                    <option key="Aoede" value="Aoede">Aoede — Expressive & melodic</option>,
                    <option key="Leda" value="Leda">Leda — Soft storytelling</option>,
                    <option key="Callirrhoe" value="Callirrhoe">Callirrhoe — Warm & welcoming</option>,
                    <option key="Despina" value="Despina">Despina — Crisp & professional</option>,
                  ]}
            </optgroup>
            <optgroup label="Male Voices" className="bg-[#121216] text-zinc-300 font-semibold">
              {maleVoices.length > 0
                ? maleVoices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} — {v.descriptor}
                    </option>
                  ))
                : [
                    <option key="Puck" value="Puck">Puck — Playful & dynamic</option>,
                    <option key="Charon" value="Charon">Charon — Informative broadcaster</option>,
                    <option key="Fenrir" value="Fenrir">Fenrir — Authoritative & resonant</option>,
                    <option key="Enceladus" value="Enceladus">Enceladus — Warm & friendly</option>,
                    <option key="Iapetus" value="Iapetus">Iapetus — Classic radio announcer</option>,
                    <option key="Orus" value="Orus">Orus — Deep & resonant</option>,
                  ]}
            </optgroup>
          </select>
        </div>

        {/* 2. Model Tier */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider flex items-center gap-1">
              <Sliders className="w-3 h-3 text-cyan-400" />
              <span>Synthesis Tier</span>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {models.map((m) => {
              const isSelected = selectedModel === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedModel(m.id)}
                  className={`px-2 py-1.5 rounded-lg text-xs font-semibold border transition-all text-left flex items-center justify-between cursor-pointer ${
                    isSelected
                      ? 'bg-cyan-950/40 border-cyan-400 text-cyan-200'
                      : 'bg-[#121218] border-zinc-700/80 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
                  }`}
                >
                  <span className="truncate">{m.tier}</span>
                  {isSelected && <Check className="w-3 h-3 text-cyan-400 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Script Text Area */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider flex items-center gap-1">
              <FileText className="w-3 h-3 text-cyan-400" />
              <span>Script</span>
            </label>
            <span className="text-[10px] text-zinc-500 font-mono">
              {wordCount} words • ~{estimatedSeconds}s
            </span>
          </div>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={3}
            placeholder="Type or paste voiceover script..."
            className="w-full bg-[#09090d] border border-zinc-700/80 rounded-lg p-2.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-cyan-500 leading-relaxed font-sans resize-none"
          />
        </div>

        {/* 4. Instruction Text Input Box */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-cyan-400" />
              <span>Instruction</span>
            </label>
            {deliveryInstruction && (
              <button
                type="button"
                onClick={() => setDeliveryInstruction('')}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
          <textarea
            value={deliveryInstruction}
            onChange={(e) => setDeliveryInstruction(e.target.value)}
            rows={2}
            placeholder="Eg: professional radio broadcast style with energetic stinger delivery"
            className="w-full bg-[#09090d] border border-zinc-700/80 rounded-lg p-2 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-cyan-500 leading-snug font-sans resize-none"
          />
        </div>

        {/* 5. Custom Precepts (Saved Instructions - Exactly 4 Buttons) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider flex items-center gap-1">
              <Bookmark className="w-3 h-3 text-cyan-400" />
              <span>Custom Precepts (4 Slots)</span>
            </label>
            <span className="text-[9px] text-zinc-500">
              {customPrecepts.filter(Boolean).length}/4 Saved
            </span>
          </div>

          {/* Feedback Notice */}
          {slotNotice && (
            <div className="mb-2 p-1.5 rounded bg-cyan-950/50 border border-cyan-800 text-[10px] text-cyan-300">
              {slotNotice}
            </div>
          )}

          {/* Inline Save Precept Prompt */}
          {savingSlotIndex !== null && (
            <form
              onSubmit={handleConfirmSavePrecept}
              className="mb-2 p-2.5 rounded-lg bg-[#181822] border border-cyan-500/60 shadow-lg space-y-2 animate-in fade-in"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-cyan-300">
                  Save Precept Slot {savingSlotIndex + 1}
                </span>
                <button
                  type="button"
                  onClick={() => setSavingSlotIndex(null)}
                  className="text-zinc-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                type="text"
                autoFocus
                value={newPreceptTitle}
                onChange={(e) => setNewPreceptTitle(e.target.value)}
                placeholder="Enter precept title (e.g. Radio Stinger, Promo Warmth)"
                className="w-full bg-[#0a0a0e] border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-cyan-400 font-medium"
              />
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setSavingSlotIndex(null)}
                  className="px-2.5 py-1 rounded text-[11px] text-zinc-400 hover:bg-zinc-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 rounded bg-cyan-500 text-black font-bold text-[11px] hover:bg-cyan-400 cursor-pointer"
                >
                  Save Title
                </button>
              </div>
            </form>
          )}

          {/* 4 Custom Precept Buttons */}
          <div className="grid grid-cols-2 gap-1.5">
            {customPrecepts.map((precept, idx) => {
              const isAssigned = !!precept;
              const isActive =
                isAssigned && deliveryInstruction.trim() === precept.instruction.trim();

              if (!isAssigned) {
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSlotClick(idx)}
                    title="Click to save current instruction into this slot"
                    className="p-2 rounded-lg border border-dashed border-zinc-800 hover:border-cyan-500/60 bg-[#121217] hover:bg-zinc-900/60 text-zinc-500 hover:text-cyan-300 text-left transition-all flex items-center justify-between group cursor-pointer"
                  >
                    <span className="text-[11px] font-medium flex items-center gap-1.5 truncate">
                      <Plus className="w-3 h-3 text-zinc-600 group-hover:text-cyan-400 shrink-0" />
                      <span className="truncate">Precept {idx + 1}</span>
                    </span>
                    <span className="text-[9px] text-zinc-600 group-hover:text-cyan-400 shrink-0">+ Save</span>
                  </button>
                );
              }

              return (
                <div
                  key={idx}
                  onClick={() => handleSlotClick(idx)}
                  className={`p-2 rounded-lg border text-left transition-all relative flex items-center justify-between cursor-pointer group ${
                    isActive
                      ? 'bg-cyan-950/40 border-cyan-400 text-cyan-200 shadow-[0_0_10px_rgba(0,240,255,0.2)]'
                      : 'bg-[#15151c] border-zinc-700/80 hover:border-zinc-500 text-zinc-200 hover:bg-[#1a1a24]'
                  }`}
                >
                  <div className="flex-1 min-w-0 pr-1">
                    <div className="flex items-center gap-1">
                      {isActive && <Check className="w-3 h-3 text-cyan-400 shrink-0 stroke-[2.5]" />}
                      <span className="text-xs font-bold truncate block">{precept.title}</span>
                    </div>
                    <span
                      className="text-[9px] text-zinc-400 truncate block mt-0.5"
                      title={precept.instruction}
                    >
                      {precept.instruction}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => handleClearPreceptSlot(idx, e)}
                    title="Delete / Free up this slot"
                    className="p-1 text-zinc-500 hover:text-rose-400 hover:bg-zinc-800/80 rounded transition-colors shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Generate Action Button */}
        <div className="pt-1">
          <button
            type="button"
            disabled={status !== 'idle' || !script.trim()}
            onClick={handleGenerate}
            className="w-full py-2.5 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white shadow-[0_0_16px_rgba(0,240,255,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status !== 'idle' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>{progressMsg || 'Generating voiceover...'}</span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4" />
                <span>Generate Voiceover Track</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
