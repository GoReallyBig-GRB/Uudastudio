/**
 * X-PRO AUDIO - Professional Real-Time & Offline Audio DSP Effects Chain
 * Implements: Delay, Parametric Equalizer, Chorus, Flanger, Phaser, and Algorithmic/Convolution Reverb.
 * The exact same nodes and math execute in real-time preview, live playback, and OfflineAudioContext export.
 */

import {
  DelayParams,
  EqualizerParams,
  ChorusParams,
  FlangerParams,
  PhaserParams,
  ReverbParams,
  TrackEffect,
} from '../../types';

/**
 * Calculates the required decay tail in seconds so that delay/reverb reflections
 * are not truncated when applied to a clip or rendered during export.
 */
export function calculateEffectTailSeconds(effects: TrackEffect[]): number {
  let tail = 0;
  for (const eff of effects) {
    if (!eff.enabled) continue;
    if (eff.type === 'delay') {
      const p = eff.params as DelayParams;
      // Exponential decay time based on feedback: T = timeMs / (1 - feedback)
      const fb = Math.min(0.95, Math.max(0, p.feedback));
      const delayTail = ((p.timeMs / 1000) * 3) / (1 - fb + 0.05);
      tail = Math.max(tail, Math.min(10, delayTail));
    } else if (eff.type === 'reverb') {
      const p = eff.params as ReverbParams;
      const revTail = (p.decayTimeSec || 2.5) + (p.preDelayMs || 0) / 1000;
      tail = Math.max(tail, Math.min(12, revTail));
    }
  }
  return tail;
}

/**
 * Synthesizes a high-fidelity stereo impulse response for convolution reverb
 */
export function generateImpulseResponse(
  ctx: BaseAudioContext,
  preset: 'room' | 'hall' | 'plate' | 'chamber',
  decaySec: number,
  damping: number
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const duration = Math.max(0.2, Math.min(8.0, decaySec));
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(2, length, sampleRate);

  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  // Density and early reflection parameters based on preset
  let initialReflections = 12;
  let decayExponent = 3.0;

  if (preset === 'room') {
    initialReflections = 8;
    decayExponent = 4.5;
  } else if (preset === 'hall') {
    initialReflections = 24;
    decayExponent = 2.2;
  } else if (preset === 'plate') {
    initialReflections = 40;
    decayExponent = 2.8;
  } else if (preset === 'chamber') {
    initialReflections = 16;
    decayExponent = 3.2;
  }

  // Pre-seed pseudo-random noise with exponential decay and high-frequency damping
  let lpL = 0;
  let lpR = 0;
  const dampCoeff = Math.min(0.95, Math.max(0.05, damping));

  for (let i = 0; i < length; i++) {
    const t = i / length;
    const env = Math.pow(1 - t, decayExponent);

    // Stereo decorrelated white noise
    let whiteL = (Math.random() * 2 - 1) * env;
    let whiteR = (Math.random() * 2 - 1) * env;

    // Damping one-pole low-pass filter
    lpL = lpL + dampCoeff * (whiteL - lpL);
    lpR = lpR + dampCoeff * (whiteR - lpR);

    // Early reflections boost in first 50ms
    if (i < sampleRate * 0.05) {
      const earlyScale = 1 + Math.sin((i / (sampleRate * 0.05)) * Math.PI * initialReflections);
      whiteL *= earlyScale;
      whiteR *= earlyScale;
    }

    left[i] = lpL;
    right[i] = lpR;
  }

  return buffer;
}

/**
 * Builds and connects a Delay effect graph
 */
export function buildDelayNode(ctx: BaseAudioContext, params: DelayParams) {
  const input = ctx.createGain();
  const output = ctx.createGain();

  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  dryGain.gain.setValueAtTime(1 - params.dryWet, ctx.currentTime);
  wetGain.gain.setValueAtTime(params.dryWet, ctx.currentTime);

  const delayTimeSec = Math.max(0.01, Math.min(2.0, params.timeMs / 1000));
  const delayL = ctx.createDelay(2.5);
  const delayR = ctx.createDelay(2.5);
  delayL.delayTime.setValueAtTime(delayTimeSec, ctx.currentTime);
  delayR.delayTime.setValueAtTime(params.pingPong ? delayTimeSec * 1.5 : delayTimeSec, ctx.currentTime);

  const feedbackL = ctx.createGain();
  const feedbackR = ctx.createGain();
  // Safe feedback clamping below 1.0 to guarantee stability
  const safeFeedback = Math.max(0, Math.min(0.95, params.feedback));
  feedbackL.gain.setValueAtTime(safeFeedback, ctx.currentTime);
  feedbackR.gain.setValueAtTime(safeFeedback, ctx.currentTime);

  // Low-cut and high-cut filters in the feedback path
  const hpFilter = ctx.createBiquadFilter();
  hpFilter.type = 'highpass';
  hpFilter.frequency.setValueAtTime(params.lowCutHz || 80, ctx.currentTime);

  const lpFilter = ctx.createBiquadFilter();
  lpFilter.type = 'lowpass';
  lpFilter.frequency.setValueAtTime(params.highCutHz || 8000, ctx.currentTime);

  // Input split
  input.connect(dryGain);
  dryGain.connect(output);

  input.connect(delayL);
  if (!params.pingPong) {
    input.connect(delayR);
  }

  // Delay -> Filters -> Feedback
  delayL.connect(hpFilter);
  hpFilter.connect(lpFilter);

  if (params.pingPong) {
    // Ping pong: L -> R -> L
    lpFilter.connect(feedbackL);
    feedbackL.connect(delayR);

    delayR.connect(feedbackR);
    feedbackR.connect(delayL);
  } else {
    lpFilter.connect(feedbackL);
    feedbackL.connect(delayL);
    delayR.connect(feedbackR);
    feedbackR.connect(delayR);
  }

  delayL.connect(wetGain);
  delayR.connect(wetGain);
  wetGain.connect(output);

  return { input, output };
}

/**
 * Builds a 5-band Parametric Equalizer graph
 */
export function buildEqualizerNode(ctx: BaseAudioContext, params: EqualizerParams) {
  const input = ctx.createGain();
  const output = ctx.createGain();

  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  dryGain.gain.setValueAtTime(1 - (params.dryWet ?? 1), ctx.currentTime);
  wetGain.gain.setValueAtTime(params.dryWet ?? 1, ctx.currentTime);

  input.connect(dryGain);
  dryGain.connect(output);

  let currentHead: AudioNode = input;

  for (const band of params.bands) {
    if (!band.enabled) continue;

    const biquad = ctx.createBiquadFilter();
    biquad.type = band.type as BiquadFilterType;
    biquad.frequency.setValueAtTime(Math.max(20, Math.min(20000, band.frequency)), ctx.currentTime);
    biquad.Q.setValueAtTime(Math.max(0.1, Math.min(18, band.q || 1.0)), ctx.currentTime);
    biquad.gain.setValueAtTime(Math.max(-24, Math.min(24, band.gainDb || 0)), ctx.currentTime);

    currentHead.connect(biquad);
    currentHead = biquad;
  }

  currentHead.connect(wetGain);
  wetGain.connect(output);

  return { input, output };
}

/**
 * Builds a multi-voice Chorus effect graph
 */
export function buildChorusNode(ctx: BaseAudioContext, params: ChorusParams) {
  const input = ctx.createGain();
  const output = ctx.createGain();

  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  dryGain.gain.setValueAtTime(1 - params.dryWet, ctx.currentTime);
  wetGain.gain.setValueAtTime(params.dryWet, ctx.currentTime);

  input.connect(dryGain);
  dryGain.connect(output);

  const numVoices = Math.max(2, Math.min(6, params.voices || 3));
  const rate = Math.max(0.1, Math.min(8.0, params.rateHz || 1.5));
  const depthSec = Math.max(0.001, Math.min(0.02, (params.depthMs || 6) / 1000));
  const baseDelaySec = 0.015;

  for (let i = 0; i < numVoices; i++) {
    const delay = ctx.createDelay(0.05);
    delay.delayTime.setValueAtTime(baseDelaySec, ctx.currentTime);

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    // Slightly detune each voice LFO for rich chorus spread
    lfo.frequency.setValueAtTime(rate * (1 + (i - numVoices / 2) * 0.15), ctx.currentTime);

    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(depthSec, ctx.currentTime);

    lfo.connect(lfoGain);
    lfoGain.connect(delay.delayTime);

    input.connect(delay);
    delay.connect(wetGain);

    lfo.start();
  }

  wetGain.connect(output);
  return { input, output };
}

/**
 * Builds a Flanger effect graph (short modulated delay with feedback)
 */
export function buildFlangerNode(ctx: BaseAudioContext, params: FlangerParams) {
  const input = ctx.createGain();
  const output = ctx.createGain();

  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  dryGain.gain.setValueAtTime(1 - params.dryWet, ctx.currentTime);
  wetGain.gain.setValueAtTime(params.dryWet, ctx.currentTime);

  input.connect(dryGain);
  dryGain.connect(output);

  const delay = ctx.createDelay(0.02);
  const baseDelaySec = Math.max(0.0005, Math.min(0.01, (params.delayMs || 2.5) / 1000));
  delay.delayTime.setValueAtTime(baseDelaySec, ctx.currentTime);

  const depthSec = Math.max(0.0001, Math.min(0.005, (params.depthMs || 1.8) / 1000));
  const rate = Math.max(0.05, Math.min(5.0, params.rateHz || 0.4));

  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(rate, ctx.currentTime);

  const lfoGain = ctx.createGain();
  lfoGain.gain.setValueAtTime(depthSec, ctx.currentTime);

  lfo.connect(lfoGain);
  lfoGain.connect(delay.delayTime);

  // Positive or negative feedback loop
  const feedback = ctx.createGain();
  const safeFb = Math.max(-0.9, Math.min(0.9, params.feedback || 0.6));
  feedback.gain.setValueAtTime(safeFb, ctx.currentTime);

  input.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);

  delay.connect(wetGain);
  wetGain.connect(output);

  lfo.start();
  return { input, output };
}

/**
 * Builds a 4 to 12 stage Phaser effect graph (cascaded all-pass filters)
 */
export function buildPhaserNode(ctx: BaseAudioContext, params: PhaserParams) {
  const input = ctx.createGain();
  const output = ctx.createGain();

  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  dryGain.gain.setValueAtTime(1 - params.dryWet, ctx.currentTime);
  wetGain.gain.setValueAtTime(params.dryWet, ctx.currentTime);

  input.connect(dryGain);
  dryGain.connect(output);

  const numStages = Math.max(4, Math.min(12, params.stages || 6));
  const centerFreq = Math.max(100, Math.min(8000, params.centerFreqHz || 1200));
  const rate = Math.max(0.05, Math.min(6.0, params.rateHz || 0.5));
  const depth = Math.max(0, Math.min(1.0, params.depth || 0.7));

  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(rate, ctx.currentTime);

  const lfoGain = ctx.createGain();
  lfoGain.gain.setValueAtTime(centerFreq * depth * 0.75, ctx.currentTime);
  lfo.connect(lfoGain);

  let current: AudioNode = input;
  const stages: BiquadFilterNode[] = [];

  for (let i = 0; i < numStages; i++) {
    const ap = ctx.createBiquadFilter();
    ap.type = 'allpass';
    ap.frequency.setValueAtTime(centerFreq, ctx.currentTime);
    ap.Q.setValueAtTime(1.0, ctx.currentTime);
    lfoGain.connect(ap.frequency);

    current.connect(ap);
    current = ap;
    stages.push(ap);
  }

  // Feedback from last stage to first stage
  const feedback = ctx.createGain();
  const safeFb = Math.max(0, Math.min(0.85, params.feedback || 0.65));
  feedback.gain.setValueAtTime(safeFb, ctx.currentTime);
  stages[stages.length - 1].connect(feedback);
  feedback.connect(stages[0]);

  stages[stages.length - 1].connect(wetGain);
  wetGain.connect(output);

  lfo.start();
  return { input, output };
}

/**
 * Builds a Reverb effect graph (Algorithmic / Convolution with synthetic impulse response)
 */
export function buildReverbNode(ctx: BaseAudioContext, params: ReverbParams) {
  const input = ctx.createGain();
  const output = ctx.createGain();

  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  dryGain.gain.setValueAtTime(1 - params.dryWet, ctx.currentTime);
  wetGain.gain.setValueAtTime(params.dryWet, ctx.currentTime);

  input.connect(dryGain);
  dryGain.connect(output);

  // Pre-delay
  const preDelaySec = Math.max(0, Math.min(0.2, (params.preDelayMs || 20) / 1000));
  const preDelay = ctx.createDelay(0.3);
  preDelay.delayTime.setValueAtTime(preDelaySec, ctx.currentTime);

  // Convolver with custom impulse response
  const convolver = ctx.createConvolver();
  convolver.buffer = generateImpulseResponse(
    ctx,
    params.preset || 'hall',
    params.decayTimeSec || 2.5,
    params.damping || 0.4
  );

  // Frequency shaping filters on reverb tail
  const hpFilter = ctx.createBiquadFilter();
  hpFilter.type = 'highpass';
  hpFilter.frequency.setValueAtTime(params.lowCutHz || 120, ctx.currentTime);

  const lpFilter = ctx.createBiquadFilter();
  lpFilter.type = 'lowpass';
  lpFilter.frequency.setValueAtTime(params.highCutHz || 10000, ctx.currentTime);

  input.connect(preDelay);
  preDelay.connect(hpFilter);
  hpFilter.connect(convolver);
  convolver.connect(lpFilter);
  lpFilter.connect(wetGain);
  wetGain.connect(output);

  return { input, output };
}

/**
 * Renders an AudioBuffer through an effect chain offline, including any decay tails
 */
export async function renderBufferWithEffect(
  inputBuffer: AudioBuffer,
  effect: TrackEffect
): Promise<AudioBuffer> {
  const tailSeconds = calculateEffectTailSeconds([effect]);
  const sampleRate = inputBuffer.sampleRate;
  const numChannels = Math.max(1, Math.min(2, inputBuffer.numberOfChannels));
  const totalFrames = Math.floor((inputBuffer.duration + tailSeconds) * sampleRate);

  const offlineCtx = new OfflineAudioContext(numChannels, totalFrames, sampleRate);
  const src = offlineCtx.createBufferSource();
  src.buffer = inputBuffer;

  let effectNodes: { input: AudioNode; output: AudioNode };

  switch (effect.type) {
    case 'delay':
      effectNodes = buildDelayNode(offlineCtx, effect.params as DelayParams);
      break;
    case 'equalizer':
      effectNodes = buildEqualizerNode(offlineCtx, effect.params as EqualizerParams);
      break;
    case 'chorus':
      effectNodes = buildChorusNode(offlineCtx, effect.params as ChorusParams);
      break;
    case 'flanger':
      effectNodes = buildFlangerNode(offlineCtx, effect.params as FlangerParams);
      break;
    case 'phaser':
      effectNodes = buildPhaserNode(offlineCtx, effect.params as PhaserParams);
      break;
    case 'reverb':
    default:
      effectNodes = buildReverbNode(offlineCtx, effect.params as ReverbParams);
      break;
  }

  src.connect(effectNodes.input);
  effectNodes.output.connect(offlineCtx.destination);
  src.start(0);

  return await offlineCtx.startRendering();
}
