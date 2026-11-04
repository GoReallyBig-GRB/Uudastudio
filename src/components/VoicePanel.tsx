/**
 * Uuda Studio - Voiceover Studio Panel
 * Professional voice synthesis powered by Gemini TTS.
 * Minimalist studio UI featuring custom instruction precepts, instant talent audition,
 * delivery directives, and direct timeline placement.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Mic, Play, Pause, Trash2, Plus, Loader2, Check, X } from 'lucide-react';
import { Asset, VoiceMetadata } from '../types';
import { audioEngine } from '../audio/engine';
import { saveAssetToDB } from '../storage/db';
import { authService } from '../services/authService';
import { useVoiceSession, CustomPrecept } from '../voice/voiceSession';
import { useVoiceJob, voiceJob, parseScriptAndInstructionClient } from '../voice/voiceJob';
import { VoiceJobBar } from './VoiceJobBar';
import { Button } from './ui/Button';
import { SegmentedControl } from './ui/SegmentedControl';
import { FIELD, pill, notice, PanelHeader, ExpandRow, PanelSection } from './sidebarParts';

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

  // Generation, finished voiceover and audition are one shared job (see voice/voiceJob.ts), identical in the modal
  const job = useVoiceJob();
  const { status, progressMsg, auditioningVoice, isAuditionLoading } = job;
  const errorMessage = job.error;
  const setErrorMessage = (message: string | null) => voiceJob.setError(message);
  const isBusy = status === 'sending' || status === 'decoding';

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
              if (!data.voices.some((v: any) => v.name === selectedVoice)) {
                setSelectedVoice(data.voices[0]?.name || 'Zephyr');
              }
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

  const handleAuditionVoice = (voiceName: string) => {
    void voiceJob.audition(voiceName);
  };

  const handleGenerate = () => {
    void voiceJob.generate({
      origin: 'panel',
      script,
      voiceName: selectedVoice,
      modelId: selectedModel,
      instruction: deliveryInstruction,
    });
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

  const femaleVoices = voices.filter((v) => v.gender === 'Female');
  const maleVoices = voices.filter((v) => v.gender === 'Male');

  const wordCount = script.trim() ? script.trim().split(/\s+/).length : 0;
  const estimatedSeconds = (wordCount / 2.5).toFixed(1);

  const voiceChoices = (list: VoiceOption[], fallback: Array<[string, string]>) =>
    list.length > 0
      ? list.map((v) => (
          <option key={v.name} value={v.name}>
            {v.name} — {v.descriptor}
          </option>
        ))
      : fallback.map(([name, descriptor]) => (
          <option key={name} value={name}>
            {name} — {descriptor}
          </option>
        ));

  const isAuditioningSelected = auditioningVoice === selectedVoice;

  return (
    <div className="flex h-full flex-col border-r border-line bg-surface-1 text-ink-dim select-text">
      <PanelHeader icon={<Mic className="h-3.5 w-3.5" />} title="Voiceover" subtitle="Write, pick a voice, place on the timeline" />

      <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 [scrollbar-width:thin]">
        <ExpandRow
          label="Open full voiceover studio"
          title="Open the larger Voiceover workspace"
          onClick={() => window.dispatchEvent(new CustomEvent('uuda:open-voiceover-modal'))}
        />

        {errorMessage && (
          <div className={notice('danger')} role="alert">
            <div className="flex items-start justify-between gap-2">
              <span>{errorMessage}</span>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                aria-label="Dismiss message"
                className="shrink-0 cursor-pointer rounded-full p-0.5 text-danger/80 hover:text-danger"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {errorMessage.includes('Sign in') && (
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('uuda:open-signin'))}
                className={pill(true, 'mt-2')}
              >
                Sign in with Google
              </button>
            )}
          </div>
        )}

        <PanelSection label="Voice" first>
          <div className="flex items-center gap-2">
            <select
              aria-label="Voice"
              value={selectedVoice}
              onChange={(e) => {
                setSelectedVoice(e.target.value);
                if (auditioningVoice) handleAuditionVoice(e.target.value);
              }}
              className={`${FIELD} h-8 min-w-0 flex-1 cursor-pointer`}
            >
              <optgroup label="Female voices">
                {voiceChoices(femaleVoices, [
                  ['Zephyr', 'Bright, upbeat & clear'],
                  ['Kore', 'Calm, balanced & articulate'],
                  ['Aoede', 'Expressive & melodic'],
                  ['Leda', 'Soft storytelling'],
                  ['Callirrhoe', 'Warm & welcoming'],
                  ['Despina', 'Crisp & professional'],
                ])}
              </optgroup>
              <optgroup label="Male voices">
                {voiceChoices(maleVoices, [
                  ['Puck', 'Playful & dynamic'],
                  ['Charon', 'Informative broadcaster'],
                  ['Fenrir', 'Authoritative & resonant'],
                  ['Enceladus', 'Warm & friendly'],
                  ['Iapetus', 'Classic radio announcer'],
                  ['Orus', 'Deep & resonant'],
                ])}
              </optgroup>
            </select>
            <button
              type="button"
              onClick={() => handleAuditionVoice(selectedVoice)}
              disabled={isAuditionLoading}
              title={`Audition ${selectedVoice}`}
              className={pill(isAuditioningSelected, 'h-8 w-24')}
            >
              {isAuditionLoading && isAuditioningSelected ? (
                <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
              ) : isAuditioningSelected ? (
                <Pause className="h-3 w-3 fill-current" />
              ) : (
                <Play className="h-3 w-3 fill-current" />
              )}
              <span>{isAuditioningSelected ? 'Stop' : 'Audition'}</span>
            </button>
          </div>
        </PanelSection>

        <PanelSection label="Quality">
          <SegmentedControl
            label="Quality"
            size="sm"
            value={selectedModel}
            onChange={setSelectedModel}
            options={models.map((m) => ({ value: m.id, label: m.tier }))}
            className="w-full [&>button]:flex-1"
          />
        </PanelSection>

        <PanelSection label="Script" aside={`${wordCount} words · ~${estimatedSeconds}s`}>
          <textarea
            value={script}
            onChange={(e) => {
              const val = e.target.value;
              if (
                /(?:^|\n)\s*(?:###\s*)?\[?\s*Script\s*\]?\s*:/i.test(val) ||
                /(?:^|\n)\s*(?:###\s*)?\[?\s*Instruction(?:s)?\s*\]?\s*:/i.test(val)
              ) {
                const parsed = parseScriptAndInstructionClient(val, deliveryInstruction);
                setScript(parsed.cleanScript);
                if (parsed.directorNotes) setDeliveryInstruction(parsed.directorNotes);
              } else {
                setScript(val);
              }
            }}
            rows={5}
            aria-label="Script"
            placeholder="The text to be spoken"
            className={`${FIELD} resize-none py-2 leading-relaxed`}
          />
        </PanelSection>

        <PanelSection
          label="Direction"
          aside={
            deliveryInstruction ? (
              <button type="button" onClick={() => setDeliveryInstruction('')} className="cursor-pointer text-ink-faint hover:text-ink">
                Clear
              </button>
            ) : undefined
          }
        >
          <textarea
            value={deliveryInstruction}
            onChange={(e) => setDeliveryInstruction(e.target.value)}
            rows={2}
            aria-label="Direction"
            placeholder="How to say it: tone, pace, accent, emotion. Never read aloud."
            className={`${FIELD} resize-none py-2 leading-snug`}
          />
        </PanelSection>

        <PanelSection label="Saved directions" aside={`${customPrecepts.filter(Boolean).length}/4`}>
          {slotNotice && <div className={`${notice()} mb-2`}>{slotNotice}</div>}

          {savingSlotIndex !== null && (
            <form onSubmit={handleConfirmSavePrecept} className="mb-2 space-y-2 rounded-control border border-accent/40 bg-surface-2 p-2.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-ink">Save as direction {savingSlotIndex + 1}</span>
                <button
                  type="button"
                  onClick={() => setSavingSlotIndex(null)}
                  aria-label="Cancel saving"
                  className="cursor-pointer rounded-full p-0.5 text-ink-faint hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                type="text"
                autoFocus
                value={newPreceptTitle}
                onChange={(e) => setNewPreceptTitle(e.target.value)}
                aria-label="Direction name"
                placeholder="Name, for example Radio stinger"
                className={`${FIELD} h-8`}
              />
              <div className="flex justify-end gap-1.5">
                <button type="button" onClick={() => setSavingSlotIndex(null)} className={pill()}>Cancel</button>
                <button type="submit" className={pill(true)}>Save</button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-2 gap-1.5">
            {customPrecepts.map((precept, idx) => {
              if (!precept) {
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSlotClick(idx)}
                    title="Save the current direction into this slot"
                    className="flex h-12 cursor-pointer items-center justify-center gap-1.5 rounded-control border border-dashed border-line-strong text-[11px] text-ink-faint transition-colors hover:border-accent/40 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    <Plus className="h-3 w-3" aria-hidden="true" />
                    <span>Empty slot</span>
                  </button>
                );
              }
              const isActive = deliveryInstruction.trim() === precept.instruction.trim();
              return (
                <div
                  key={idx}
                  className={`group relative flex h-12 min-w-0 items-center rounded-control border transition-colors ${
                    isActive ? 'border-accent/40 bg-accent-soft' : 'border-line bg-surface-3/60 hover:bg-surface-3'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSlotClick(idx)}
                    title={precept.instruction}
                    aria-pressed={isActive}
                    className="flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-center rounded-control px-2.5 pr-7 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    <span className={`flex items-center gap-1 truncate text-[11px] font-semibold ${isActive ? 'text-accent' : 'text-ink'}`}>
                      {isActive && <Check className="h-3 w-3 shrink-0" aria-hidden="true" />}
                      <span className="truncate">{precept.title}</span>
                    </span>
                    <span className="truncate text-[10px] text-ink-faint">{precept.instruction}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleClearPreceptSlot(idx, e)}
                    title="Free this slot"
                    aria-label={`Free slot ${precept.title}`}
                    className="absolute right-1 top-1/2 -translate-y-1/2 cursor-pointer rounded-full p-1 text-ink-faint opacity-60 transition-opacity hover:text-danger group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </PanelSection>
      </div>

      <div className="shrink-0 space-y-2 border-t border-line bg-surface-1 p-4">
        <VoiceJobBar />
        <Button
          variant="primary"
          size="sm"
          className="w-full"
          disabled={isBusy || !script.trim()}
          loading={false}
          onClick={handleGenerate}
          leftIcon={isBusy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Mic className="h-4 w-4" />}
        >
          {isBusy ? progressMsg || 'Generating voiceover...' : 'Generate voiceover track'}
        </Button>
      </div>
    </div>
  );
};
