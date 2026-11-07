/**
 * The streaming stages for every tool that keeps state from block to block, built from a plain description, so the same
 * description can be run on the main thread or sent to a Web Worker (see dspWorker.ts). No browser APIs here.
 */
import type { CompressorParams, DenoiseParams } from '../../types';
import { perChannel } from '../chunkedProcess';
import { CompressorStage } from './compressorStream';
import { makeDenoiseStage } from './denoiseStream';
import { PitchShiftStage, WsolaStretcher } from './wsolaStream';
import { speedStretchParams } from './wsola';
import { EnhanceSettings, EvenOutSettings, buildEnhanceChain, buildEvenOutChain } from './leveling';

export type StageTool =
  | { kind: 'compress'; params: CompressorParams }
  | { kind: 'denoise'; params: DenoiseParams }
  | { kind: 'pitch'; semitones: number }
  | { kind: 'speed'; ratio: number }
  /** One-step cleanup and levelling; the channels are linked */
  | { kind: 'enhance'; settings: EnhanceSettings }
  /** Slow level evening with a peak ceiling (Normalize's "even out") */
  | { kind: 'evenout'; settings: EvenOutSettings };

export interface StageSpec {
  tool: StageTool;
  channels: number;
  totalFrames: number;
  sampleRate: number;
}

/** A stage that answers at once (all of ours do) */
export interface SyncStage {
  push(chunk: Float32Array[]): Float32Array[];
  finish(): Float32Array[];
}

export const buildStage = ({ tool, channels, totalFrames, sampleRate }: StageSpec): SyncStage => {
  const each = <T>(make: () => T): T[] => Array.from({ length: channels }, make);
  if (tool.kind === 'compress') return new CompressorStage(sampleRate, tool.params);
  if (tool.kind === 'enhance') return buildEnhanceChain(sampleRate, tool.settings);
  if (tool.kind === 'evenout') return buildEvenOutChain(sampleRate, tool.settings);
  if (tool.kind === 'denoise') return perChannel(each(() => makeDenoiseStage(totalFrames, sampleRate, tool.params)));
  if (tool.kind === 'pitch') return perChannel(each(() => new PitchShiftStage(totalFrames, tool.semitones, sampleRate)));
  const speed = Math.max(0.2, Math.min(5, Number.isFinite(tool.ratio) ? tool.ratio : 1));
  return perChannel(each(() => new WsolaStretcher(totalFrames, speed, speedStretchParams(sampleRate))));
};
