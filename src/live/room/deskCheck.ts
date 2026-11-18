/** Can this computer run a broadcast desk? Renders a few seconds of four-guest processing and times it. */

/** How much of real time the desk needs: 0.1 means ten seconds of sound take one second to process */
export type DeskVerdict = 'fine' | 'tight' | 'too-slow';
export const deskVerdict = (ratio: number): DeskVerdict => (!Number.isFinite(ratio) || ratio >= 0.4 ? 'too-slow' : ratio >= 0.2 ? 'tight' : 'fine');

export const DESK_MESSAGES: Record<DeskVerdict, string | null> = {
  fine: null,
  tight: 'This computer is close to its limit for a broadcast. Close other programs and tabs, or switch to a Conversation.',
  'too-slow': 'This computer is not fast enough to run the broadcast controls smoothly, so the session was switched to a Conversation.',
};

export async function measureDesk(seconds = 4, guests = 4): Promise<number> {
  const Offline = (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!Offline) return Infinity;
  const rate = 48_000;
  const ctx = new Offline(2, rate * seconds, rate);
  const noise = ctx.createBuffer(1, rate * seconds, rate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.3;
  const master = ctx.createDynamicsCompressor();
  master.connect(ctx.destination);
  for (let g = 0; g < guests; g++) {
    const src = ctx.createBufferSource(); src.buffer = noise;
    const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 80;
    const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 3500; pres.gain.value = 3;
    const comp = ctx.createDynamicsCompressor();
    const mixMinus = ctx.createGain();
    src.connect(hpf); hpf.connect(pres); pres.connect(comp); comp.connect(master); comp.connect(mixMinus); mixMinus.connect(ctx.destination);
    src.start();
  }
  const t0 = performance.now();
  await ctx.startRendering();
  return (performance.now() - t0) / 1000 / seconds;
}
