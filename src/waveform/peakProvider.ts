/**
 * Waveform peaks for every kind of asset, behind one interface.
 *
 * Both in-memory assets (decoded AudioBuffer) and streamed assets (files in browser storage) use the same design:
 *  - a base level (min/max per 256 frames) held in memory: built once, in small time slices, from the buffer, or
 *    loaded from the peak file written at import;
 *  - zoomed out (>= 256 frames per pixel): coarser levels are merged from the base, instantly;
 *  - zoomed in (< 256 frames per pixel): only the visible window is scanned (from the buffer, or read from disk).
 * Drawing therefore never rescans a whole recording, however many long tracks are open. Calls return null until the
 * first data exists (and a coarse stand-in while a zoomed-in disk window loads); subscribers are told when it lands.
 */
import type { Asset } from '../types';
import { readStreamedChannelRange, readStreamedPeakBase } from '../assets/streamedStore';
import { PEAK_BASE_SAMPLES_PER_PIXEL, aggregatePeaks, fillBucketPeaks, peaksFromRaw } from './peakMath';

export interface WaveformPeaks {
  mins: Float32Array;
  maxs: Float32Array;
  samplesPerPixel: number;
  /** Index of the first bucket stored. 0 for full levels; > 0 for windows. */
  firstBucket?: number;
}

type Window = WaveformPeaks & { start: number; end: number };

interface Entry {
  base: { mins: Float32Array; maxs: Float32Array } | null;
  building: { cancelled: boolean } | null;
  loading: boolean;
  failed: boolean;
  levels: Map<number, WaveformPeaks>;
  window: Window | null;
  windowKey: string | null;
}

/** Below this many samples (frames x channels) the base level is built immediately (a few ms). */
const IMMEDIATE_BUILD_SAMPLES = 6_000_000;
/** Time budget per slice while building the base level in the background. */
const SLICE_BUDGET_MS = 8;

function quantize(samplesPerPixel: number): number {
  const safe = Math.max(1, Number.isFinite(samplesPerPixel) ? samplesPerPixel : 1);
  return Math.max(1, 2 ** Math.round(Math.log2(safe)));
}

class PeakProvider {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void { this.listeners.forEach((l) => l()); }

  clearAsset(assetId: string): void {
    const e = this.entries.get(assetId);
    if (e?.building) e.building.cancelled = true;
    this.entries.delete(assetId);
  }

  private entry(assetId: string): Entry {
    let e = this.entries.get(assetId);
    if (!e) {
      e = { base: null, building: null, loading: false, failed: false, levels: new Map(), window: null, windowKey: null };
      this.entries.set(assetId, e);
    }
    return e;
  }

  /** Builds the base level from a decoded buffer, in time slices (or at once when small). */
  private buildFromBuffer(assetId: string, buffer: AudioBuffer, e: Entry): void {
    if (e.building) return;
    const step = PEAK_BASE_SAMPLES_PER_PIXEL;
    const total = buffer.length;
    const channels = Array.from({ length: Math.max(1, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c));
    const buckets = Math.ceil(total / step);
    const mins = new Float32Array(buckets);
    const maxs = new Float32Array(buckets);
    if (total * channels.length <= IMMEDIATE_BUILD_SAMPLES) {
      fillBucketPeaks(channels, total, 0, buckets, step, mins, maxs);
      e.base = { mins, maxs };
      return;
    }
    const token = { cancelled: false };
    e.building = token;
    let bucket = 0;
    const perChunk = 64; // buckets between clock checks
    const slice = () => {
      if (token.cancelled) return;
      const t0 = performance.now();
      while (bucket < buckets && performance.now() - t0 < SLICE_BUDGET_MS) {
        const end = Math.min(buckets, bucket + perChunk);
        fillBucketPeaks(channels, total, bucket, end, step, mins.subarray(bucket, end), maxs.subarray(bucket, end));
        bucket = end;
      }
      if (bucket < buckets) { setTimeout(slice, 0); return; }
      e.building = null;
      e.base = { mins, maxs };
      if (this.entries.get(assetId) === e) this.notify();
    };
    setTimeout(slice, 0);
  }

  private loadFromFile(assetId: string, storeId: string, e: Entry): void {
    if (e.loading || e.failed) return;
    e.loading = true;
    void readStreamedPeakBase(storeId).then((base) => {
      e.loading = false;
      if (!base) e.failed = true; else e.base = base;
      if (this.entries.get(assetId) === e) this.notify();
    });
  }

  private level(e: Entry, step: number): WaveformPeaks {
    const cached = e.levels.get(step);
    if (cached) return cached;
    const base = e.base!;
    const ratio = step / PEAK_BASE_SAMPLES_PER_PIXEL;
    const agg = ratio === 1 ? base : aggregatePeaks(base.mins, base.maxs, ratio);
    const level: WaveformPeaks = { mins: agg.mins, maxs: agg.maxs, samplesPerPixel: step };
    e.levels.set(step, level);
    return level;
  }

  /** Peaks covering [startSample, endSample) at about `samplesPerPixel`, or null until the first data exists. */
  getPeaksForRange(asset: Asset, startSample: number, endSample: number, samplesPerPixel: number): WaveformPeaks | null {
    const buffer = asset.buffer;
    const source = asset.source;
    if (!buffer && !source) return null;
    const e = this.entry(asset.id);
    if (!e.base) {
      if (buffer) this.buildFromBuffer(asset.id, buffer, e);
      else if (source) this.loadFromFile(asset.id, source.storeId, e);
      if (!e.base) return null;
    }
    const baseStep = PEAK_BASE_SAMPLES_PER_PIXEL;
    const step = quantize(samplesPerPixel);
    if (step >= baseStep) return this.level(e, step);

    // Zoomed in past the base level: only the visible window is read.
    const totalFrames = buffer ? buffer.length : source!.frames;
    const first = Math.max(0, Math.floor(Math.max(0, startSample) / step) - 1);
    const last = Math.min(Math.ceil(totalFrames / step), Math.ceil(Math.max(startSample, endSample) / step) + 1);
    const w = e.window;
    if (w && w.samplesPerPixel === step && w.start <= first && w.end >= last) return w;
    const pad = Math.max(16, last - first);
    const wFirst = Math.max(0, first - pad);
    const wLast = Math.min(Math.ceil(totalFrames / step), last + pad);
    if (buffer) {
      const channels = Array.from({ length: Math.max(1, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c));
      const startFrame = wFirst * step;
      const frames = Math.min(totalFrames - startFrame, (wLast - wFirst) * step);
      if (frames <= 0) return this.level(e, baseStep);
      const p = peaksFromRaw(channels.map((ch) => ch.subarray(startFrame, startFrame + frames)), frames, step);
      const win: Window = { mins: p.mins, maxs: p.maxs, samplesPerPixel: step, firstBucket: wFirst, start: wFirst, end: wFirst + p.mins.length };
      e.window = win;
      return win;
    }
    this.loadWindowFromFile(asset, e, step, wFirst, wLast);
    return this.level(e, baseStep); // coarse stand-in for a few milliseconds
  }

  private loadWindowFromFile(asset: Asset, e: Entry, step: number, first: number, last: number): void {
    const source = asset.source!;
    const key = `${step}:${first}:${last}`;
    if (e.windowKey === key) return;
    e.windowKey = key;
    const startFrame = first * step;
    const frames = Math.min(source.frames - startFrame, (last - first) * step);
    if (frames <= 0) return;
    void Promise.all(Array.from({ length: Math.max(1, asset.numberOfChannels) }, (_, c) => readStreamedChannelRange(source.storeId, c, startFrame, frames))).then((chans) => {
      if (e.windowKey !== key || this.entries.get(asset.id) !== e) return; // superseded
      const got = Math.min(...chans.map((c) => c.length));
      if (got <= 0) return;
      const p = peaksFromRaw(chans, got, step);
      e.window = { mins: p.mins, maxs: p.maxs, samplesPerPixel: step, firstBucket: first, start: first, end: first + p.mins.length };
      this.notify();
    });
  }
}

export const peakProvider = new PeakProvider();
