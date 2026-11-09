/**
 * Mixes the microphone's channels down to one. A USB or lavalier mic that records on one side of a stereo input
 * (the other side silent) must use that side at full level, not an average that halves it. Pure, unit-tested.
 */

export type ChannelMode = 'mono' | 'both' | 'left' | 'right';

export interface MixState { left: number; right: number }
export const newMixState = (): MixState => ({ left: 0, right: 0 });

/** A side counts as silent when it carries less than 1% of the other side's energy (20 dB down), over the recent past */
const SILENT_RATIO = 0.01;
/** Older energy fades so a mic that is switched mid-session is noticed */
const FADE = 0.98;

export const mixBlock = (left: Float32Array, right: Float32Array | null, state: MixState): { out: Float32Array; mode: ChannelMode } => {
  if (!right) return { out: left, mode: 'mono' };
  let el = 0, er = 0;
  for (let i = 0; i < left.length; i++) { el += left[i] * left[i]; er += right[i] * right[i]; }
  state.left = state.left * FADE + el;
  state.right = state.right * FADE + er;
  if (state.left > 0 && state.right < state.left * SILENT_RATIO) return { out: left, mode: 'left' };
  if (state.right > 0 && state.left < state.right * SILENT_RATIO) return { out: right, mode: 'right' };
  const out = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) out[i] = (left[i] + right[i]) * 0.5;
  return { out, mode: 'both' };
};

export const MODE_TEXT: Record<ChannelMode, string> = { mono: 'mono', both: 'two channels mixed to one', left: 'left channel only (the right is silent)', right: 'right channel only (the left is silent)' };
