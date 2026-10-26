/**
 * Waveform peaks for streamed (file-backed) assets.
 * - Zoomed out (>= 256 frames per pixel): from the in-memory base level, aggregated and cached per level.
 * - Zoomed in (< 256 frames per pixel): the visible window is read from the channel files and scanned.
 * Loading is asynchronous: calls return null (or a coarser fallback) and subscribers are notified when data lands,
 * so drawing never blocks. Shape matches waveformCache.getPeaksForRange.
 */
import type { StreamedSource } from '../types';
import { readStreamedChannelRange, readStreamedPeakBase } from '../assets/streamedStore';
import { aggregatePeaks, peaksFromRaw } from './peakMath';
import type { WaveformPeaks } from './cache';

interface Entry {
  base: { mins: Float32Array; maxs: Float32Array } | null;
  baseLoading: boolean;
  baseFailed: boolean;
  levels: Map<number, WaveformPeaks>;
  window: (WaveformPeaks & { start: number; end: number }) | null;
  windowKey: string | null;
}

function quantize(samplesPerPixel: number): number {
  const safe = Math.max(1, Number.isFinite(samplesPerPixel) ? samplesPerPixel : 1);
  return Math.max(1, 2 ** Math.round(Math.log2(safe)));
}

class StreamedPeakProvider {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void { this.listeners.forEach((l) => l()); }

  clearAsset(assetId: string): void { this.entries.delete(assetId); }

  private entry(assetId: string): Entry {
    let e = this.entries.get(assetId);
    if (!e) {
      e = { base: null, baseLoading: false, baseFailed: false, levels: new Map(), window: null, windowKey: null };
      this.entries.set(assetId, e);
    }
    return e;
  }

  private loadBase(assetId: string, source: StreamedSource, e: Entry): void {
    if (e.baseLoading || e.baseFailed) return;
    e.baseLoading = true;
    void readStreamedPeakBase(source.storeId).then((base) => {
      e.baseLoading = false;
      if (!base) e.baseFailed = true; else e.base = base;
      if (this.entries.get(assetId) === e) this.notify();
    });
  }

  private baseLevel(e: Entry, baseStep: number): WaveformPeaks | null {
    if (!e.base) return null;
    return { mins: e.base.mins, maxs: e.base.maxs, samplesPerPixel: baseStep };
  }

  private loadWindow(assetId: string, source: StreamedSource, channels: number, e: Entry, step: number, first: number, last: number): void {
    const key = `${step}:${first}:${last}`;
    if (e.windowKey === key) return;
    e.windowKey = key;
    const startFrame = first * step;
    const frames = Math.min(source.frames - startFrame, (last - first) * step);
    if (frames <= 0) return;
    void Promise.all(Array.from({ length: Math.max(1, channels) }, (_, c) => readStreamedChannelRange(source.storeId, c, startFrame, frames))).then((chans) => {
      if (e.windowKey !== key || this.entries.get(assetId) !== e) return; // superseded
      const got = Math.min(...chans.map((c) => c.length));
      if (got <= 0) return;
      const p = peaksFromRaw(chans, got, step);
      e.window = { mins: p.mins, maxs: p.maxs, samplesPerPixel: step, firstBucket: first, start: first, end: first + p.mins.length };
      this.notify();
    });
  }

  /** Peaks covering [startSample, endSample) at about `samplesPerPixel`, or null until the first data arrives. */
  getPeaksForRange(assetId: string, source: StreamedSource, channels: number, startSample: number, endSample: number, samplesPerPixel: number): WaveformPeaks | null {
    const e = this.entry(assetId);
    const baseStep = source.peakBaseSamplesPerPixel;
    if (!e.base) { this.loadBase(assetId, source, e); return null; }
    const step = quantize(samplesPerPixel);
    if (step >= baseStep) {
      const cached = e.levels.get(step);
      if (cached) return cached;
      const ratio = step / baseStep;
      const agg = ratio === 1 ? { mins: e.base.mins, maxs: e.base.maxs } : aggregatePeaks(e.base.mins, e.base.maxs, ratio);
      const level: WaveformPeaks = { mins: agg.mins, maxs: agg.maxs, samplesPerPixel: step };
      e.levels.set(step, level);
      return level;
    }
    // Zoomed in past the base level: need raw samples for the visible window.
    const first = Math.max(0, Math.floor(Math.max(0, startSample) / step) - 1);
    const last = Math.min(Math.ceil(source.frames / step), Math.ceil(Math.max(startSample, endSample) / step) + 1);
    const w = e.window;
    if (w && w.samplesPerPixel === step && w.start <= first && w.end >= last) return w;
    const pad = Math.max(16, last - first);
    this.loadWindow(assetId, source, channels, e, step, Math.max(0, first - pad), Math.min(Math.ceil(source.frames / step), last + pad));
    return this.baseLevel(e, baseStep); // coarse stand-in for a few milliseconds
  }
}

export const streamedPeaks = new StreamedPeakProvider();
