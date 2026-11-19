/** Turns a few seconds of microphone loudness readings into a plain-language verdict. Levels are in dB below full scale (0 is the loudest possible). */
export interface Frame { rmsDb: number; peakDb: number }
export type LevelVerdict = 'silent' | 'no-speech' | 'too-quiet' | 'good' | 'too-loud' | 'clipping';
export type RoomNoise = 'quiet' | 'fine' | 'noisy';
export interface MicResult { verdict: LevelVerdict; room: RoomNoise; speechDb: number; noiseDb: number; peakDb: number; messages: string[] }

export const toDb = (x: number): number => (x > 1e-6 ? 20 * Math.log10(x) : -120);

/** Loudness of one block of samples */
export function frameOf(samples: ArrayLike<number>): Frame {
  let sum = 0, peak = 0;
  for (let i = 0; i < samples.length; i++) { const v = samples[i]; sum += v * v; peak = Math.max(peak, Math.abs(v)); }
  return { rmsDb: toDb(Math.sqrt(sum / Math.max(1, samples.length))), peakDb: toDb(peak) };
}

const percentile = (xs: number[], p: number): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; };

export const MESSAGES: Record<LevelVerdict, string> = {
  silent: 'We cannot hear anything. Check that the cable is plugged in, the microphone is not muted, and the right input is chosen.',
  'no-speech': 'We did not hear you speak. Say your name clearly while the test runs.',
  'too-quiet': 'Too quiet. Move closer to the microphone or turn the gain up.',
  good: 'Good level.',
  'too-loud': 'Too loud. Move back a little or turn the gain down.',
  clipping: 'Your voice is distorting (clipping). Turn the gain down until the loudest parts stay out of the red.',
};
export const NOISE_MESSAGES: Record<RoomNoise, string | null> = {
  quiet: null,
  fine: null,
  noisy: 'There is a lot of background noise. Try a quieter room, sit closer to the microphone, and switch off fans.',
};

export function analyseFrames(frames: ReadonlyArray<Frame>): MicResult {
  if (frames.length === 0) return { verdict: 'silent', room: 'quiet', speechDb: -120, noiseDb: -120, peakDb: -120, messages: [MESSAGES.silent] };
  const speechDb = percentile(frames.map((f) => f.rmsDb), 0.9);
  const noiseDb = percentile(frames.map((f) => f.rmsDb), 0.1);
  const peakDb = Math.max(...frames.map((f) => f.peakDb));
  const snr = speechDb - noiseDb;
  let verdict: LevelVerdict;
  if (speechDb < -55) verdict = 'silent';
  else if (snr < 6 && speechDb < -40) verdict = 'no-speech';
  else if (peakDb >= -1) verdict = 'clipping';
  else if (speechDb < -32) verdict = 'too-quiet';
  else if (speechDb > -12) verdict = 'too-loud';
  else verdict = 'good';
  const room: RoomNoise = verdict === 'silent' || verdict === 'no-speech' ? 'quiet' : snr >= 35 ? 'quiet' : snr >= 22 ? 'fine' : 'noisy';
  const messages = [MESSAGES[verdict]];
  const n = NOISE_MESSAGES[room];
  if (n) messages.push(n);
  return { verdict, room, speechDb, noiseDb, peakDb, messages };
}
