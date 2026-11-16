/**
 * Tells whether a stretch that should hold only background noise really does.
 * Raw frame loudness is a poor test: a room's low rumble (air handling, a desk, breathing near the mic) wanders by several dB
 * and dominates the energy, and any single frame can sit above the middle by chance. So the test looks only above the rumble,
 * averages over about a tenth of a second, and asks how far the loudest moment stands above the typical one.
 */

const POW = (db: number) => Math.pow(10, db / 10);

/** Removes everything below `hz` (two one-pole passes, about 12 dB per octave) */
export const highPass = (x: Float32Array, sampleRate: number, hz = 150): Float32Array => {
  const rc = 1 / (2 * Math.PI * hz), dt = 1 / sampleRate, a = rc / (rc + dt);
  const out = new Float32Array(x.length);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? x : out;
    let prevIn = 0, prevOut = 0;
    for (let i = 0; i < x.length; i++) { const v = src[i]; const y = a * (prevOut + v - prevIn); prevIn = v; prevOut = y; out[i] = y; }
  }
  return out;
};

export interface EventSpread { spreadDb: number; maxDb: number; medianDb: number }

/** Loudest averaged moment minus the middle one, from per-frame levels in dB. `span` is how many frames make one moment. */
export const eventSpread = (levelsDb: number[], span: number): EventSpread => {
  if (levelsDb.length === 0) return { spreadDb: 0, maxDb: -120, medianDb: -120 };
  const k = Math.max(1, Math.min(span, levelsDb.length));
  const smooth: number[] = [];
  let sum = 0;
  for (let i = 0; i < levelsDb.length; i++) {
    sum += POW(levelsDb[i]);
    if (i >= k) sum -= POW(levelsDb[i - k]);
    if (i >= k - 1) smooth.push(10 * Math.log10(sum / k + 1e-15));
  }
  const sorted = [...smooth].sort((a, b) => a - b);
  const medianDb = sorted[Math.floor(sorted.length / 2)];
  const maxDb = sorted[sorted.length - 1];
  return { spreadDb: maxDb - medianDb, maxDb, medianDb };
};

/** Above this, a "noise only" stretch has something loud in it */
export const LOUD_SPREAD_DB = 8;
