/**
 * Uuda Studio - Voiceover job (one shared copy)
 *
 * The sidebar Voiceover panel and the expanded Voiceover modal both read and drive this one job, so they always show
 * the same thing: generating, ready, failed, or an audition in progress. The job lives outside React, so it keeps
 * running when a panel is closed, the sidebar tab is changed, or the modal is opened or closed.
 *
 * origin 'panel': the finished voiceover is added to the timeline automatically (as the sidebar always did).
 * origin 'modal': the finished voiceover waits for "Listen" / "Add to timeline".
 * Either view can listen to, add, or discard a finished voiceover.
 */

import { useSyncExternalStore } from 'react';
import { Asset, VoiceMetadata } from '../types';
import { audioEngine } from '../audio/engine';
import { saveAssetToDB } from '../storage/db';
import { authService } from '../services/authService';

export type VoiceJobStatus = 'idle' | 'sending' | 'decoding' | 'ready';
export type VoiceJobOrigin = 'panel' | 'modal';

export interface VoiceJobState {
  status: VoiceJobStatus;
  origin: VoiceJobOrigin | null;
  progressMsg: string;
  /** epoch ms when the running job started (for an elapsed-time display) */
  startedAt: number | null;
  error: string | null;
  /** short confirmation, e.g. "Added to timeline" */
  notice: string | null;
  asset: Asset | null;
  meta: VoiceMetadata | null;
  isPlayingGenerated: boolean;
  auditioningVoice: string | null;
  isAuditionLoading: boolean;
}

export interface GenerateRequest {
  origin: VoiceJobOrigin;
  script: string;
  voiceName: string;
  modelId: string;
  instruction: string;
}

/** The whole request, including waiting for Gemini, must finish within this time */
const GENERATE_TIMEOUT_MS = 120_000;
const AUDITION_TIMEOUT_MS = 40_000;

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function parseScriptAndInstructionClient(
  rawScript: string,
  explicitInstruction?: string
): { cleanScript: string; directorNotes: string } {
  const raw = (rawScript || '').trim();
  let scriptPart = raw;
  let instructionPart = (explicitInstruction || '').trim();

  const hasScriptHeader = /(?:^|\n)\s*(?:###\s*)?\[?\s*Script\s*\]?\s*:/i.test(raw);
  const hasInstructionHeader = /(?:^|\n)\s*(?:###\s*)?\[?\s*Instruction(?:s)?\s*\]?\s*:/i.test(raw);

  if (hasScriptHeader || hasInstructionHeader) {
    const scriptMatch = raw.match(
      /(?:^|\n)\s*(?:###\s*)?\[?\s*Script\s*\]?\s*:\s*([\s\S]*?)(?=(?:\n\s*(?:###\s*)?\[?\s*Instruction(?:s)?\s*\]?\s*:)|$)/i
    );
    const instructionMatch = raw.match(
      /(?:^|\n)\s*(?:###\s*)?\[?\s*Instruction(?:s)?\s*\]?\s*:\s*([\s\S]*?)(?=(?:\n\s*(?:###\s*)?\[?\s*Script\s*\]?\s*:)|$)/i
    );

    const unquote = (s: string) => {
      const t = s.trim();
      return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))
        ? t.slice(1, -1).trim()
        : t;
    };

    if (scriptMatch && scriptMatch[1]) {
      scriptPart = unquote(scriptMatch[1]);
    } else if (hasInstructionHeader && !hasScriptHeader) {
      scriptPart = raw.replace(/(?:^|\n)\s*(?:###\s*)?\[?\s*Instruction(?:s)?\s*\]?\s*:[\s\S]*$/i, '').trim();
    }

    if (instructionMatch && instructionMatch[1]) {
      const extracted = unquote(instructionMatch[1]);
      instructionPart = instructionPart ? `${instructionPart}; ${extracted}` : extracted;
    }
  } else {
    const t = scriptPart.trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      scriptPart = t.slice(1, -1).trim();
    }
  }

  return { cleanScript: scriptPart.trim(), directorNotes: instructionPart.trim() };
}

class VoiceJobStore {
  private state: VoiceJobState = {
    status: 'idle',
    origin: null,
    progressMsg: '',
    startedAt: null,
    error: null,
    notice: null,
    asset: null,
    meta: null,
    isPlayingGenerated: false,
    auditioningVoice: null,
    isAuditionLoading: false,
  };
  private listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private previewSource: AudioBufferSourceNode | null = null;
  private generatedSource: AudioBufferSourceNode | null = null;
  private commitHandler: ((asset: Asset, meta: VoiceMetadata) => void) | null = null;
  private auditionToken = 0;

  getSnapshot = (): VoiceJobState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(patch: Partial<VoiceJobState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** App registers how a finished voiceover becomes a timeline track. Done once, outside any panel. */
  setCommitHandler(handler: ((asset: Asset, meta: VoiceMetadata) => void) | null) {
    this.commitHandler = handler;
  }

  setError(error: string | null) {
    this.set({ error });
  }

  clearNotice() {
    this.set({ notice: null });
  }

  // ---------------------------------------------------------------------------
  // Generation
  // ---------------------------------------------------------------------------
  async generate(req: GenerateRequest): Promise<void> {
    const { cleanScript, directorNotes } = parseScriptAndInstructionClient(req.script, req.instruction);
    if (!cleanScript || this.isBusy()) return;

    this.stopGenerated();
    this.set({
      status: 'sending',
      origin: req.origin,
      progressMsg: 'Generating voiceover...',
      startedAt: Date.now(),
      error: null,
      notice: null,
      asset: null,
      meta: null,
    });

    const controller = new AbortController();
    this.controller = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, GENERATE_TIMEOUT_MS);

    try {
      const response = await fetch('/api/voice/generate', {
        method: 'POST',
        headers: authService.getAuthHeaders(),
        credentials: 'same-origin',
        signal: controller.signal,
        body: JSON.stringify({
          script: cleanScript,
          voiceName: req.voiceName,
          modelId: req.modelId,
          instruction: directorNotes,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 401) throw new Error('Sign in with Google is required to generate voiceovers.');
        if (response.status === 403) throw new Error(errorData.error || 'This account has been blocked. Contact support.');
        if (response.status === 429) {
          throw new Error(errorData.error || 'Gemini TTS rate limit reached. Please wait a moment and retry.');
        }
        throw new Error(errorData.error || `Voice synthesis failed (${response.status})`);
      }

      this.set({ status: 'decoding', progressMsg: 'Preparing audio for the timeline...' });
      const result = await response.json();
      if (!result.audioBase64) throw new Error('Engine returned empty audio payload.');

      const decoded = await audioEngine.decodeAudio(base64ToBytes(result.audioBase64).buffer as ArrayBuffer);
      if (!decoded || decoded.duration <= 0.2) {
        throw new Error('The voice engine returned empty audio. Nothing was added to the timeline. Please try again.');
      }

      const meta: VoiceMetadata = {
        script: cleanScript,
        voiceName: req.voiceName,
        model: req.modelId,
        deliveryInstruction: directorNotes,
      };
      const asset: Asset = {
        id: `vo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: `VO - ${req.voiceName}`,
        kind: 'voice',
        buffer: decoded,
        sampleRate: decoded.sampleRate,
        durationSeconds: decoded.duration,
        numberOfChannels: decoded.numberOfChannels,
        voiceMetadata: meta,
      };
      audioEngine.registerAsset(asset);
      await saveAssetToDB(asset);

      this.set({ status: 'ready', asset, meta, progressMsg: '', startedAt: null });

      // The sidebar adds straight to the timeline; the modal waits for the user
      if (req.origin === 'panel' && this.commitHandler) this.commit();
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        this.set({
          status: 'idle',
          progressMsg: '',
          startedAt: null,
          error: timedOut ? 'Voice generation took longer than 2 minutes and was stopped. Please try again.' : null,
        });
      } else {
        this.set({
          status: 'idle',
          progressMsg: '',
          startedAt: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      clearTimeout(timer);
      this.controller = null;
    }
  }

  isBusy(): boolean {
    return this.state.status === 'sending' || this.state.status === 'decoding';
  }

  cancel() {
    this.controller?.abort();
  }

  // ---------------------------------------------------------------------------
  // Finished voiceover
  // ---------------------------------------------------------------------------
  commit() {
    const { asset, meta } = this.state;
    if (!asset || !meta || !this.commitHandler) return;
    this.stopGenerated();
    this.commitHandler(asset, meta);
    this.set({ status: 'idle', asset: null, meta: null, notice: 'Voiceover added to the timeline.' });
  }

  discard() {
    this.stopGenerated();
    this.set({ status: 'idle', asset: null, meta: null, origin: null });
  }

  togglePlayGenerated() {
    const { asset, isPlayingGenerated } = this.state;
    if (!asset) return;
    if (isPlayingGenerated) {
      this.stopGenerated();
      return;
    }
    const ctx = audioEngine.getContext();
    if (!ctx) return;
    if (!asset.buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = asset.buffer;
    src.connect(ctx.destination);
    src.onended = () => {
      if (this.generatedSource === src) {
        this.generatedSource = null;
        this.set({ isPlayingGenerated: false });
      }
    };
    this.generatedSource = src;
    src.start();
    this.set({ isPlayingGenerated: true });
  }

  private stopGenerated() {
    if (this.generatedSource) {
      try {
        this.generatedSource.stop();
      } catch {
        /* already stopped */
      }
      this.generatedSource = null;
    }
    if (this.state.isPlayingGenerated) this.set({ isPlayingGenerated: false });
  }

  // ---------------------------------------------------------------------------
  // Audition
  // ---------------------------------------------------------------------------
  stopAudition() {
    this.auditionToken++;
    if (this.previewSource) {
      try {
        this.previewSource.stop();
      } catch {
        /* already stopped */
      }
      this.previewSource = null;
    }
    this.set({ auditioningVoice: null, isAuditionLoading: false });
  }

  async audition(voiceName: string): Promise<void> {
    // Clicking the voice that is playing or loading stops it
    if (this.state.auditioningVoice === voiceName) {
      this.stopAudition();
      return;
    }
    this.stopAudition();
    const token = ++this.auditionToken;
    this.set({ auditioningVoice: voiceName, isAuditionLoading: true, error: null });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AUDITION_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/voice/preview?voice=${encodeURIComponent(voiceName)}`, {
        headers: authService.getAuthHeaders(),
        credentials: 'same-origin',
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Audition failed (${res.status})`);
      }
      const data = await res.json();
      if (!data.audioBase64) throw new Error('No audio returned for the audition.');

      const decoded = await audioEngine.decodeAudio(base64ToBytes(data.audioBase64).buffer as ArrayBuffer);
      if (token !== this.auditionToken) return; // stopped or replaced while loading
      const ctx = await audioEngine.init();
      const src = ctx.createBufferSource();
      src.buffer = decoded;
      src.connect(ctx.destination);
      src.onended = () => {
        if (this.previewSource === src) {
          this.previewSource = null;
          this.set({ auditioningVoice: null, isAuditionLoading: false });
        }
      };
      this.previewSource = src;
      src.start();
      this.set({ isAuditionLoading: false });
    } catch (err) {
      if (token !== this.auditionToken) return;
      const aborted = err instanceof Error && err.name === 'AbortError';
      this.set({
        auditioningVoice: null,
        isAuditionLoading: false,
        error: aborted ? 'The audition took too long. Please try again.' : err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

export const voiceJob = new VoiceJobStore();

export function useVoiceJob(): VoiceJobState {
  return useSyncExternalStore(voiceJob.subscribe, voiceJob.getSnapshot, voiceJob.getSnapshot);
}
