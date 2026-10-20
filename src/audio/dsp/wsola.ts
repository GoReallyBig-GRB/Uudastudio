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
function resampleChannel(input: Float32Array, ratio: number): Float32Array {
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

/**
 * Perform WSOLA time stretching on a Float32Array channel
 */
function wsolaTimeStretch(
  input: Float32Array,
  speedRatio: number,
  frameSize: number = 1024,
  synHop: number = 256
): Float32Array {
  if (!input || input.length <= frameSize || !Number.isFinite(speedRatio) || speedRatio <= 0) {
    return resampleChannel(input || new Float32Array(1024), Math.max(0.1, speedRatio || 1));
  }

  // Safe bounds
  const anaHop = Math.max(1, Math.round(synHop * speedRatio));
  const searchRange = Math.max(1, Math.round(synHop / 2));
  const outLength = Math.max(1, Math.round(input.length / speedRatio));
  const output = new Float32Array(outLength + frameSize);
  const weight = new Float32Array(outLength + frameSize);

  // Precompute Hanning window
  const window = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frameSize - 1)));
  }

  let outPos = 0;
  let inPos = 0;

  while (outPos < outLength && inPos + frameSize < input.length) {
    let bestOffset = 0;

    // Search for best correlation around nominal inPos
    if (outPos > 0) {
      let maxCorr = -Infinity;
      const targetPos = Math.max(0, outPos - synHop);

      for (let delta = -searchRange; delta <= searchRange; delta += 2) {
        const candidateIn = inPos + delta;
        if (candidateIn < 0 || candidateIn + frameSize >= input.length) continue;

        let corr = 0;
        // Sub-sampled correlation for high performance
        for (let i = 0; i < frameSize; i += 4) {
          const s1 = input[candidateIn + i];
          const s2 = output[targetPos + i];
          if (Number.isFinite(s1) && Number.isFinite(s2)) {
            corr += s1 * s2;
          }
        }

        if (corr > maxCorr) {
          maxCorr = corr;
          bestOffset = delta;
        }
      }
    }

    const actualIn = Math.max(0, Math.min(input.length - frameSize, inPos + bestOffset));

    // Overlap-add windowed frame
    for (let i = 0; i < frameSize; i++) {
      const idx = outPos + i;
      if (idx < output.length) {
        const sampleVal = input[actualIn + i] * window[i];
        if (Number.isFinite(sampleVal)) {
          output[idx] += sampleVal;
          weight[idx] += window[i];
        }
      }
    }

    outPos += synHop;
    inPos += anaHop;
  }

  // Normalize by accumulated window weights to prevent amplitude ripple
  const finalResult = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const w = weight[i];
    const val = w > 0.001 ? output[i] / w : output[i];
    finalResult[i] = Number.isFinite(val) ? val : 0;
  }

  return finalResult;
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
    stretchedChannels.push(wsolaTimeStretch(channelData, safeRatio));
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
    const stretched = wsolaTimeStretch(resampled, timeStretchSpeed);

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
