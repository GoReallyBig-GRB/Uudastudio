/**
 * X-PRO AUDIO - DSP Dynamics Compressor
 * Real offline dynamics compression using Web Audio's OfflineAudioContext.
 * Renders high-precision dynamics control to an AudioBuffer.
 */

import { CompressorParams } from '../../types';

export async function processCompression(
  inputBuffer: AudioBuffer,
  params: CompressorParams
): Promise<AudioBuffer> {
  if (!inputBuffer || inputBuffer.length === 0) {
    throw new Error('Input audio buffer is empty.');
  }

  const sampleRate = inputBuffer.sampleRate || 48000;
  const numChannels = Math.max(1, Math.min(2, inputBuffer.numberOfChannels));
  const length = Math.max(128, inputBuffer.length);

  const offlineCtx = new OfflineAudioContext(numChannels, length, sampleRate);

  // Source
  const source = offlineCtx.createBufferSource();
  source.buffer = inputBuffer;

  // Real Web Audio Dynamics Compressor with strict spec bounds
  const compressor = offlineCtx.createDynamicsCompressor();
  const threshold = Math.max(-100, Math.min(0, Number.isFinite(params.thresholdDb) ? params.thresholdDb : -24));
  const knee = Math.max(0, Math.min(40, Number.isFinite(params.kneeDb) ? params.kneeDb : 12));
  const ratio = Math.max(1, Math.min(20, Number.isFinite(params.ratio) ? params.ratio : 4));
  const attack = Math.max(0.001, Math.min(1.0, (params.attackMs || 15) / 1000));
  const release = Math.max(0.01, Math.min(1.0, (params.releaseMs || 180) / 1000));

  compressor.threshold.setValueAtTime(threshold, 0);
  compressor.knee.setValueAtTime(knee, 0);
  compressor.ratio.setValueAtTime(ratio, 0);
  compressor.attack.setValueAtTime(attack, 0);
  compressor.release.setValueAtTime(release, 0);

  // Makeup Gain
  const makeupGain = offlineCtx.createGain();
  const makeupDb = Math.max(-24, Math.min(24, Number.isFinite(params.makeupGainDb) ? params.makeupGainDb : 0));
  const linearMakeup = Math.pow(10, makeupDb / 20);
  makeupGain.gain.setValueAtTime(linearMakeup, 0);

  // Routing: Source -> Compressor -> MakeupGain -> Destination
  source.connect(compressor);
  compressor.connect(makeupGain);
  makeupGain.connect(offlineCtx.destination);

  source.start(0);

  return await offlineCtx.startRendering();
}
