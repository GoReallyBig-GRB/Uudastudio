/// <reference lib="webworker" />
/** Runs fast convolution blocks off the page's thread. One worker holds one convolver and handles blocks one at a time. */
import { StereoConvolver } from './fftConvolve';

let conv: StereoConvolver | null = null;
let dry = 0;

self.onmessage = (e: MessageEvent) => {
  const m = e.data as
    | { type: 'init'; left: Float32Array; right: Float32Array; n: number; gain: number; dry: number }
    | { type: 'run'; id: number; l: Float32Array; r: Float32Array; mono: boolean };
  try {
    if (m.type === 'init') {
      conv = new StereoConvolver(m.left, m.right, m.n, m.gain);
      dry = m.dry;
      (self as unknown as Worker).postMessage({ type: 'ready' });
      return;
    }
    if (!conv) throw new Error('Reverb worker was not set up');
    const [wl, wr] = conv.convolve(m.l, m.r);
    const frames = m.l.length;
    for (let i = 0; i < frames; i++) {
      wl[i] += dry * m.l[i];
      wr[i] += dry * m.r[i];
    }
    let outs: Float32Array[];
    if (m.mono) {
      // a mono clip: the stereo reverb is folded to mono like a speaker downmix
      for (let i = 0; i < wl.length; i++) wl[i] = (wl[i] + wr[i]) / 2;
      outs = [wl];
    } else {
      outs = [wl, wr];
    }
    (self as unknown as Worker).postMessage({ type: 'out', id: m.id, outs }, outs.map((o) => o.buffer));
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', id: (m as { id?: number }).id ?? -1, message: err instanceof Error ? err.message : String(err) });
  }
};
