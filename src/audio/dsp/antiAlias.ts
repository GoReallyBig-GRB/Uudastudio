/**
 * Anti-alias filter for pitch shifting UP. Raising the pitch by `ratio` reads the audio `ratio` times faster, so everything
 * above Nyquist / ratio would fold back into the audible range as inharmonic noise (the "noisy" Chipmunk). Low-passing
 * the input first removes that content before it can fold. Pitching down needs no filter.
 *
 * An 8th-order Butterworth (four biquads) with the corner at 90% of the new Nyquist. Stateful, so it can run on pieces as they
 * arrive; the whole-buffer and streaming resamplers filter identically.
 */

/** Corner as a fraction of the input's Nyquist for a pitch ratio, or null when no filtering is needed (ratio <= 1). */
export const antiAliasCorner = (ratio: number): number | null => (ratio > 1.0001 ? Math.min(0.98, 0.9 / ratio) : null);

export class AntiAliasFilter {
  private readonly stages: Array<{ b0: number; b1: number; b2: number; a1: number; a2: number; x1: number; x2: number; y1: number; y2: number }> = [];

  /** `corner` is a fraction of Nyquist (0 to 1) */
  constructor(corner: number) {
    const w0 = Math.PI * Math.max(0.01, Math.min(0.98, corner));
    const cw = Math.cos(w0);
    // Butterworth 8th order: four second-order sections with these Q values
    for (const q of [0.5098, 0.6013, 0.9, 2.5629]) {
      const alpha = Math.sin(w0) / (2 * q);
      const a0 = 1 + alpha;
      this.stages.push({
        b0: (1 - cw) / 2 / a0, b1: (1 - cw) / a0, b2: (1 - cw) / 2 / a0,
        a1: (-2 * cw) / a0, a2: (1 - alpha) / a0,
        x1: 0, x2: 0, y1: 0, y2: 0,
      });
    }
  }

  process(input: Float32Array): Float32Array {
    const out = new Float32Array(input);
    for (const s of this.stages) {
      let { x1, x2, y1, y2 } = s;
      for (let i = 0; i < out.length; i++) {
        const x = out[i];
        const y = s.b0 * x + s.b1 * x1 + s.b2 * x2 - s.a1 * y1 - s.a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        out[i] = Number.isFinite(y) ? y : 0;
      }
      s.x1 = x1; s.x2 = x2; s.y1 = y1; s.y2 = y2;
    }
    return out;
  }
}
