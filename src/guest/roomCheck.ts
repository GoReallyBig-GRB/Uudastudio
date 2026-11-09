/**
 * Looks at a short test recording (or the first seconds of a real take) and says, in plain words, whether the microphone
 * setup is good enough: level, noise, clipping, a noise during the quiet start, boomy low end, and phone-call-quality mics.
 * Pure and unit-tested; the thresholds were set by running it on four real phone and USB-mic recordings.
 */

export const FRAME_SECONDS = 0.05;

export interface RoomMetrics {
  /** Seconds of quiet before the first words (0 if speech started at once) */
  leadInSeconds: number;
  /** Typical level of the quiet start, dBFS (frame RMS) */
  noiseDb: number;
  /** Loudest frame in the quiet start, dBFS */
  noiseMaxDb: number;
  /** Level of the speech (90th percentile frame), dBFS */
  speechDb: number;
  /** Speech minus noise, dB */
  snrDb: number;
  peakDb: number;
  clippedSamples: number;
  /** Share of speech energy between 80 and 300 Hz, 0..1 */
  lowShare: number;
  sampleRate: number;
  durationSeconds: number;
}

export type Level = 'ok' | 'warn' | 'problem';
export interface Finding { id: string; level: Level; text: string }
export interface RoomReport { metrics: RoomMetrics | null; findings: Finding[]; /** Worst level among the findings */ overall: Level }

const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))))];

/** In-place radix-2 FFT */
const fft = (re: Float64Array, im: Float64Array) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
};

/** Share of energy in 80 to 300 Hz over a stretch of audio (Hann windows of 4096 samples, stepping by half) */
const lowShareOf = (x: Float32Array, from: number, sampleRate: number): number => {
  const N = 4096;
  if (x.length - from < N) return 0;
  const re = new Float64Array(N), im = new Float64Array(N);
  let low = 0, all = 0;
  const lo = Math.ceil((80 * N) / sampleRate), hi = Math.floor((300 * N) / sampleRate), top = Math.floor((sampleRate / 2) * N / sampleRate);
  for (let s = from; s + N <= x.length; s += N / 2) {
    for (let i = 0; i < N; i++) { re[i] = x[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))); im[i] = 0; }
    fft(re, im);
    for (let k = 1; k < top; k++) { const p = re[k] * re[k] + im[k] * im[k]; all += p; if (k >= lo && k <= hi) low += p; }
  }
  return all > 0 ? low / all : 0;
};

/** Measures a mono recording that starts with a quiet stretch and then has speech. Returns null if there is no speech at all. */
export const measure = (x: Float32Array, sampleRate: number): RoomMetrics | null => {
  const n = Math.max(1, Math.round(FRAME_SECONDS * sampleRate));
  const frames = Math.floor(x.length / n);
  if (frames < 20) return null;
  const level: number[] = new Array(frames);
  let peak = 0, clipped = 0;
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * n; i < (f + 1) * n; i++) { const v = x[i]; s += v * v; const a = Math.abs(v); if (a > peak) peak = a; if (a > 0.99) clipped++; }
    level[f] = db(Math.sqrt(s / n));
  }
  const sorted = [...level].sort((a, b) => a - b);
  const floorGuess = pct(sorted, 10);
  // The first frame where speech starts: loud for 150 ms and still going (at least 0.4 s of the next second), so a cough or a bump does not count
  const thr = floorGuess + 18;
  let onset = -1;
  for (let f = 0; f + 2 < frames; f++) {
    if (!(level[f] > thr && level[f + 1] > thr && level[f + 2] > thr)) continue;
    let loud = 0;
    for (let k = f; k < Math.min(frames, f + 20); k++) if (level[k] > thr) loud++;
    if (loud >= Math.min(8, frames - f)) { onset = f; break; }
  }
  if (onset < 0) return null;
  // Leave out the last 0.6 s before the words: a breath or a lip smack there is the talent, not the room
  const rawLead = level.slice(0, onset);
  const lead = rawLead.length - 12 >= 10 ? rawLead.slice(0, rawLead.length - 12) : rawLead;
  const leadSorted = [...lead].sort((a, b) => a - b);
  const noiseDb = lead.length ? pct(leadSorted, 50) : floorGuess;
  const noiseMaxDb = lead.length ? leadSorted[leadSorted.length - 1] : floorGuess;
  const after = level.slice(onset).sort((a, b) => a - b);
  const speechDb = pct(after, 90);
  return {
    leadInSeconds: onset * FRAME_SECONDS, noiseDb, noiseMaxDb, speechDb, snrDb: speechDb - noiseDb, peakDb: db(peak), clippedSamples: clipped,
    lowShare: lowShareOf(x, onset * n, sampleRate), sampleRate, durationSeconds: x.length / sampleRate,
  };
};

const rank: Record<Level, number> = { ok: 0, warn: 1, problem: 2 };

/** Turns measurements into advice a person can act on */
export const assess = (m: RoomMetrics | null): RoomReport => {
  if (!m) return { metrics: null, findings: [{ id: 'nothing', level: 'problem', text: 'No speech was heard. Check that the right microphone is chosen, then stay quiet for a few seconds and read the first line of the script.' }], overall: 'problem' };
  const f: Finding[] = [];
  if (m.sampleRate <= 24000) f.push({ id: 'narrow', level: 'problem', text: 'This microphone records at phone-call quality (a Bluetooth headset does this). Use the phone or computer microphone, or a wired or USB mic.' });
  if (m.leadInSeconds < 1) f.push({ id: 'lead', level: 'warn', text: 'There was no quiet moment before you spoke. Stay silent for about 3 seconds first so the room can be measured.' });
  if (m.leadInSeconds >= 1 && m.noiseMaxDb - m.noiseDb >= 10) f.push({ id: 'event', level: 'warn', text: 'Something made a noise during the quiet part (a cough, a bump, a car). Try again and keep still and silent.' });
  if (m.clippedSamples >= 3 || m.peakDb > -1) f.push({ id: 'loud', level: m.clippedSamples >= 3 ? 'problem' : 'warn', text: m.clippedSamples >= 3 ? 'The sound is clipping (too loud, and the damage cannot be repaired). Move back from the microphone or turn its gain down.' : 'The loudest sounds reach the limit. Move a little further from the microphone or lower its gain.' });
  // A quiet voice is only a fault when the room noise is close behind it. A clean quiet take is fine: the producer raises the level
  // and nothing is lost, and a mic with its auto-gain off always records lower than a phone's own recorder app.
  if (m.speechDb < -36 && m.snrDb < 28) f.push({ id: 'quiet', level: 'problem', text: 'Your voice is quiet and the room is close behind it. Move closer to the microphone (a hand-width away) or turn its input level up in the device settings.' });
  else if (m.speechDb < -42) f.push({ id: 'quiet', level: 'warn', text: 'Your voice is quiet. The recording is clean, so the producer can raise it, but a hand-width closer to the microphone is still better.' });
  if (m.snrDb < 24) f.push({ id: 'noise', level: 'problem', text: 'There is a lot of background noise compared with your voice. Close windows and doors, switch off fans and screens, or move to a smaller, softer room.' });
  else if (m.snrDb < 30) f.push({ id: 'noise', level: 'warn', text: 'Some background noise is audible. A quieter spot or a closer microphone will give a cleaner take.' });
  if (m.lowShare > 0.58) f.push({ id: 'boomy', level: 'warn', text: 'The sound is heavy in the low end (boomy). Speak across the microphone instead of straight into it, or move a few centimetres back.' });
  if (f.length === 0) f.push({ id: 'good', level: 'ok', text: 'Your setup sounds good. Level, noise and room are fine for recording.' });
  return { metrics: m, findings: f, overall: f.reduce<Level>((w, x) => (rank[x.level] > rank[w] ? x.level : w), 'ok') };
};

export const checkRoom = (x: Float32Array, sampleRate: number): RoomReport => assess(measure(x, sampleRate));
