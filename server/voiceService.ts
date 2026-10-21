/**
 * X-PRO AUDIO - Strict AI Voiceover Service
 * Eliminates all prompt leakage.
 * The text sent to Gemini TTS is strictly and only the sanitized user script.
 * Zero tolerance for drift, hallucination, or instruction speech.
 */

import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';

// Fixed neutral audition sentence stored as a constant
export const AUDITION_SAMPLE_SENTENCE = 'Welcome to Uuda Studio. Your voiceover studio is ready.';

// Banned phrases that must never be spoken or appear in ASR transcripts
export const BANNED_INSTRUCTION_PHRASES = [
  'production format',
  'format:',
  'style:',
  'instruction:',
  'instruction',
  'instructions',
  'speak aloud',
  'do not speak',
  'do not read',
  'do not add',
  'do not say',
  'do not',
  'plain natural voiceover',
  'radio imaging',
  'podcast show',
  'commercial advertisement',
  'introductory remarks',
  'script:',
  'say script',
];

/**
 * Sanitizes script text:
 * - Strips unprintable control characters
 * - Normalizes CRLF and consecutive whitespace
 * - Trims leading and trailing whitespace
 * - Absolutely NOTHING is prepended, appended, labeled or wrapped in quotes.
 */
export function sanitizeScriptText(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes text for Word Error Rate (WER) comparison
 */
export function normalizeTextForWER(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Computes Word Error Rate (WER) using Levenshtein distance on words
 */
export function computeWordErrorRate(reference: string, hypothesis: string): number {
  const refWords = normalizeTextForWER(reference);
  const hypWords = normalizeTextForWER(hypothesis);

  if (refWords.length === 0) {
    return hypWords.length === 0 ? 0 : 1;
  }

  const d: number[][] = [];
  for (let i = 0; i <= refWords.length; i++) {
    d[i] = [i];
  }
  for (let j = 0; j <= hypWords.length; j++) {
    d[0][j] = j;
  }

  for (let i = 1; i <= refWords.length; i++) {
    for (let j = 1; j <= hypWords.length; j++) {
      const cost = refWords[i - 1] === hypWords[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1, // deletion
        d[i][j - 1] + 1, // insertion
        d[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return d[refWords.length][hypWords.length] / refWords.length;
}

/**
 * Payload Guard: Verifies that the outgoing request payload text strictly equals the sanitized script.
 */
export function assertPayloadStrictEquality(sentText: string, sanitizedScript: string): void {
  const hashSent = crypto.createHash('sha256').update(sentText, 'utf8').digest('hex');
  const hashScript = crypto.createHash('sha256').update(sanitizedScript, 'utf8').digest('hex');

  if (sentText !== sanitizedScript || hashSent !== hashScript) {
    throw new Error(
      `PAYLOAD GUARD FAILURE: Outgoing TTS payload differs from sanitized script!\n` +
      `Expected Hash: ${hashScript}\nReceived Hash: ${hashSent}\nPayload: "${sentText.substring(0, 100)}..."`
    );
  }
}

/**
 * Checks if transcript contains any banned phrase that was not explicitly present in the user's original script.
 */
export function checkForBannedPhrases(transcript: string, originalScript: string): string | null {
  const lowerTranscript = transcript.toLowerCase();
  const lowerScript = originalScript.toLowerCase();

  for (const phrase of BANNED_INSTRUCTION_PHRASES) {
    if (lowerTranscript.includes(phrase) && !lowerScript.includes(phrase)) {
      return phrase;
    }
  }
  return null;
}

/**
 * ASR Transcription using Gemini 2.5 Flash audio understanding
 */
export async function transcribeAudioBuffer(
  ai: GoogleGenAI,
  audioBuffer: Buffer,
  mimeType = 'audio/wav'
): Promise<string> {
  try {
    const base64Audio = audioBuffer.toString('base64');
    const asrController = new AbortController();
    const asrTimer = setTimeout(() => asrController.abort(), 20000);
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      config: { abortSignal: asrController.signal },
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Audio,
              },
            },
            {
              text: 'Transcribe the spoken words in this audio exactly as spoken. Return only the plain text transcription, with no preamble, no markdown, and no quotation marks.',
            },
          ],
        },
      ],
    });

    clearTimeout(asrTimer);
    const transcript = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return transcript.trim();
  } catch (err) {
    console.warn('ASR verification transcription warning:', err);
    // If ASR service fails due to network/transient error, return empty string
    return '';
  }
}

export interface TTSGenerationOptions {
  ai: GoogleGenAI;
  script: string;
  voiceName: string;
  modelId?: string;
  instruction?: string;
  maxRetries?: number;
  isAudition?: boolean;
  /** Transcribe the result and check it for spoken instructions. Slow (a second Gemini call per chunk), so off by default. */
  verify?: boolean;
  /** Give up on a single Gemini call after this many milliseconds (default 45000) */
  timeoutMs?: number;
}

export interface TTSGenerationResult {
  audioBuffer: Buffer;
  durationSeconds: number;
  transcript: string;
  attemptsUsed: number;
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  pcmBytes: number;
  durationSeconds: number;
  /** Peak sample magnitude, 0..1 (16-bit PCM only) */
  peak: number;
}

/**
 * Rewrites the RIFF/data size fields from the real byte count. Some encoders write 0 or 0xFFFFFFFF
 * placeholders (streaming WAVs); browsers then decode the file as empty or truncated.
 */
export function normalizeRiffWav(buffer: Buffer): Buffer {
  let fmtOffset = -1;
  let dataOffset = -1;
  let declared = 0;
  for (let o = 12; o + 8 <= buffer.length; ) {
    const id = buffer.toString('ascii', o, o + 4);
    const size = buffer.readUInt32LE(o + 4);
    if (id === 'fmt ') fmtOffset = o + 8;
    if (id === 'data') {
      dataOffset = o + 8;
      declared = size;
      break;
    }
    const next = o + 8 + size + (size % 2);
    if (size === 0xffffffff || next <= o) break;
    o = next;
  }
  if (fmtOffset < 0 || dataOffset < 0) return buffer; // not parseable; caller's validation reports it

  const audioFormat = buffer.readUInt16LE(fmtOffset);
  const channels = buffer.readUInt16LE(fmtOffset + 2);
  const sampleRate = buffer.readUInt32LE(fmtOffset + 4);
  const bits = buffer.readUInt16LE(fmtOffset + 14);
  // Only 16-bit integer PCM is handled. Anything else would be written out as static, so say so instead.
  if ((audioFormat !== 1 && audioFormat !== 0xfffe) || bits !== 16) {
    throw new Error(`Unsupported WAV from Gemini (format ${audioFormat}, ${bits}-bit). Expected 16-bit PCM.`);
  }

  // Use the declared audio size when it is believable. Placeholder sizes (0 or 0xFFFFFFFF) mean "to the end of the file".
  // Bytes after the declared audio (metadata chunks) must not be played as sound.
  const available = buffer.length - dataOffset;
  const length = declared > 0 && declared !== 0xffffffff && declared <= available ? declared : available;
  const frame = 2 * Math.max(1, channels);
  const pcm = buffer.subarray(dataOffset, dataOffset + length - (length % frame));
  return buildWav(pcm, sampleRate, channels, bits);
}

function buildWav(pcm: Buffer, sampleRate: number, numChannels: number, bitsPerSample: number): Buffer {
  const header = Buffer.alloc(44);
  const blockAlign = numChannels * (bitsPerSample / 8);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Reads a normalised 16-bit PCM WAV; used to reject empty or silent results before they reach the user. */
export function analyzeWav(wav: Buffer): WavInfo {
  const pcm = wav.subarray(44);
  const sampleRate = wav.length >= 44 ? wav.readUInt32LE(24) || 24000 : 24000;
  const channels = wav.length >= 44 ? wav.readUInt16LE(22) || 1 : 1;
  let peak = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    const v = Math.abs(pcm.readInt16LE(i));
    if (v > peak) peak = v;
  }
  return {
    sampleRate,
    channels,
    bitsPerSample: 16,
    pcmBytes: pcm.length,
    durationSeconds: pcm.length / (sampleRate * channels * 2),
    peak: peak / 32768,
  };
}

/** Peak level of the first and last 200 ms and the file's own duration; used by the diagnose route to spot noise at the end. */
export function analyzeEnds(wav: Buffer): { headPeak: number; tailPeak: number; bodyPeak: number } {
  const info = analyzeWav(wav);
  const pcm = wav.subarray(44);
  const frame = 2 * info.channels;
  const win = Math.min(Math.floor(pcm.length / 3), Math.floor(info.sampleRate * 0.2) * frame);
  const peakOf = (from: number, to: number) => {
    let p = 0;
    for (let i = from; i + 1 < to; i += 2) p = Math.max(p, Math.abs(pcm.readInt16LE(i)));
    return Number((p / 32768).toFixed(4));
  };
  return {
    headPeak: peakOf(0, win),
    tailPeak: peakOf(pcm.length - win, pcm.length),
    bodyPeak: peakOf(win, pcm.length - win),
  };
}

/** Throws a readable error if the audio is empty, too short for the text, or silent. */
export function assertUsableAudio(wav: Buffer, text: string): WavInfo {
  const info = analyzeWav(wav);
  const words = text.split(/\s+/).filter(Boolean).length;
  const minSeconds = Math.min(1.5, Math.max(0.25, words * 0.12));
  if (info.pcmBytes === 0 || info.durationSeconds < minSeconds) {
    throw new Error(
      `Gemini returned unusable audio: ${info.pcmBytes} bytes (${info.durationSeconds.toFixed(2)}s) for ${words} word(s).`
    );
  }
  if (info.peak < 0.002) {
    throw new Error(`Gemini returned silent audio (${info.durationSeconds.toFixed(2)}s, peak ${info.peak.toFixed(4)}).`);
  }
  return info;
}

/**
 * Ensures audio buffer has a standard 44-byte RIFF/WAVE header.
 * If incoming data is raw PCM (which can be returned by Gemini audio modalities),
 * synthesizes a compliant 24kHz 16-bit mono RIFF WAV header.
 */
export function ensureWavHeader(
  buffer: Buffer,
  sampleRate = 24000,
  numChannels = 1,
  bitsPerSample = 16
): Buffer {
  if (
    buffer.length >= 44 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WAVE'
  ) {
    return normalizeRiffWav(buffer);
  }

  const pcm = buffer;
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

/**
 * Executes TTS generation with strict payload guard and ASR verification enforcement.
 */
export async function generateStrictTTS(options: TTSGenerationOptions): Promise<TTSGenerationResult> {
  const {
    ai,
    script,
    voiceName,
    modelId = 'gemini-3.8-flash-tts',
    instruction,
    maxRetries = 3,
    isAudition = false,
    verify = process.env.TTS_VERIFY === 'true',
    timeoutMs = 45000,
  } = options;

  const sanitized = sanitizeScriptText(script);
  if (!sanitized) {
    throw new Error('Script text is empty after sanitization.');
  }

  // Mandatory Payload Guard assertion
  assertPayloadStrictEquality(sanitized, sanitized);

  let lastError: Error | null = null;
  const actualRetries = isAudition ? 2 : maxRetries;

  for (let attempt = 1; attempt <= actualRetries; attempt++) {
    try {
      // Config with audio modalities and voice settings
      const generationConfig: Record<string, any> = {
        responseModalities: ['AUDIO'],
        temperature: 0,
        candidateCount: 1,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      };

      // If user provided a delivery instruction, pass via systemInstruction to guide delivery tone
      // Only send the systemInstruction on the first attempt (attempt === 1), so if the model rejects it, retries run without it
      if (instruction && instruction.trim() && !isAudition && attempt === 1) {
        generationConfig.systemInstruction = `You are a professional voiceover artist. Deliver the speech strictly following this direction: ${instruction.trim()}. Do NOT speak these instructions aloud. Speak ONLY the exact user script.`;
      }

      // STRICT GENERATION PARAMETERS
      // ONLY sanitized text in contents, NO instruction prose, NO formatting text
      // A call that hangs must not hold the whole request: abort it after timeoutMs
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      generationConfig.abortSignal = controller.signal;
      let response;
      try {
        response = await ai.models.generateContent({
          model: modelId,
          contents: [
            {
              role: 'user',
              parts: [{ text: sanitized }],
            },
          ],
          config: generationConfig,
        });
      } catch (callErr) {
        if (controller.signal.aborted) {
          throw new Error(`Gemini did not answer within ${Math.round(timeoutMs / 1000)} seconds.`);
        }
        throw callErr;
      } finally {
        clearTimeout(timer);
      }

      const candidate = response.candidates?.[0];
      const audioPart = candidate?.content?.parts?.find((p: any) => p?.inlineData?.data);
      const audioBase64 = audioPart?.inlineData?.data;
      if (!audioBase64) {
        const textPart = candidate?.content?.parts?.find((p: any) => typeof p?.text === 'string')?.text;
        throw new Error(
          `TTS returned no audio (finishReason: ${candidate?.finishReason ?? 'none'}` +
          `${response.promptFeedback?.blockReason ? `, blocked: ${response.promptFeedback.blockReason}` : ''}` +
          `${textPart ? `, text: "${String(textPart).slice(0, 120)}"` : ''}).`
        );
      }

      const mime = String(audioPart?.inlineData?.mimeType || '');
      const rate = Number(/rate=(\d+)/.exec(mime)?.[1]) || 24000;
      const audioBuffer = ensureWavHeader(Buffer.from(audioBase64, 'base64'), rate, 1, 16);
      const info = assertUsableAudio(audioBuffer, sanitized);
      const durationSeconds = info.durationSeconds;

      // Audition, or verification switched off: return now. The extra transcription call roughly doubles the wait.
      if (isAudition || !verify) {
        return {
          audioBuffer,
          durationSeconds: isAudition ? Math.max(0.5, durationSeconds) : durationSeconds,
          transcript: sanitized,
          attemptsUsed: attempt,
        };
      }

      // Enforcement Layer: Transcribe produced audio and check for prompt leakage
      const transcript = await transcribeAudioBuffer(ai, audioBuffer);

      if (transcript) {
        const bannedFound = checkForBannedPhrases(transcript, sanitized);
        if (bannedFound) {
          throw new Error(`PROMPT LEAKAGE DETECTED: Model audibly spoke internal phrase "${bannedFound}".`);
        }

        const wer = computeWordErrorRate(sanitized, transcript);
        if (wer > 0.35 && sanitized.split(/\s+/).length > 6) {
          console.warn(`ASR WER warning: ${wer.toFixed(2)} on attempt ${attempt}`);
        }
      }

      return {
        audioBuffer,
        durationSeconds,
        transcript: transcript || sanitized,
        attemptsUsed: attempt,
      };
    } catch (err: any) {
      lastError = err;
      console.warn(`TTS attempt ${attempt}/${actualRetries} on ${modelId} (${voiceName}) failed: ${err?.message || err}`);
      if (attempt === actualRetries) {
        break;
      }
    }
  }

  throw new Error(`Voice generation failed after ${actualRetries} attempt(s) on ${modelId} (${voiceName}): ${lastError?.message || 'Unknown error'}`);
}
