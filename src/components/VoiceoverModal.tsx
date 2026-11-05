/**
 * Uuda Studio - Voiceover Workspace Modal
 * Built on the shared ModalShell (workspace variant) and design tokens.
 * Left pane: script, delivery direction, four saved directions. Right pane: voice list (takes the height that is left),
 * quality tier and the rendered preview. Below 1024 px the panes stack and the whole body scrolls.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Volume2,
  Play,
  Pause,
  Sparkles,
  FileText,
  Sliders,
  Bookmark,
  Plus,
  Loader2,
  Check,
  Search,
  Wand2,
  Trash2,
  Layers,
  Lock,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { Asset, VoiceMetadata } from '../types';
import { audioEngine } from '../audio/engine';
import { saveAssetToDB } from '../storage/db';
import { authService } from '../services/authService';
import { useVoiceSession, CustomPrecept } from '../voice/voiceSession';
import { useVoiceJob, voiceJob, parseScriptAndInstructionClient } from '../voice/voiceJob';
import { Button, ModalShell, SegmentedControl } from './ui';

interface VoiceItem {
  name: string;
  gender: 'Female' | 'Male';
  descriptor: string;
  tags: string[];
}

const EXTENDED_GEMINI_VOICES: VoiceItem[] = [
  // Female voices (13)
  { name: 'Zephyr', gender: 'Female', descriptor: 'Bright, upbeat & clear', tags: ['Commercial', 'Promo', 'Upbeat'] },
  { name: 'Kore', gender: 'Female', descriptor: 'Calm, balanced & articulate', tags: ['Narrator', 'Podcast', 'Calm'] },
  { name: 'Aoede', gender: 'Female', descriptor: 'Expressive & melodic', tags: ['Creative', 'Dramatic', 'Melodic'] },
  { name: 'Leda', gender: 'Female', descriptor: 'Soft & intimate storytelling', tags: ['Storyteller', 'Audiobook', 'Intimate'] },
  { name: 'Callirrhoe', gender: 'Female', descriptor: 'Warm & welcoming', tags: ['Corporate', 'Friendly', 'Warm'] },
  { name: 'Autonoe', gender: 'Female', descriptor: 'Energetic & spirited', tags: ['Youth', 'Stinger', 'Vibrant'] },
  { name: 'Despina', gender: 'Female', descriptor: 'Crisp & professional', tags: ['News', 'Documentary', 'Sharp'] },
  { name: 'Erinome', gender: 'Female', descriptor: 'Gentle & reassuring', tags: ['Wellness', 'Guided', 'Reassuring'] },
  { name: 'Laomedeia', gender: 'Female', descriptor: 'Smooth & conversational', tags: ['Interview', 'Casual', 'Smooth'] },
  { name: 'Achernar', gender: 'Female', descriptor: 'Direct & authoritative', tags: ['Executive', 'Urgent', 'Direct'] },
  { name: 'Gacrux', gender: 'Female', descriptor: 'Deep & grounded', tags: ['Serious', 'Documentary', 'Deep'] },
  { name: 'Vindemiatrix', gender: 'Female', descriptor: 'Polished & broadcast-ready', tags: ['Radio Imaging', 'Broadcast', 'Polished'] },
  { name: 'Sulafat', gender: 'Female', descriptor: 'Airy & friendly', tags: ['Commercial', 'Light', 'Friendly'] },

  // Male voices (17)
  { name: 'Puck', gender: 'Male', descriptor: 'Playful, engaging & dynamic', tags: ['Promo', 'Stinger', 'Dynamic'] },
  { name: 'Fenrir', gender: 'Male', descriptor: 'Authoritative & resonant', tags: ['Movie Trailer', 'Broadcast', 'Resonant'] },
  { name: 'Charon', gender: 'Male', descriptor: 'Informative & professional broadcaster', tags: ['News', 'Radio Imaging', 'Informative'] },
  { name: 'Orus', gender: 'Male', descriptor: 'Deep & resonant', tags: ['Dramatic', 'Trailer', 'Low Pitch'] },
  { name: 'Enceladus', gender: 'Male', descriptor: 'Warm, relatable & conversational', tags: ['Podcast Host', 'Warm', 'Friendly'] },
  { name: 'Iapetus', gender: 'Male', descriptor: 'Classic radio announcer', tags: ['Radio ID', 'Classic', 'Deep'] },
  { name: 'Umbriel', gender: 'Male', descriptor: 'Grave & dramatic', tags: ['Documentary', 'Dramatic', 'Serious'] },
  { name: 'Algieba', gender: 'Male', descriptor: 'Bright & charismatic', tags: ['Commercial', 'Upbeat', 'Charismatic'] },
  { name: 'Algenib', gender: 'Male', descriptor: 'Bold & persuasive', tags: ['Advertising', 'Bold', 'Persuasive'] },
  { name: 'Rasalgethi', gender: 'Male', descriptor: 'Documentary & narrator style', tags: ['Documentary', 'Narrator', 'Steady'] },
  { name: 'Alnilam', gender: 'Male', descriptor: 'Smooth & measured', tags: ['Technical', 'Smooth', 'Measured'] },
  { name: 'Schedar', gender: 'Male', descriptor: 'Commanding & cinematic', tags: ['Urgent', 'Imaging', 'Commanding'] },
  { name: 'Pulcherrima', gender: 'Male', descriptor: 'Rich & warm baritone', tags: ['Podcast', 'Warm Baritone', 'Deep'] },
  { name: 'Achird', gender: 'Male', descriptor: 'Casual & friendly', tags: ['Interview', 'Casual', 'Friendly'] },
  { name: 'Zubenelgenubi', gender: 'Male', descriptor: 'Steady & informative', tags: ['News', 'Informative', 'Steady'] },
  { name: 'Sadachbia', gender: 'Male', descriptor: 'Clear & articulate', tags: ['Explainer', 'Corporate', 'Articulate'] },
  { name: 'Sadaltager', gender: 'Male', descriptor: 'Measured & reflective', tags: ['Storyteller', 'Reflective', 'Calm'] },
];



interface VoiceoverModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Kept for compatibility; the finished voiceover is added through the shared job's commit handler (see App) */
  onAddVoiceTrack?: (asset: Asset, voiceMeta: VoiceMetadata) => void;
}

export const VoiceoverModal: React.FC<VoiceoverModalProps> = ({
  isOpen,
  onClose,
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

  // Search and filter for voices
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [genderFilter, setGenderFilter] = useState<'All' | 'Female' | 'Male'>('All');

  const [savingSlotIndex, setSavingSlotIndex] = useState<number | null>(null);
  const [newPreceptTitle, setNewPreceptTitle] = useState<string>('');
  const [slotNotice, setSlotNotice] = useState<string | null>(null);

  // Ensure selectedVoice is always a valid voice from the verified lineup
  useEffect(() => {
    const isValid = EXTENDED_GEMINI_VOICES.some((v) => v.name === selectedVoice);
    if (!isValid) {
      setSelectedVoice('Zephyr');
    }
  }, [selectedVoice, setSelectedVoice]);

  // Generation, finished voiceover and audition are one shared job (voice/voiceJob.ts), identical to the sidebar
  const job = useVoiceJob();
  const { status, progressMsg, auditioningVoice, isAuditionLoading } = job;
  const errorMessage = job.error;
  const generatedAsset = job.asset;
  const isPlayingGenerated = job.isPlayingGenerated;
  const setErrorMessage = (message: string | null) => voiceJob.setError(message);
  const isBusy = status === 'sending' || status === 'decoding';

  // Hooks must all run before the early return below, or opening the modal changes the hook count and crashes
  const voiceListRef = useRef<HTMLUListElement | null>(null);

  if (!isOpen) return null;

  const handleAuditionVoice = (voiceName: string) => {
    void voiceJob.audition(voiceName);
  };

  // Precept slot clicks
  const handleSlotClick = (index: number) => {
    setSlotNotice(null);
    const existing = customPrecepts[index];
    if (existing) {
      setDeliveryInstruction(existing.instruction);
    } else {
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

  // Text formatting helpers
  const handleCleanSpacing = () => {
    const cleaned = script
      .replace(/\s+/g, ' ')
      .replace(/\s([,.!?;:])/g, '$1')
      .trim();
    setScript(cleaned);
  };

  const handleAddPause = () => {
    setScript(script.trim() + ' ... ');
  };

  const handleGenerate = () => {
    void voiceJob.generate({
      origin: 'modal',
      script,
      voiceName: selectedVoice,
      modelId: selectedModel,
      instruction: deliveryInstruction,
    });
  };

  const handleTogglePlayGenerated = () => voiceJob.togglePlayGenerated();

  const handleCommitToTimeline = () => {
    voiceJob.commit();
    onClose();
  };

  // Filter voices
  const filteredVoices = EXTENDED_GEMINI_VOICES.filter((v) => {
    const matchesGender = genderFilter === 'All' || v.gender === genderFilter;
    const matchesSearch =
      v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.descriptor.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesGender && matchesSearch;
  });

  // Move the selection to the next or previous voice in the list as it is filtered, and audition it straight away,
  // so a voice can be tested and the next one tried in one motion
  const stepVoice = (direction: 1 | -1) => {
    if (isBusy || filteredVoices.length === 0) return;
    const at = filteredVoices.findIndex((v) => v.name === selectedVoice);
    const count = filteredVoices.length;
    const next = at === -1 ? (direction === 1 ? 0 : count - 1) : (at + direction + count) % count;
    const name = filteredVoices[next].name;
    setSelectedVoice(name);
    void voiceJob.audition(name);
    requestAnimationFrame(() => {
      voiceListRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
    });
  };

  const wordCount = script.trim() ? script.trim().split(/\s+/).length : 0;
  const estimatedSeconds = (wordCount / 2.5).toFixed(1);

  const selectedPicked = EXTENDED_GEMINI_VOICES.find((v) => v.name === selectedVoice);
  const selectedAuditioning = auditioningVoice === selectedVoice;
  const preceptCount = customPrecepts.filter(Boolean).length;

  const sectionLabel = (icon: React.ReactNode, text: string, aside?: React.ReactNode) => (
    <div className="mb-2 flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-dim">
        <span className="text-accent" aria-hidden="true">{icon}</span>
        {text}
      </span>
      {aside}
    </div>
  );

  const auditionButtonClass = (active: boolean) =>
    `flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
      active
        ? 'bg-accent text-accent-ink'
        : 'border border-line-strong bg-surface-3 text-ink hover:bg-surface-2'
    }`;

  return (
    <ModalShell
      open={isOpen}
      onClose={onClose}
      title="Voiceover Studio"
      description="Write the script, direct the delivery, pick a voice and audition it, then generate."
      size="lg"
      variant="workspace"
      footer={
        <>
          <div className="mr-auto flex min-w-0 items-center gap-3 text-xs text-ink-dim">
            <span className="truncate">
              Voice: <strong className="font-semibold text-ink">{selectedVoice}</strong>
            </span>
            {progressMsg && (
              <span className="flex items-center gap-2 font-medium text-accent" role="status">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                <span className="truncate">{progressMsg}</span>
              </span>
            )}
          </div>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {generatedAsset ? (
            <Button variant="primary" onClick={handleCommitToTimeline} leftIcon={<Layers className="h-4 w-4" aria-hidden="true" />}>
              Place on new track
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleGenerate}
              loading={isBusy}
              disabled={!script.trim()}
              leftIcon={<Wand2 className="h-4 w-4" aria-hidden="true" />}
            >
              {isBusy ? 'Synthesizing...' : 'Generate voiceover'}
            </Button>
          )}
        </>
      }
    >
      {errorMessage && (
        <div role="alert" className="flex shrink-0 items-center justify-between gap-3 border-b border-danger/30 bg-danger/10 px-5 py-2.5 text-xs text-danger">
          <span className="font-medium">{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            aria-label="Dismiss message"
            className="cursor-pointer rounded-full p-1 text-danger hover:bg-danger/20"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Small screens: the whole body scrolls. From 1024 px up: two panes that scroll on their own. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        {/* Left pane: script, direction, precepts */}
        <section className="flex min-w-0 flex-1 flex-col gap-5 p-5 lg:min-h-0 lg:overflow-y-auto">
          <div className="flex min-h-[220px] flex-1 flex-col">
            {sectionLabel(
              <FileText className="h-4 w-4" />,
              'Script',
              <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                <span className="font-num text-ink-dim">
                  <strong className="font-semibold text-ink">{wordCount}</strong> words · ~
                  <strong className="font-semibold text-ink">{estimatedSeconds}s</strong>
                </span>
                <button
                  type="button"
                  onClick={handleCleanSpacing}
                  title="Clean extra spaces and punctuation"
                  className="cursor-pointer rounded-full border border-line-strong bg-surface-3 px-2.5 py-1 text-[11px] font-medium text-ink-dim transition-colors hover:text-ink"
                >
                  Clean spacing
                </button>
                <button
                  type="button"
                  onClick={handleAddPause}
                  title="Add a breathing pause (three dots)"
                  className="cursor-pointer rounded-full border border-line-strong bg-surface-3 px-2.5 py-1 text-[11px] font-medium text-ink-dim transition-colors hover:text-ink"
                >
                  + Pause
                </button>
              </div>,
            )}
            <textarea
              aria-label="Script: the text to be spoken"
              value={script}
              onChange={(e) => {
                const val = e.target.value;
                if (
                  /(?:^|\n)\s*(?:###\s*)?\[?\s*Script\s*\]?\s*:/i.test(val) ||
                  /(?:^|\n)\s*(?:###\s*)?\[?\s*Instruction(?:s)?\s*\]?\s*:/i.test(val)
                ) {
                  const parsed = parseScriptAndInstructionClient(val, deliveryInstruction);
                  setScript(parsed.cleanScript);
                  if (parsed.directorNotes) {
                    setDeliveryInstruction(parsed.directorNotes);
                  }
                } else {
                  setScript(val);
                }
              }}
              placeholder="The text to be spoken. You can also paste ### [Script]: and ### [Instruction]: blocks and they will be split for you."
              className="min-h-[160px] w-full flex-1 resize-none rounded-control border border-line-strong bg-surface-0 p-4 text-sm leading-relaxed text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            />
          </div>

          <div>
            {sectionLabel(
              <Sparkles className="h-4 w-4" />,
              'Delivery direction',
              deliveryInstruction ? (
                <button type="button" onClick={() => setDeliveryInstruction('')} className="cursor-pointer text-[11px] text-ink-faint hover:text-ink">
                  Clear
                </button>
              ) : undefined,
            )}
            <textarea
              aria-label="Delivery direction: how the script should be spoken"
              value={deliveryInstruction}
              onChange={(e) => setDeliveryInstruction(e.target.value)}
              rows={2}
              placeholder="How to say it: tone, emotion, pace, accent, warmth. Used as direction only, never read aloud."
              className="w-full resize-none rounded-control border border-line-strong bg-surface-0 p-3 text-xs leading-relaxed text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            />
          </div>

          <div>
            {sectionLabel(
              <Bookmark className="h-4 w-4" />,
              'Saved directions',
              <span className="font-num text-[11px] text-ink-faint">{preceptCount}/4 saved</span>,
            )}

            {slotNotice && (
              <div role="status" className="mb-2 rounded-control border border-accent/30 bg-accent-soft p-2 text-xs text-accent">
                {slotNotice}
              </div>
            )}

            {savingSlotIndex !== null && (
              <form
                onSubmit={handleConfirmSavePrecept}
                className="mb-3 space-y-2 rounded-control border border-accent/50 bg-surface-2 p-3"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink">Save as slot {savingSlotIndex + 1}</span>
                  <button
                    type="button"
                    onClick={() => setSavingSlotIndex(null)}
                    aria-label="Cancel saving"
                    className="cursor-pointer rounded-full p-1 text-ink-dim hover:text-ink"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <input
                  type="text"
                  autoFocus
                  aria-label="Name for this saved direction"
                  value={newPreceptTitle}
                  onChange={(e) => setNewPreceptTitle(e.target.value)}
                  placeholder="Name it (e.g. Radio promo, Warm intro)"
                  className="w-full rounded-control border border-line-strong bg-surface-0 px-3 py-2 text-xs text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setSavingSlotIndex(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="primary" type="submit">
                    Save
                  </Button>
                </div>
              </form>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {customPrecepts.map((precept, idx) => {
                const isAssigned = !!precept;
                const isActive = isAssigned && deliveryInstruction.trim() === precept.instruction.trim();

                if (!isAssigned) {
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSlotClick(idx)}
                      title="Save the current direction into this slot"
                      className="flex cursor-pointer items-center gap-1.5 rounded-control border border-dashed border-line-strong p-2.5 text-left text-xs text-ink-faint transition-colors hover:border-accent/50 hover:text-accent"
                    >
                      <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">Slot {idx + 1}</span>
                    </button>
                  );
                }

                return (
                  <div
                    key={idx}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSlotClick(idx)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSlotClick(idx);
                      }
                    }}
                    className={`group relative flex cursor-pointer items-center justify-between rounded-control border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                      isActive ? 'border-accent bg-accent-soft text-ink' : 'border-line-strong bg-surface-2 text-ink hover:border-white/20'
                    }`}
                  >
                    <div className="min-w-0 flex-1 pr-1">
                      <div className="flex items-center gap-1.5">
                        {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />}
                        <span className="block truncate text-xs font-semibold">{precept.title}</span>
                      </div>
                      <span className="mt-0.5 block truncate text-[10px] text-ink-faint">{precept.instruction}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => handleClearPreceptSlot(idx, e)}
                      title="Clear this slot"
                      aria-label={`Clear slot ${idx + 1}`}
                      className="shrink-0 cursor-pointer rounded p-1 text-ink-faint opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Right pane: voice and quality. The voice list takes all the height that is left. */}
        <aside className="flex shrink-0 flex-col gap-4 border-t border-line bg-surface-0/40 p-5 lg:min-h-0 lg:w-[400px] lg:border-l lg:border-t-0">
          <div className="flex min-h-0 flex-1 flex-col">
            {sectionLabel(
              <Volume2 className="h-4 w-4" />,
              'Voice',
              <span className="font-num text-[11px] text-ink-faint">{filteredVoices.length} voices</span>,
            )}

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[140px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
                <input
                  type="text"
                  aria-label="Search voices by name, tone or tag"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search name, tone or tag"
                  className="h-9 w-full rounded-full border border-line-strong bg-surface-3 pl-8 pr-3 text-xs text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                />
              </div>
              <SegmentedControl
                size="sm"
                label="Filter voices by gender"
                value={genderFilter}
                onChange={setGenderFilter}
                options={[
                  { value: 'All', label: 'All' },
                  { value: 'Female', label: 'Female' },
                  { value: 'Male', label: 'Male' },
                ]}
              />
            </div>

            {/* Focus card: the one voice that will be used, always in view, with stepping and audition in one place */}
            <div className="mb-3 rounded-control border border-accent/50 bg-accent-soft p-3" aria-live="polite">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                {isBusy ? <Lock className="h-3 w-3" aria-hidden="true" /> : <Volume2 className={`h-3 w-3 ${selectedAuditioning && !isAuditionLoading ? 'animate-pulse motion-reduce:animate-none' : ''}`} aria-hidden="true" />}
                <span>
                  {isBusy
                    ? 'Selected (locked while generating)'
                    : selectedAuditioning
                    ? isAuditionLoading ? 'Loading audition' : 'Auditioning now'
                    : 'Selected voice'}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-ink">{selectedVoice}</div>
                  {selectedPicked && (
                    <div className="truncate text-[11px] text-ink-dim">
                      {selectedPicked.gender} · {selectedPicked.descriptor}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => stepVoice(-1)}
                    disabled={isBusy || filteredVoices.length === 0}
                    title="Previous voice (plays it)"
                    aria-label="Previous voice"
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-surface-3 text-ink transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => stepVoice(1)}
                    disabled={isBusy || filteredVoices.length === 0}
                    title="Next voice (plays it)"
                    aria-label="Next voice"
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-surface-3 text-ink transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAuditionVoice(selectedVoice)}
                    disabled={isAuditionLoading && !selectedAuditioning}
                    className={auditionButtonClass(selectedAuditioning)}
                  >
                    {isAuditionLoading && selectedAuditioning ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    ) : selectedAuditioning ? (
                      <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    <span>{selectedAuditioning ? 'Stop' : 'Audition'}</span>
                  </button>
                </div>
              </div>
            </div>

            <ul ref={voiceListRef} className="-mr-1 max-h-72 space-y-1.5 overflow-y-auto pr-1 lg:max-h-none lg:min-h-0 lg:flex-1" aria-label="Voices">
              {filteredVoices.length === 0 && (
                <li className="rounded-control border border-dashed border-line-strong p-4 text-center text-xs text-ink-faint">
                  No voice matches that search.
                </li>
              )}
              {filteredVoices.map((v) => {
                const isSelected = selectedVoice === v.name;
                const isAuditioning = auditioningVoice === v.name;

                return (
                  <li key={v.name}>
                    <div
                      role="button"
                      tabIndex={isBusy ? -1 : 0}
                      aria-pressed={isSelected}
                      aria-disabled={isBusy || undefined}
                      onClick={() => {
                        if (!isBusy) setSelectedVoice(v.name);
                      }}
                      onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                          e.preventDefault();
                          if (!isBusy) setSelectedVoice(v.name);
                        }
                      }}
                      className={`flex items-center justify-between gap-2 rounded-control border p-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                        isBusy ? 'cursor-not-allowed' : 'cursor-pointer'
                      } ${
                        isSelected
                          ? 'border-accent bg-accent-soft'
                          : isAuditioning
                          ? 'border-accent/40 bg-surface-3'
                          : 'border-line bg-surface-2 opacity-60 hover:border-line-strong hover:bg-surface-3 hover:opacity-100 focus-within:opacity-100'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface-3 text-xs font-semibold text-ink-dim" aria-hidden="true">
                          {v.name.slice(0, 2)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-ink">{v.name}</span>
                            <span className="text-[10px] text-ink-faint">{v.gender}</span>
                          </div>
                          <p className="truncate text-[11px] text-ink-dim">{v.descriptor}</p>
                          <p className="truncate text-[10px] text-ink-faint">{v.tags.slice(0, 3).join(' · ')}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAuditionVoice(v.name);
                        }}
                        disabled={isAuditionLoading && !isAuditioning}
                        aria-label={`${isAuditioning ? 'Stop' : 'Audition'} ${v.name}`}
                        className={auditionButtonClass(isAuditioning)}
                      >
                        {isAuditionLoading && isAuditioning ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        ) : isAuditioning ? (
                          <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <Play className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        <span>{isAuditioning ? 'Stop' : 'Audition'}</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            {sectionLabel(<Sliders className="h-4 w-4" />, 'Quality')}
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'gemini-3.8-flash-tts', name: 'Flagship quality', desc: 'Expressive, natural nuance' },
                { id: 'gemini-3.8-flash-lite-tts', name: 'Low latency', desc: 'Fast draft rendering' },
              ].map((tier) => {
                const isSelected = selectedModel === tier.id;
                return (
                  <button
                    key={tier.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setSelectedModel(tier.id)}
                    className={`cursor-pointer rounded-control border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                      isSelected ? 'border-accent bg-accent-soft text-ink' : 'border-line bg-surface-2 text-ink-dim hover:border-line-strong hover:text-ink'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>{tier.name}</span>
                      {isSelected && <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" />}
                    </div>
                    <p className="mt-0.5 text-[10px] text-ink-faint">{tier.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {generatedAsset && (
            <div className="flex items-center justify-between gap-3 rounded-control border border-ok/40 bg-ok/10 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden="true" />
                  <span className="text-xs font-semibold text-ok">Voiceover ready ({generatedAsset.durationSeconds.toFixed(1)}s)</span>
                </div>
                <p className="mt-0.5 text-[10px] text-ink-dim">It will be placed on a new track at the top.</p>
              </div>
              <button type="button" onClick={handleTogglePlayGenerated} className={auditionButtonClass(isPlayingGenerated)}>
                {isPlayingGenerated ? <Pause className="h-3.5 w-3.5" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
                <span>{isPlayingGenerated ? 'Pause' : 'Listen'}</span>
              </button>
            </div>
          )}
        </aside>
      </div>
    </ModalShell>
  );
};
