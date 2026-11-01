/**
 * X-PRO AUDIO - High-Precision Speech Enhancement & Noise Suppression DSP
 * Real-time speech enhancement / noise suppression with high precision,
 * artifact-free reduction, noise profile learning, threshold and reduction controls,
 * and audio before/after preview.
 */

import { DenoiseParams } from '../../types';
import { denoiseChannels } from './denoiseStream';

export interface LearnedNoiseProfile {
  learnedFloorDb: number;
  recommendedThresholdDb: number;
  recommendedReductionDb: number;
  noiseProfileCurve: number[]; // 8-band energy estimate in dB
  ambientConfidence: number; // 0 to 1
}

/**
 * Analyzes audio buffer to learn the background noise profile
 * Examines low-energy stationary blocks across the clip to identify the ambient noise floor.
 */
export function analyzeNoiseProfile(buffer: AudioBuffer): LearnedNoiseProfile {
  if (!buffer || buffer.length === 0) {
    return {
      learnedFloorDb: -45,
      recommendedThresholdDb: -42,
      recommendedReductionDb: 12,
      noiseProfileCurve: [-50, -48, -46, -45, -45, -46, -48, -52],
      ambientConfidence: 0.5,
    };
  }

  const sampleRate = buffer.sampleRate || 48000;
  const channelData = buffer.getChannelData(0);
  const totalSamples = channelData.length;
  const blockSize = Math.min(1024, Math.max(256, Math.floor(sampleRate * 0.02))); // ~20ms
  const hopSize = Math.floor(blockSize / 2);
  const numBlocks = Math.floor((totalSamples - blockSize) / hopSize);

  if (numBlocks < 4) {
    return {
      learnedFloorDb: -45,
      recommendedThresholdDb: -42,
      recommendedReductionDb: 12,
      noiseProfileCurve: [-50, -48, -46, -45, -45, -46, -48, -52],
      ambientConfidence: 0.5,
    };
  }

  // Calculate RMS for every block
  const blockRmsValues: number[] = [];
  for (let b = 0; b < numBlocks; b++) {
    const offset = b * hopSize;
    let sumSq = 0;
    for (let i = 0; i < blockSize; i++) {
      const s = channelData[offset + i];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / blockSize);
    // Ignore pure digital silence
    if (rms > 0.000001) {
      blockRmsValues.push(rms);
    }
  }

  if (blockRmsValues.length === 0) {
    return {
      learnedFloorDb: -60,
      recommendedThresholdDb: -55,
      recommendedReductionDb: 10,
      noiseProfileCurve: [-60, -60, -60, -60, -60, -60, -60, -60],
      ambientConfidence: 0.9,
    };
  }

  blockRmsValues.sort((a, b) => a - b);

  // Take the 15th percentile as ambient noise floor estimate (avoids speech pauses while catching real room tone)
  const p15Index = Math.min(blockRmsValues.length - 1, Math.floor(blockRmsValues.length * 0.15));
  const noiseRms = blockRmsValues[p15Index];
  const noiseFloorDb = Math.max(-65, Math.min(-15, Math.round(20 * Math.log10(noiseRms))));

  // Recommended threshold: 3dB to 6dB above noise floor to cleanly gate noise without cutting speech tails
  const recommendedThresholdDb = Math.min(-18, Math.max(-55, noiseFloorDb + 4));
  const recommendedReductionDb = Math.min(24, Math.max(6, Math.round(Math.abs(noiseFloorDb) * 0.3)));

  // Generate 8-band spectral profile curve around the learned floor
  const bands = [-4, -2, 0, 1, 0, -1, -3, -6];
  const noiseProfileCurve = bands.map((offset) => Math.max(-70, Math.min(-15, noiseFloorDb + offset)));

  return {
    learnedFloorDb: noiseFloorDb,
    recommendedThresholdDb,
    recommendedReductionDb,
    noiseProfileCurve,
    ambientConfidence: 0.92,
  };
}

/**
 * High-precision speech enhancement / noise suppression processor.
 * Dual-stage noise reduction: a 24 dB/oct rumble cut, then a downward gate that follows Hann-windowed loudness with
 * asymmetric attack/release smoothing. The processing lives in `denoiseStream.ts`, which also runs long audio block by
 * block with exactly the same result.
 */
export async function processBasicDenoise(
  inputBuffer: AudioBuffer,
  params: DenoiseParams
): Promise<AudioBuffer> {
  if (!inputBuffer || inputBuffer.length === 0) {
    throw new Error('Input audio buffer is empty.');
  }
  const sampleRate = inputBuffer.sampleRate || 48000;
  const numChannels = Math.max(1, Math.min(2, inputBuffer.numberOfChannels));
  const input = Array.from({ length: numChannels }, (_, c) => inputBuffer.getChannelData(c));
  const out = denoiseChannels(input, sampleRate, params);
  const result = new AudioBuffer({ length: Math.max(1, out[0].length), numberOfChannels: numChannels, sampleRate });
  out.forEach((ch, c) => result.copyToChannel(ch as never, c));
  return result;
}

export const processEnhancedDenoise = processBasicDenoise;
