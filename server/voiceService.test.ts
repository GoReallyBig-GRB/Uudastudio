import { describe, it, expect } from 'vitest';
import {
  sanitizeScriptText,
  assertPayloadStrictEquality,
  computeWordErrorRate,
  checkForBannedPhrases,
  AUDITION_SAMPLE_SENTENCE,
  BANNED_INSTRUCTION_PHRASES,
  ensureWavHeader,
  normalizeRiffWav,
  analyzeWav,
  assertUsableAudio,
} from './voiceService';

describe('Voice Service - TTS Sanitization & Prompt Leakage Elimination', () => {
  it('(a) outgoing payload strictly equals the script for generation and audition', () => {
    const rawUserScript = '   Welcome to the station. This is high quality audio.  \r\n\n ';
    const sanitized = sanitizeScriptText(rawUserScript);

    // Verify sanitization
    expect(sanitized).toBe('Welcome to the station. This is high quality audio.');

    // Assert strict equality does not throw when text is identical
    expect(() => assertPayloadStrictEquality(sanitized, sanitized)).not.toThrow();

    // Assert strict equality throws if anything is prepended or appended
    expect(() =>
      assertPayloadStrictEquality(`Instruction: speak aloud: ${sanitized}`, sanitized)
    ).toThrow(/PAYLOAD GUARD FAILURE/);

    expect(() =>
      assertPayloadStrictEquality(`${sanitized} - Production format: plain natural voiceover`, sanitized)
    ).toThrow(/PAYLOAD GUARD FAILURE/);

    // Audition payload verification
    const auditionSentence = AUDITION_SAMPLE_SENTENCE;
    const sanitizedAudition = sanitizeScriptText(auditionSentence);
    expect(sanitizedAudition).toBe('Welcome to Uuda Studio. Your voiceover studio is ready.');
    expect(() => assertPayloadStrictEquality(sanitizedAudition, auditionSentence)).not.toThrow();
  });

  it('(b) computes word error rate (WER) and matches within threshold', () => {
    const original = 'This is a broadcast promo for the weekend show';
    const accurateTranscript = 'This is a broadcast promo for the weekend show';
    const slightVarTranscript = 'This is a broadcast promo for the weekend shows'; // 1 word difference out of 9
    const distortedTranscript = 'Completely different random sentences and words spoken here';

    expect(computeWordErrorRate(original, accurateTranscript)).toBe(0);

    const slightWER = computeWordErrorRate(original, slightVarTranscript);
    expect(slightWER).toBeLessThan(0.15); // Well within reasonable variance

    const highWER = computeWordErrorRate(original, distortedTranscript);
    expect(highWER).toBeGreaterThan(0.7);
  });

  it('(c) regression test: fails if any banned instruction string exists in TTS text', () => {
    const testCasesWithBannedPhrases = [
      'Production format: plain natural voiceover. Welcome to our podcast.',
      'Style: Natural, neutral, authentic conversational reading.',
      'Instruction: speak aloud only the text below.',
      'Do not speak instructions. Hello world.',
      'Do not read quotes.',
      'Do not say script.',
      'Script: Here is the morning news report.',
      'Commercial advertisement for the summer festival.',
      'Radio imaging bumper clip.',
    ];

    const cleanScript = 'Welcome to our podcast. Here is the morning news report.';

    // The clean script should have zero banned phrases detected
    expect(checkForBannedPhrases(cleanScript, cleanScript)).toBeNull();

    // Every contaminated case must trigger detection
    for (const testCase of testCasesWithBannedPhrases) {
      const detected = checkForBannedPhrases(testCase, cleanScript);
      expect(detected).not.toBeNull();
      expect(BANNED_INSTRUCTION_PHRASES).toContain(detected);
    }
  });

  it('guarantees no instruction or style prose is ever added to sanitized text', () => {
    const raw = 'The forecast calls for sunny skies across the metropolitan area.';
    const sanitized = sanitizeScriptText(raw);

    for (const banned of BANNED_INSTRUCTION_PHRASES) {
      expect(sanitized.toLowerCase()).not.toContain(banned);
    }
  });

  it('(d) analyzes and normalizes WAV headers and catches silent or empty audio', () => {
    // Generate 1 second of 24kHz 16-bit mono PCM sine wave
    const sampleRate = 24000;
    const duration = 1.0;
    const numSamples = Math.floor(sampleRate * duration);
    const pcm = Buffer.alloc(numSamples * 2);
    for (let i = 0; i < numSamples; i++) {
      const sample = Math.floor(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 16000);
      pcm.writeInt16LE(sample, i * 2);
    }

    const validWav = ensureWavHeader(pcm, sampleRate, 1, 16);
    expect(validWav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(validWav.toString('ascii', 8, 12)).toBe('WAVE');

    const info = analyzeWav(validWav);
    expect(info.sampleRate).toBe(24000);
    expect(info.channels).toBe(1);
    expect(info.durationSeconds).toBeCloseTo(1.0, 1);
    expect(info.peak).toBeGreaterThan(0.4);

    // assertUsableAudio succeeds on valid audio
    const verified = assertUsableAudio(validWav, 'Testing one two');
    expect(verified.durationSeconds).toBeCloseTo(1.0, 1);

    // Silent audio should throw
    const silentPcm = Buffer.alloc(numSamples * 2);
    const silentWav = ensureWavHeader(silentPcm, sampleRate, 1, 16);
    expect(() => assertUsableAudio(silentWav, 'Testing one two')).toThrow(/silent/);

    // Empty/too short audio should throw
    const emptyPcm = Buffer.alloc(10);
    const emptyWav = ensureWavHeader(emptyPcm, sampleRate, 1, 16);
    expect(() => assertUsableAudio(emptyWav, 'A sentence with multiple words for testing audio length')).toThrow(/unusable/);

    // normalizeRiffWav handles files with standard headers
    const normalized = normalizeRiffWav(validWav);
    expect(normalized.length).toBe(validWav.length);
  });
});
