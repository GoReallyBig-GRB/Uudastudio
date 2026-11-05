/**
 * Builds the single impulse response that stands for the whole reverb graph (pre-delay, low cut, convolver, high cut), so a
 * long clip can be reverbed by plain fast convolution instead of the slow offline ConvolverNode. All of these stages are
 * linear and time-invariant, so they can be folded into one response and give the same sound.
 */
import type { ReverbParams } from '../../types';
import { generateImpulseResponse } from './dspChain';

export interface ReverbKernel {
  left: Float32Array;
  right: Float32Array;
  /** wet level and the convolver's loudness normalisation, to multiply the response by */
  gain: number;
  /** dry level, to multiply the input by when mixing */
  dryGain: number;
  /** response length in frames; the decay tail after a block is this minus one */
  length: number;
}

/** What Chromium's ConvolverNode does to the buffer it is given, so the loudness matches the live preview */
export const convolverNormalisation = (left: Float32Array, right: Float32Array, sampleRate: number): number => {
  const MIN_POWER = 0.000125;
  const GAIN_CALIBRATION_DB = -58;
  const CALIBRATION_RATE = 44100;
  let sum = 0;
  for (let i = 0; i < left.length; i++) sum += left[i] * left[i] + right[i] * right[i];
  let power = Math.sqrt(sum / (2 * left.length));
  if (!Number.isFinite(power) || power < MIN_POWER) power = MIN_POWER;
  let scale = 1 / power;
  scale *= Math.pow(10, GAIN_CALIBRATION_DB * 0.05);
  scale *= CALIBRATION_RATE / sampleRate;
  return scale;
};

export const buildReverbKernel = async (sampleRate: number, params: ReverbParams): Promise<ReverbKernel> => {
  const probe = new OfflineAudioContext(2, 1, sampleRate);
  const ir = generateImpulseResponse(probe, params.preset || 'hall', params.decayTimeSec || 2.5, params.damping || 0.4);
  const irL = ir.getChannelData(0);
  const irR = ir.getChannelData(1);
  const gain = convolverNormalisation(irL, irR, sampleRate) * params.dryWet;

  // The low cut and high cut filters ring a little beyond the response: render it through them to catch that
  const ring = Math.ceil(sampleRate * 0.3);
  const ctx = new OfflineAudioContext(2, ir.length + ring, sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = ir;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(params.lowCutHz || 120, 0);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(params.highCutHz || 10000, 0);
  src.connect(hp);
  hp.connect(lp);
  lp.connect(ctx.destination);
  src.start(0);
  const filtered = await ctx.startRendering();

  const preDelaySec = Math.max(0, Math.min(0.2, (params.preDelayMs || 20) / 1000));
  const shift = Math.round(preDelaySec * sampleRate);
  const length = filtered.length + shift;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  left.set(filtered.getChannelData(0), shift);
  right.set(filtered.getChannelData(1), shift);
  return { left, right, gain, dryGain: 1 - params.dryWet, length };
};
