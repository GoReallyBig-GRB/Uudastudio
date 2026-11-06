/**
 * Time stretching (Speed) and pitch shifting of one channel as independent segments, so a long track can use several cores.
 *
 * The stretch itself is sequential: each frame is chosen to continue the output built so far. Here the track is cut into
 * segments of a minute or two, each with some extra audio before and after it, and every segment is stretched on its own
 * (started in parallel by `runSegment`). Two independent runs over the same audio are both good stretches, but their waveforms
 * can sit a few milliseconds out of step with each other, so each join does the same thing the stretch does at every frame: it
 * finds the shift (within the search range) that makes the next segment continue the one before, and crossfades over one frame.
 * Each segment is shifted against its OWN nominal position (never against the sum of earlier shifts), so the timing never
 * drifts by more than one search range (about 10 ms), the same as inside one sequential run.
 *
 * No browser APIs here: `runSegment` is what talks to workers, so tests can run it in this thread.
 */

export interface SegmentedOptions {
  /** Frames of the input channel */
  totalFrames: number;
  /** Output is input / ratio frames long (the Speed ratio; 1 for pitch, which keeps the length) */
  ratio: number;
  /** The stretch's frame length and search range, in frames (see StretchParams) */
  frame: number;
  search: number;
  /** About this many input frames per segment (the real size is adjusted so the segments are equal) */
  segmentFrames: number;
  /** Stretch one segment (its audio, with the extra lead-in and tail) and return the whole result */
  runSegment: (input: Float32Array) => Promise<Float32Array>;
  /** How many segments may be being processed or waiting to be joined at once */
  maxInFlight: number;
}

export interface SegmentedChannel {
  /** Feed the next input frames; returns the output frames that are final by now (maybe none) */
  push(chunk: Float32Array): Promise<Float32Array>;
  /** After the last input: returns the rest of the output */
  finish(): Promise<Float32Array>;
}

/** The segment boundaries: K nearly equal pieces of the input (K at least 1). */
export const planSegments = (totalFrames: number, segmentFrames: number): number[] => {
  const k = Math.max(1, Math.floor(totalFrames / Math.max(1, segmentFrames)));
  return Array.from({ length: k + 1 }, (_, i) => Math.round((i * totalFrames) / k));
};

export const createSegmentedChannel = (opts: SegmentedOptions): SegmentedChannel => {
  const { totalFrames, frame, search, runSegment } = opts;
  const ratio = Math.max(0.05, opts.ratio);
  const bounds = planSegments(totalFrames, opts.segmentFrames);
  const K = bounds.length - 1;
  const outLength = Math.max(1, Math.round(totalFrames / ratio));
  const L = frame; // crossfade length
  const half = Math.floor(L / 2);
  // Extra input around a segment: enough for the crossfade, the largest shift and a frame or two of settling
  const roll = Math.ceil((L / 2 + search + 2 * frame) * Math.max(1, ratio)) + 64;
  const pre = (k: number) => (k === 0 ? 0 : roll);
  const post = (k: number) => (k === K - 1 ? 0 : roll);
  const extStart = (k: number) => bounds[k] - pre(k);
  const extEnd = (k: number) => Math.min(totalFrames, bounds[k + 1] + post(k));
  const outStart = (k: number) => Math.round(extStart(k) / ratio);
  /** Where segment k meets segment k+1, on the output timeline */
  const joinAt = (k: number) => Math.round(bounds[k + 1] / ratio);

  // Input kept until its segments have been started
  const held: { start: number; data: Float32Array }[] = [];
  let received = 0;
  let dispatched = 0;
  const results: Promise<Float32Array>[] = [];
  // The join state: the segment before the next one, with the shift it was joined at, and how much output is final
  let joined = 0;
  let prev: { out: Float32Array; start: number; shift: number } | null = null;
  let emittedTo = 0;
  const emitted: Float32Array[] = [];

  const takeInput = (from: number, to: number): Float32Array => {
    const out = new Float32Array(to - from);
    for (const h of held) {
      const a = Math.max(from, h.start);
      const b = Math.min(to, h.start + h.data.length);
      if (b > a) out.set(h.data.subarray(a - h.start, b - h.start), a - from);
    }
    return out;
  };

  const dispatchReady = (final: boolean) => {
    while (dispatched < K && (final || received >= extEnd(dispatched))) {
      const k = dispatched++;
      results.push(runSegment(takeInput(extStart(k), extEnd(k))));
      results[k].catch(() => undefined);
      // Input before the next segment's lead-in is no longer needed
      if (dispatched < K) {
        const keepFrom = extStart(dispatched);
        while (held.length && held[0].start + held[0].data.length <= keepFrom) held.shift();
      }
    }
  };

  const sample = (seg: { out: Float32Array; start: number; shift: number }, g: number): number => {
    const i = g - seg.start - seg.shift;
    return i < 0 ? 0 : i >= seg.out.length ? seg.out[seg.out.length - 1] ?? 0 : seg.out[i];
  };

  /** Append the output frames [from, to) of a segment to what is final */
  const emitBody = (seg: { out: Float32Array; start: number; shift: number }, from: number, to: number) => {
    if (to <= from) return;
    const out = new Float32Array(to - from);
    for (let g = from; g < to; g++) out[g - from] = sample(seg, g);
    emitted.push(out);
    emittedTo = to;
  };

  /** Join the next finished segment onto what is final */
  const joinNext = async () => {
    const k = joined;
    const out = await results[k];
    const seg = { out, start: outStart(k), shift: 0 };
    if (k === 0 || !prev) {
      emitBody(seg, 0, K === 1 ? outLength : joinAt(0) - half);
    } else {
      const J = joinAt(k - 1);
      const from = J - half;
      // Which shift of this segment makes it continue the previous one best (normalised correlation over the crossfade)
      const lo = k === K - 1 ? 0 : -search; // the last segment must not end early
      let best = 0;
      let bestScore = -Infinity;
      for (let d = lo; d <= search; d++) {
        let cr = 0;
        let ea = 0;
        let eb = 0;
        for (let i = 0; i < L; i += 2) {
          const a = sample(prev, from + i);
          const b = sample({ out, start: seg.start, shift: d }, from + i);
          cr += a * b;
          ea += a * a;
          eb += b * b;
        }
        const s = cr / Math.sqrt(ea * eb + 1e-12);
        if (s > bestScore) { bestScore = s; best = d; }
      }
      seg.shift = best;
      // Coherent signals fade linearly (no loudness bump); unrelated ones fade with equal power
      const coherence = Math.max(0, Math.min(1, (bestScore - 0.3) / 0.5));
      const mix = new Float32Array(L);
      for (let i = 0; i < L; i++) {
        const w = (i + 0.5) / L;
        const wa = coherence * (1 - w) + (1 - coherence) * Math.cos((w * Math.PI) / 2);
        const wb = coherence * w + (1 - coherence) * Math.sin((w * Math.PI) / 2);
        mix[i] = sample(prev, from + i) * wa + sample(seg, from + i) * wb;
      }
      emitted.push(mix);
      emittedTo = from + L;
      emitBody(seg, from + L, k === K - 1 ? outLength : joinAt(k) - half);
    }
    prev = seg;
    joined++;
  };

  const collect = (): Float32Array => {
    const n = emitted.reduce((s, a) => s + a.length, 0);
    const out = new Float32Array(n);
    let at = 0;
    for (const a of emitted) { out.set(a, at); at += a.length; }
    emitted.length = 0;
    return out;
  };

  return {
    async push(chunk) {
      held.push({ start: received, data: chunk });
      received += chunk.length;
      dispatchReady(false);
      // Keep the number of segments in flight bounded: wait for the oldest
      while (dispatched - joined >= Math.max(1, opts.maxInFlight)) await joinNext();
      return collect();
    },
    async finish() {
      dispatchReady(true);
      while (joined < K) await joinNext();
      void emittedTo;
      return collect();
    },
  };
};
