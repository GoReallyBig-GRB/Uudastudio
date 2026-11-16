import { describe, expect, it } from 'vitest';
import { SAMPLE_SCRIPT } from './sampleScript';
import { AUDITION_SAMPLE_SENTENCE } from '../../server/voiceService';

describe('the sample script', () => {
  it('is the same sentence in the panel, in the browser audition and on the server', () => {
    expect(SAMPLE_SCRIPT).toBe('Welcome to Uuda Studio. Your high-precision AI voice functionality is ready.');
    expect(AUDITION_SAMPLE_SENTENCE).toBe(SAMPLE_SCRIPT);
  });
});
