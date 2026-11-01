/**
 * X-PRO AUDIO - DSP Dynamics Compressor
 * Offline dynamics compression of a whole buffer. The processing itself lives in `compressorStream.ts`, which also runs
 * long audio block by block with exactly the same result.
 */

import { CompressorParams } from '../../types';
import { processChannelsOffThread } from './dspWorkerClient';

export async function processCompression(
  inputBuffer: AudioBuffer,
  params: CompressorParams
): Promise<AudioBuffer> {
  if (!inputBuffer || inputBuffer.length === 0) {
    throw new Error('Input audio buffer is empty.');
  }
  const sampleRate = inputBuffer.sampleRate || 48000;
  const numChannels = Math.max(1, Math.min(2, inputBuffer.numberOfChannels));
  const input = Array.from({ length: numChannels }, (_, c) => inputBuffer.getChannelData(c));
  // Heavy work runs in a Web Worker so the interface stays smooth
  const out = await processChannelsOffThread(input, sampleRate, { kind: 'compress', params });
  const result = new AudioBuffer({ length: Math.max(1, out[0].length), numberOfChannels: numChannels, sampleRate });
  out.forEach((ch, c) => result.copyToChannel(ch as never, c));
  return result;
}
