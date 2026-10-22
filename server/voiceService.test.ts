import { describe, it, expect } from 'vitest';
import {
  sanitizeScriptText,
  parseScriptAndInstruction,
  unwrapQuotes,
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

  it('strictly parses [Script] and [Instruction] inputs without prompt leakage', () => {
    // Standard format specified by user
    const formattedInput = `### [Script]: "The actual text you must speak."
### [Instruction]: "Directives on HOW to speak it (e.g., tone, emotion, pace, accent)."`;

    const parsed = parseScriptAndInstruction(formattedInput);
    expect(parsed.cleanScript).toBe('The actual text you must speak.');
    expect(parsed.directorNotes).toBe('Directives on HOW to speak it (e.g., tone, emotion, pace, accent).');

    // Banned phrases check: clean script must NOT contain instruction directives
    expect(checkForBannedPhrases(parsed.cleanScript, 'The actual text you must speak.')).toBeNull();
    expect(parsed.cleanScript.toLowerCase()).not.toContain('instruction');
    expect(parsed.cleanScript.toLowerCase()).not.toContain('directives');

    // Reverse order: [Instruction] first, then [Script]
    const reversed = `### [Instruction]: "Warm, calm, British accent, slow measured pace"
### [Script]: "Welcome to the evening broadcast."`;
    const parsedReversed = parseScriptAndInstruction(reversed);
    expect(parsedReversed.cleanScript).toBe('Welcome to the evening broadcast.');
    expect(parsedReversed.directorNotes).toBe('Warm, calm, British accent, slow measured pace');

    // Plain script with explicit instruction argument
    const plainScript = 'Live from the newsroom, this is the top of the hour.';
    const explicitNotes = 'Authoritative news anchor delivery';
    const parsedPlain = parseScriptAndInstruction(plainScript, explicitNotes);
    expect(parsedPlain.cleanScript).toBe(plainScript);
    expect(parsedPlain.directorNotes).toBe(explicitNotes);

    // Unwrapping quotes
    expect(unwrapQuotes('"Quoted script"')).toBe('Quoted script');
    expect(unwrapQuotes("'Single quoted script'")).toBe('Single quoted script');
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

function sineWav(seconds = 1, sampleRate = 24000): { wav: Buffer; pcm: Buffer } {
  const n = Math.floor(seconds * sampleRate);
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / sampleRate)), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return { wav: Buffer.concat([h, pcm]), pcm };
}

describe('WAV handling for Gemini audio', () => {
  it('wraps headerless PCM in a valid header', () => {
    const { pcm } = sineWav();
    const wav = ensureWavHeader(pcm);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(analyzeWav(wav).pcmBytes).toBe(pcm.length);
  });

  it('repairs placeholder sizes (0 and 0xFFFFFFFF)', () => {
    const { wav, pcm } = sineWav();
    const bad = Buffer.from(wav);
    bad.writeUInt32LE(0xffffffff, 4);
    bad.writeUInt32LE(0xffffffff, 40);
    expect(analyzeWav(ensureWavHeader(bad)).pcmBytes).toBe(pcm.length);
    bad.writeUInt32LE(0, 40);
    expect(analyzeWav(ensureWavHeader(bad)).pcmBytes).toBe(pcm.length);
  });

  it('does not play metadata after the audio as sound', () => {
    const { wav, pcm } = sineWav();
    const trailer = Buffer.concat([Buffer.from('LIST'), Buffer.from([20, 0, 0, 0]), Buffer.alloc(20, 0x7f)]);
    expect(analyzeWav(ensureWavHeader(Buffer.concat([wav, trailer]))).pcmBytes).toBe(pcm.length);
  });

  it('refuses formats it cannot read instead of producing static', () => {
    const { wav } = sineWav();
    const floatWav = Buffer.from(wav);
    floatWav.writeUInt16LE(3, 20); // IEEE float
    floatWav.writeUInt16LE(32, 34);
    expect(() => ensureWavHeader(floatWav)).toThrow(/Unsupported WAV/);
  });

  it('rejects empty and silent audio', () => {
    expect(() => assertUsableAudio(ensureWavHeader(Buffer.alloc(0)), 'hello there friend')).toThrow(/unusable/);
    expect(() => assertUsableAudio(ensureWavHeader(Buffer.alloc(48000)), 'hello there friend')).toThrow(/silent/);
  });
});
