/**
 * Uuda Studio - Expanded Voiceover Workspace Modal
 * Spacious, multi-pane broadcast voice synthesis studio.
 * Left Pane: Expansive text editor, formatting tools, script analytics, delivery instructions, and 4 custom precepts.
 * Right Pane: Enlarged voice talent browser with audition player, gender/style filtering, and synthesis tier selector.
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
  Filter,
  Wand2,
  Trash2,
  RotateCcw,
  Layers,
  ArrowRight,
  ShieldCheck,
  Mic,
  Lock,
} from 'lucide-react';
import { Asset, VoiceMetadata } from '../types';
import { audioEngine } from '../audio/engine';
import { saveAssetToDB } from '../storage/db';
import { authService } from '../services/authService';
import { useVoiceSession, CustomPrecept } from '../voice/voiceSession';
import { useVoiceJob, voiceJob, parseScriptAndInstructionClient } from '../voice/voiceJob';

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

  const wordCount = script.trim() ? script.trim().split(/\s+/).length : 0;
  const estimatedSeconds = (wordCount / 2.5).toFixed(1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-black/85 backdrop-blur-md select-none animate-in fade-in duration-200">
      <div className="w-full max-w-6xl h-[calc(100dvh-1.5rem)] md:h-[92dvh] bg-[#0E0E14] border border-zinc-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100">
        {/* Workspace Top Header */}
        <div className="h-14 px-3 sm:px-6 border-b border-zinc-800 flex items-center justify-between bg-[#12121A] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center text-white shadow-[0_0_15px_rgba(0,240,255,0.35)]">
              <Mic className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-black uppercase tracking-wider text-white">
                  Voiceover Studio Workspace
                </h1>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-300 font-mono font-semibold border border-cyan-800/80">
                  Gemini Speech Engine
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Multi-talent voice generation with director guidance and sample auditioning
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-white p-1.5 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Close Workspace"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Error Notification Bar */}
        {errorMessage && (
          <div className="px-6 py-2.5 bg-rose-950/70 border-b border-rose-800 text-xs text-rose-200 flex items-center justify-between shrink-0">
            <span className="font-medium">{errorMessage}</span>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-rose-300 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Multi-Pane Body */}
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden divide-y lg:divide-y-0 lg:divide-x divide-zinc-800">
          {/* Left Pane: Script Editor & Director Directives */}
          <div className="flex-1 flex flex-col min-w-0 p-5 overflow-y-auto space-y-4">
            {/* Script Text Input Section */}
            <div className="flex-1 flex flex-col min-h-[220px]">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                    ### [Script] — Spoken Audio Content
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-zinc-400 font-mono">
                    <strong className="text-cyan-400">{wordCount}</strong> words • ~
                    <strong className="text-cyan-400">{estimatedSeconds}s</strong> duration
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleCleanSpacing}
                      title="Clean extra spaces and punctuation"
                      className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-medium transition-colors cursor-pointer"
                    >
                      Clean Spacing
                    </button>
                    <button
                      type="button"
                      onClick={handleAddPause}
                      title="Add breathing pause (3 dots)"
                      className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-medium transition-colors cursor-pointer"
                    >
                      + Pause
                    </button>
                  </div>
                </div>
              </div>

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
                    if (parsed.directorNotes) {
                      setDeliveryInstruction(parsed.directorNotes);
                    }
                  } else {
                    setScript(val);
                  }
                }}
                placeholder="The actual text you must speak (e.g. paste your script or format as ### [Script]: &quot;...&quot; and ### [Instruction]: &quot;...&quot;)"
                className="flex-1 w-full min-h-[160px] bg-[#0A0A0E] border border-zinc-700/80 rounded-xl p-4 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-cyan-500 leading-relaxed font-sans resize-none transition-colors"
              />
            </div>

            {/* Director Instruction Input */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                    ### [Instruction] — Director's Voice Engine Directives
                  </span>
                </div>
                {deliveryInstruction && (
                  <button
                    type="button"
                    onClick={() => setDeliveryInstruction('')}
                    className="text-[11px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>
              <p className="text-[11px] text-zinc-500 mb-1.5 leading-relaxed">
                Directives on HOW to speak it (tone, emotion, pace, accent, pitch, texture). Applied strictly as voice profile boundaries — never read aloud.
              </p>
              <textarea
                value={deliveryInstruction}
                onChange={(e) => setDeliveryInstruction(e.target.value)}
                rows={2}
                placeholder="Directives on HOW to speak it (e.g., tone, emotion, pace, accent, warmth, texture)"
                className="w-full bg-[#0A0A0E] border border-zinc-700/80 rounded-xl p-3 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-400 leading-relaxed font-sans resize-none transition-colors"
              />
            </div>

            {/* 4 Custom Precept Slots */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Bookmark className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                    Custom Instruction Precepts
                  </span>
                </div>
                <span className="text-[10px] text-zinc-500 font-mono">
                  {customPrecepts.filter(Boolean).length}/4 Saved
                </span>
              </div>

              {slotNotice && (
                <div className="mb-2 p-2 rounded-lg bg-cyan-950/60 border border-cyan-800 text-xs text-cyan-300">
                  {slotNotice}
                </div>
              )}

              {/* Title input when saving */}
              {savingSlotIndex !== null && (
                <form
                  onSubmit={handleConfirmSavePrecept}
                  className="mb-3 p-3 rounded-xl bg-[#181824] border border-cyan-500/80 shadow-lg space-y-2 animate-in fade-in"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-cyan-300">
                      Save as Precept Slot {savingSlotIndex + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSavingSlotIndex(null)}
                      className="text-zinc-400 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <input
                    type="text"
                    autoFocus
                    value={newPreceptTitle}
                    onChange={(e) => setNewPreceptTitle(e.target.value)}
                    placeholder="Enter precept title (e.g. Radio Promo, Warm Intro)"
                    className="w-full bg-[#0A0A0E] border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-cyan-400 font-medium"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setSavingSlotIndex(null)}
                      className="px-3 py-1 rounded text-xs text-zinc-400 hover:bg-zinc-800 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1 rounded bg-cyan-500 text-black font-bold text-xs hover:bg-cyan-400 cursor-pointer"
                    >
                      Save Precept
                    </button>
                  </div>
                </form>
              )}

              {/* 4 Slots Grid */}
              <div className="grid grid-cols-2 gap-2">
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
                        className="p-3 rounded-xl border border-dashed border-zinc-800 hover:border-cyan-500/60 bg-[#121218] hover:bg-zinc-900 text-zinc-500 hover:text-cyan-300 text-left transition-all flex items-center justify-between group cursor-pointer"
                      >
                        <span className="text-xs font-medium flex items-center gap-1.5 truncate">
                          <Plus className="w-3.5 h-3.5 text-zinc-600 group-hover:text-cyan-400 shrink-0" />
                          <span className="truncate">Precept Slot {idx + 1}</span>
                        </span>
                        <span className="text-[10px] text-zinc-600 group-hover:text-cyan-400 shrink-0">
                          + Save
                        </span>
                      </button>
                    );
                  }

                  return (
                    <div
                      key={idx}
                      onClick={() => handleSlotClick(idx)}
                      className={`p-3 rounded-xl border text-left transition-all relative flex items-center justify-between cursor-pointer group ${
                        isActive
                          ? 'bg-cyan-950/50 border-cyan-400 text-cyan-200 shadow-[0_0_12px_rgba(0,240,255,0.25)]'
                          : 'bg-[#14141E] border-zinc-700/80 hover:border-zinc-500 text-zinc-200 hover:bg-[#1a1a26]'
                      }`}
                    >
                      <div className="flex-1 min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          {isActive && (
                            <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0 stroke-[2.5]" />
                          )}
                          <span className="text-xs font-bold truncate block">{precept.title}</span>
                        </div>
                        <span className="text-[10px] text-zinc-500 truncate block mt-0.5">
                          {precept.instruction}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleClearPreceptSlot(idx, e)}
                        title="Clear precept slot"
                        className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-rose-400 hover:bg-zinc-800/80 rounded transition-all cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Pane: Enlarged Voice Talent Selection & Auditioning */}
          <div className="w-full lg:w-[480px] flex flex-col p-5 bg-[#0F0F16] space-y-4 shrink-0 overflow-y-auto">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-cyan-400" />
                  <span>Select Voice Talent</span>
                </span>
                <span className="text-[11px] text-zinc-400 font-mono">
                  {filteredVoices.length} Voices Available
                </span>
              </div>

              {/* Filters & Search */}
              <div className="flex items-center gap-2 mb-3">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by voice name, tone or tag..."
                    className="w-full bg-[#09090D] border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div className="flex items-center p-0.5 bg-[#09090D] border border-zinc-800 rounded-lg shrink-0 text-xs">
                  {(['All', 'Female', 'Male'] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGenderFilter(g)}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all cursor-pointer ${
                        genderFilter === g
                          ? 'bg-cyan-500 text-black shadow-xs'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              {/* Pinned selected voice: stays visible while browsing the list */}
              {(() => {
                const picked = EXTENDED_GEMINI_VOICES.find((v) => v.name === selectedVoice);
                const pickedAuditioning = auditioningVoice === selectedVoice;
                return (
                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-cyan-950/50 border border-cyan-400">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-cyan-300 font-bold">
                        <Lock className="w-3 h-3" />
                        <span>Selected voice{isBusy ? ' (locked while generating)' : ''}</span>
                      </div>
                      <div className="text-sm font-bold text-white truncate">
                        {selectedVoice}
                        {picked && <span className="ml-2 text-[11px] font-medium text-zinc-400">{picked.gender} - {picked.descriptor}</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAuditionVoice(selectedVoice)}
                      disabled={isAuditionLoading && !pickedAuditioning}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-100 cursor-pointer disabled:opacity-50 shrink-0"
                    >
                      {isAuditionLoading && pickedAuditioning ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : pickedAuditioning ? (
                        <Pause className="w-3.5 h-3.5" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                      <span>{pickedAuditioning ? 'Stop' : 'Audition'}</span>
                    </button>
                  </div>
                );
              })()}

              {/* Scrollable Voice Grid */}
              <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto pr-1">
                {filteredVoices.map((v) => {
                  const isSelected = selectedVoice === v.name;
                  const isAuditioning = auditioningVoice === v.name;

                  return (
                    <div
                      key={v.name}
                      onClick={() => {
                        if (!isBusy) setSelectedVoice(v.name);
                      }}
                      className={`p-3 rounded-xl border transition-all flex items-center justify-between cursor-pointer ${
                        isSelected
                          ? 'bg-cyan-950/40 border-cyan-400 shadow-[0_0_12px_rgba(0,240,255,0.2)]'
                          : 'bg-[#13131B] border-zinc-800 hover:border-zinc-700 hover:bg-[#181822]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 pr-2">
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                            v.gender === 'Female'
                              ? 'bg-pink-500/20 text-pink-300 border border-pink-500/30'
                              : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                          }`}
                        >
                          {v.name.slice(0, 2)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-zinc-100">{v.name}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">
                              {v.gender}
                            </span>
                          </div>
                          <p className="text-[11px] text-zinc-400 truncate">{v.descriptor}</p>
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {v.tags.map((t) => (
                              <span
                                key={t}
                                className="text-[9px] px-1.5 py-0.2 rounded bg-[#0A0A0E] text-zinc-500 border border-zinc-800"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Audition Button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAuditionVoice(v.name);
                        }}
                        disabled={isAuditionLoading && !isAuditioning}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border shrink-0 cursor-pointer ${
                          isAuditioning
                            ? 'bg-amber-500 text-black border-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.5)]'
                            : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border-zinc-700 hover:text-cyan-300'
                        }`}
                      >
                        {isAuditionLoading && isAuditioning ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : isAuditioning ? (
                          <Pause className="w-3.5 h-3.5 fill-current" />
                        ) : (
                          <Play className="w-3.5 h-3.5 fill-current" />
                        )}
                        <span>{isAuditioning ? 'Stop' : 'Audition'}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Model Synthesis Tier */}
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2 mb-2">
                <Sliders className="w-4 h-4 text-cyan-400" />
                <span>Synthesis Quality Tier</span>
              </span>
              <div className="grid grid-cols-2 gap-2">
                {[
                  {
                    id: 'gemini-3.8-flash-tts',
                    name: 'Flagship Quality',
                    desc: 'Expressive prosody & natural nuances',
                  },
                  {
                    id: 'gemini-3.8-flash-lite-tts',
                    name: 'Low Latency',
                    desc: 'Fast turnaround draft rendering',
                  },
                ].map((tier) => {
                  const isSelected = selectedModel === tier.id;
                  return (
                    <button
                      key={tier.id}
                      type="button"
                      onClick={() => setSelectedModel(tier.id)}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-cyan-950/40 border-cyan-400 text-cyan-200'
                          : 'bg-[#13131B] border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span>{tier.name}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                      </div>
                      <p className="text-[10px] text-zinc-500 mt-0.5">{tier.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Ready Preview Card (if audio was generated) */}
            {generatedAsset && (
              <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/60 flex items-center justify-between animate-in fade-in">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs font-bold text-emerald-300">
                      Voiceover Rendered ({generatedAsset.durationSeconds.toFixed(1)}s)
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-400 mt-0.5">
                    Ready to place onto timeline at top index 0
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleTogglePlayGenerated}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition-colors cursor-pointer"
                >
                  {isPlayingGenerated ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                  <span>{isPlayingGenerated ? 'Pause' : 'Listen'}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Workspace Footer Action Bar */}
        <div className="h-16 px-6 border-t border-zinc-800 bg-[#12121A] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-400">
              Selected: <strong className="text-cyan-400">{selectedVoice}</strong> ({genderFilter === 'All' ? 'Gemini Voice' : genderFilter})
            </span>
            {progressMsg && (
              <div className="flex items-center gap-2 text-xs text-cyan-300 font-medium">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                <span>{progressMsg}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>

            {generatedAsset ? (
              <button
                type="button"
                onClick={handleCommitToTimeline}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-black font-bold text-xs hover:from-emerald-400 hover:to-cyan-400 shadow-[0_0_15px_rgba(16,185,129,0.35)] transition-all cursor-pointer"
              >
                <Layers className="w-4 h-4" />
                <span>Place on New Timeline Track</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isBusy || !script.trim()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white font-bold text-xs hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_15px_rgba(0,240,255,0.35)] transition-all cursor-pointer"
              >
                {isBusy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Synthesizing...</span>
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4" />
                    <span>Generate Voiceover Track</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
