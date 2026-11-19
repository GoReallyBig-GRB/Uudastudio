import { isMixerGear, type Gear } from './setupPlan';

/** The test sound for the echo-loop check: a short rising sweep. If it comes back into the microphone input, the output is feeding the input. */
export const CHIRP = { startHz: 500, endHz: 2500, seconds: 0.5, level: 0.12 };

export function makeChirp(sampleRate: number): Float32Array {
  const n = Math.round(sampleRate * CHIRP.seconds);
  const out = new Float32Array(n);
  const k = (CHIRP.endHz - CHIRP.startHz) / CHIRP.seconds;
  const fade = Math.round(sampleRate * 0.01);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const edge = Math.min(1, i / fade, (n - 1 - i) / fade);
    out[i] = Math.sin(2 * Math.PI * (CHIRP.startHz * t + 0.5 * k * t * t)) * CHIRP.level * edge;
  }
  return out;
}

/** Averages blocks of k samples: a cheap way to shrink the search while keeping the low sweep */
export function decimate(x: ArrayLike<number>, k: number): Float32Array {
  const n = Math.floor(x.length / k);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < k; j++) s += x[i * k + j]; out[i] = s / k; }
  return out;
}

export interface ChirpHit { found: boolean; /** 0 to 1: how well the recording matches the test sound */ strength: number; /** How long after the start of the recording the sound appeared */ lagMs: number }

/** Looks for the test sound inside a recording of the input (normalised correlation) */
export function detectChirp(recorded: ArrayLike<number>, template: ArrayLike<number>, sampleRate: number, threshold = 0.35): ChirpHit {
  const k = 8;
  const r = decimate(recorded, k), t = decimate(template, k);
  if (r.length < t.length || t.length === 0) return { found: false, strength: 0, lagMs: 0 };
  let tEnergy = 0;
  for (let i = 0; i < t.length; i++) tEnergy += t[i] * t[i];
  if (tEnergy === 0) return { found: false, strength: 0, lagMs: 0 };
  let window = 0;
  for (let i = 0; i < t.length; i++) window += r[i] * r[i];
  let best = 0, bestLag = 0;
  for (let lag = 0; lag + t.length <= r.length; lag++) {
    if (lag > 0) window += r[lag + t.length - 1] * r[lag + t.length - 1] - r[lag - 1] * r[lag - 1];
    if (window < 1e-9) continue;
    let dot = 0;
    for (let i = 0; i < t.length; i++) dot += r[lag + i] * t[i];
    const c = Math.abs(dot) / Math.sqrt(window * tEnergy);
    if (c > best) { best = c; bestLag = lag; }
  }
  return { found: best >= threshold, strength: Math.min(1, best), lagMs: (bestLag * k / sampleRate) * 1000 };
}

/** What the result means, in plain words, for this equipment */
export function routeAdvice(found: boolean, gear: Gear): { tone: 'ok' | 'warn'; text: string } {
  if (!found) return { tone: 'ok', text: 'The test sound did not come back into your input, so there is no echo loop.' };
  if (isMixerGear(gear)) return { tone: 'warn', text: 'The test sound came straight back into your input: the mixer is sending Uuda\'s output back to Uuda, so guests would hear themselves. On the mixer, take the channel that Uuda\'s output is plugged into out of the aux or mix-minus send that feeds Uuda.' };
  return { tone: 'warn', text: 'The test sound is reaching your microphone through the air. Wear headphones, or turn the volume down.' };
}
