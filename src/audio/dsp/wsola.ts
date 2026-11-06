/**
 * X-PRO AUDIO - WSOLA Time-Scale Modification & Pitch Shifting
 *
 * Algorithm: Waveform Similarity Overlap-Add (WSOLA)
 * Reference: Verhelst, W., & Roelands, M. (1993). "An overlap-add technique based on
 * waveform similarity (WSOLA) for high quality time-scale modification of speech."
 * IEEE Transactions on Speech and Audio Processing, 1(2), 209-218.
 * Licence: MIT-compatible open mathematical implementation.
 */

/**
 * Resample a channel Float32Array by an arbitrary ratio using cubic Hermite interpolation
 */
export function resampleChannel(input: Float32Array, ratio: number): Float32Array {
  if (!input || input.length === 0 || !Number.isFinite(ratio) || ratio <= 0) {
    return new Float32Array(Math.max(1, input?.length || 1));
  }
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outLength);
  const maxIdx = input.length - 1;

  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio;
    const srcIndex = Math.floor(srcPos);
    const frac = srcPos - srcIndex;

    const p0 = input[Math.max(0, Math.min(maxIdx, srcIndex - 1))];
    const p1 = input[Math.max(0, Math.min(maxIdx, srcIndex))];
    const p2 = input[Math.max(0, Math.min(maxIdx, srcIndex + 1))];
    const p3 = input[Math.max(0, Math.min(maxIdx, srcIndex + 2))];

    // Cubic Hermite interpolation
    const c0 = p1;
    const c1 = 0.5 * (p2 - p0);
    const c2 = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
    const c3 = 0.5 * (p3 - p0) + 1.5 * (p1 - p2);

    const val = ((c3 * frac + c2) * frac + c1) * frac + c0;
    output[i] = Number.isFinite(val) ? val : 0;
  }

  return output;
}

/** Frame length, step between frames (the output hop) and how far each frame may slide to find its best match, in samples */
export interface StretchParams {
  frame: number;
  hop: number;
  search: number;
}

const at48k = (samples: number, sampleRate: number) => Math.max(1, Math.round((samples * sampleRate) / 48000));

/** Speed changes: about 43 ms frames, which keep speech crisp, with room to slide by about 10 ms to find the matching waveform. */
export const speedStretchParams = (sampleRate = 48000): StretchParams => {
  const frame = Math.round(at48k(2048, sampleRate) / 4) * 4;
  return { frame, hop: frame / 4, search: at48k(480, sampleRate) };
};

/**
 * Pitch changes: the stretch runs on audio whose pitch has already moved by `ratio`, so the frame must hold whole periods of
 * the LOWEST pitch it can meet (a 70 Hz voice, scaled by the ratio): three periods per frame and a slide of one period, never shorter than the
 * speed-change frame. A frame that holds less than a period or two cannot tell the waveform apart and the result turns rough.
 */
export const pitchStretchParams = (ratio: number, sampleRate = 48000): StretchParams => {
  const period = sampleRate / (70 * Math.max(0.25, Math.min(4, ratio)));
  const frame = Math.round(Math.max(at48k(2048, sampleRate), 3 * period) / 4) * 4;
  return { frame, hop: frame / 4, search: Math.max(at48k(480, sampleRate), Math.round(period)) };
};

/**
 * Finds how far (in samples, within the search range) the next frame should slide so that its waveform continues the audio
 * already in the output at `targetPos`. Uses normalised correlation (loud and quiet candidates compete fairly): a coarse pass over the
 * whole range, then a fine pass around the winner. Reads the source (`inArr`, whose first element is source index `inBase`)
 * and the output built so far (`outArr`, first element is output index `outBase`) directly, for speed.
 * Only candidates made entirely of real audio (0 .. total) are considered.
 */
export const chooseOffset = (
  p: StretchParams,
  inArr: Float32Array,
  inBase: number,
  outArr: Float32Array,
  outBase: number,
  inPos: number,
  targetPos: number,
  total: number,
): number => {
  const { frame, hop, search } = p;
  // The new frame will be laid over the output from `targetPos` on. The part of the output that already holds the tails of
  // earlier frames is the first (frame - hop) samples, and that is what the new frame has to continue.
  const span = frame - hop;
  // Longer frames are compared on fewer points, so the cost per frame stays about the same
  const sub = Math.max(4, Math.round(frame / 600));
  const tBase = targetPos - outBase;
  // Two passes: a cheap sweep (wide steps, every other comparison point) finds the neighbourhood of the best match, then a
  // full-precision pass checks every shift around the winner. The match is a broad peak (about a quarter of a pitch period
  // wide), so the cheap sweep lands in it, and the fine pass picks the exact shift as before.
  const coarse = Math.max(4, Math.round(search / COARSE_STEPS));
  const subCoarse = sub * 2;
  let e2 = 0;
  for (let i = 0; i < span; i += sub) { const b = outArr[tBase + i]; e2 += b * b; }
  let e2c = 0;
  for (let i = 0; i < span; i += subCoarse) { const b = outArr[tBase + i]; e2c += b * b; }
  const score = (d: number, step: number, energy: number): number => {
    const c = inPos + d;
    if (c < 0 || c + frame > total) return -Infinity;
    const cBase = c - inBase;
    let cr = 0;
    let e1 = 0;
    for (let i = 0; i < span; i += step) {
      const a = inArr[cBase + i];
      cr += a * outArr[tBase + i];
      e1 += a * a;
    }
    return cr / Math.sqrt(e1 * energy + 1e-9);
  };
  let best = 0;
  let bestScore = -Infinity;
  for (let d = -search; d <= search; d += coarse) {
    const v = score(d, subCoarse, e2c);
    if (v > bestScore) { bestScore = v; best = d; }
  }
  const centre = best;
  bestScore = -Infinity;
  for (let d = centre - coarse; d <= centre + coarse; d++) {
    const v = score(d, sub, e2);
    if (v > bestScore) { bestScore = v; best = d; }
  }
  return bestScore === -Infinity ? 0 : best;
};

/** Candidate shifts tried in the cheap sweep across the whole search range (the old search tried about 320 of them) */
export const COARSE_STEPS = 90;

/** How many samples at each end of a stretched piece are blended back to the exact original edge samples. */
export const edgeGuardLength = (p: StretchParams): number => Math.max(32, p.frame >> 4);

/** Weight of the original edge sample at step i of k (1 at the very edge, falling to 0 at the inside end of the guard). */
export const edgeGuardWeight = (i: number, k: number): number => {
  const t = 1 - i / k;
  return 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, t)));
};

/**
 * WSOLA time stretch of one channel (speedRatio 2 = twice as fast, half as long). Every frame is made of real audio (nothing
 * is padded), the output is exactly the right length, and the first and last few milliseconds are blended back to the
 * original edge samples, so a stretched piece joins the audio on either side without a dip, a gap or a click.
 */
export function wsolaTimeStretch(
  input: Float32Array,
  speedRatio: number,
  params: StretchParams = speedStretchParams(),
): Float32Array {
  const { frame, hop } = params;
  const outLength = input ? Math.max(1, Math.round(input.length / speedRatio)) : 0;
  if (!input || input.length <= frame || outLength <= frame || !Number.isFinite(speedRatio) || speedRatio <= 0) {
    return resampleChannel(input || new Float32Array(1024), Math.max(0.1, speedRatio || 1));
  }
  const total = input.length;
  const anaHop = Math.max(1, Math.round(hop * speedRatio));
  const output = new Float32Array(outLength + frame);
  const weight = new Float32Array(outLength + frame);
  const window = new Float32Array(frame);
  for (let i = 0; i < frame; i++) window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frame - 1)));

  let outPos = 0;
  let inPos = 0;
  while (outPos < outLength) {
    // Near the end the nominal position is held at the last full frame, and the search still runs around it, so the final
    // frames stay lined up with the output instead of landing out of phase
    const nominal = Math.max(0, Math.min(inPos, total - frame));
    const offset = outPos > 0 ? chooseOffset(params, input, 0, output, 0, nominal, outPos, total) : 0;
    const actualIn = Math.max(0, Math.min(total - frame, nominal + offset));
    for (let i = 0; i < frame; i++) {
      output[outPos + i] += input[actualIn + i] * window[i];
      weight[outPos + i] += window[i];
    }
    outPos += hop;
    inPos += anaHop;
  }

  // Divide by the accumulated window weights so the level stays even
  const result = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const w = weight[i];
    const v = w > 1e-6 ? output[i] / w : input[Math.min(total - 1, Math.round(i * speedRatio))];
    result[i] = Number.isFinite(v) ? v : 0;
  }
  // Edge guard: the very first and last samples are the original ones
  const k = Math.min(edgeGuardLength(params), outLength >> 1);
  for (let i = 0; i < k; i++) {
    const wHead = edgeGuardWeight(i, k);
    result[i] = result[i] * (1 - wHead) + input[i] * wHead;
    const wTail = edgeGuardWeight(i, k);
    result[outLength - 1 - i] = result[outLength - 1 - i] * (1 - wTail) + input[total - 1 - i] * wTail;
  }
  return result;
}

/**
 * Process Time-Stretching (Change Speed while PRESERVING pitch)
 */
export async function processTimeStretch(
  inputBuffer: AudioBuffer,
  speedRatio: number
): Promise<AudioBuffer> {
  if (!inputBuffer || inputBuffer.length === 0) {
    throw new Error('Input audio buffer is empty.');
  }
  const safeRatio = Math.max(0.2, Math.min(5.0, Number.isFinite(speedRatio) ? speedRatio : 1.0));
  const numChannels = Math.max(1, Math.min(2, inputBuffer.numberOfChannels));
  const sampleRate = inputBuffer.sampleRate || 48000;

  // Process channels
  const stretchedChannels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = inputBuffer.getChannelData(ch);
    stretchedChannels.push(wsolaTimeStretch(channelData, safeRatio, speedStretchParams(sampleRate)));
  }

  const outLength = Math.max(128, stretchedChannels[0].length);
  const offlineCtx = new OfflineAudioContext(numChannels, outLength, sampleRate);
  const outputBuffer = offlineCtx.createBuffer(numChannels, outLength, sampleRate);
  for (let ch = 0; ch < numChannels; ch++) {
    outputBuffer.getChannelData(ch).set(stretchedChannels[ch]);
  }

  return outputBuffer;
}

/**
 * Process Pitch-Shifting (Change Pitch while PRESERVING duration)
 * 1. Resample by pitch ratio P = 2^(semitones / 12)
 * 2. Time-stretch by 1 / P using WSOLA to restore exact original duration
 */
export async function processPitchShift(
  inputBuffer: AudioBuffer,
  semitones: number
): Promise<AudioBuffer> {
  if (!inputBuffer || inputBuffer.length === 0) {
    throw new Error('Input audio buffer is empty.');
  }
  const safeSemitones = Math.max(-24, Math.min(24, Number.isFinite(semitones) ? semitones : 0));
  if (safeSemitones === 0) {
    return inputBuffer;
  }

  const pitchRatio = Math.pow(2, safeSemitones / 12);
  const numChannels = Math.max(1, Math.min(2, inputBuffer.numberOfChannels));
  const sampleRate = inputBuffer.sampleRate || 48000;
  const targetLength = Math.max(128, inputBuffer.length);

  const resultChannels: Float32Array[] = [];

  for (let ch = 0; ch < numChannels; ch++) {
    const origData = inputBuffer.getChannelData(ch);

    // 1. Resample by pitchRatio
    const resampled = resampleChannel(origData, pitchRatio);

    // 2. Time stretch to restore exact target length
    const timeStretchSpeed = 1 / pitchRatio;
    const stretched = wsolaTimeStretch(resampled, timeStretchSpeed, pitchStretchParams(pitchRatio, sampleRate));

    // Trim or pad to exact original sample count
    const finalChannel = new Float32Array(targetLength);
    finalChannel.set(stretched.subarray(0, Math.min(stretched.length, targetLength)));
    resultChannels.push(finalChannel);
  }

  const offlineCtx = new OfflineAudioContext(numChannels, targetLength, sampleRate);
  const outputBuffer = offlineCtx.createBuffer(numChannels, targetLength, sampleRate);
  for (let ch = 0; ch < numChannels; ch++) {
    outputBuffer.getChannelData(ch).set(resultChannels[ch]);
  }

  return outputBuffer;
}
