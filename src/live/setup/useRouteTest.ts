import { useCallback, useRef, useState } from 'react';
import { micConstraints } from '../room/callPlan';
import { CHIRP, detectChirp, makeChirp } from './routeTest';

export type RouteState = { phase: 'idle' | 'running' | 'done' | 'error'; found: boolean; strength: number; error: string | null };
const idle: RouteState = { phase: 'idle', found: false, strength: 0, error: null };

/** Plays one short sweep out of the computer's output while listening on the chosen input. It never plays the microphone back. */
export function useRouteTest() {
  const [state, setState] = useState<RouteState>(idle);
  const busy = useRef(false);

  const run = useCallback(async (deviceId: string) => {
    if (busy.current) return;
    busy.current = true;
    setState({ ...idle, phase: 'running' });
    let stream: MediaStream | null = null;
    let ac: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints('broadcast', true, deviceId || undefined) });
      ac = new AudioContext();
      await ac.resume();
      const chunks: Float32Array[] = [];
      const src = ac.createMediaStreamSource(stream);
      const sp = ac.createScriptProcessor(4096, 1, 1);
      const mute = ac.createGain(); mute.gain.value = 0; // keeps the capture running without any sound coming out of it
      sp.onaudioprocess = (e) => { chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
      src.connect(sp); sp.connect(mute); mute.connect(ac.destination);
      const tpl = makeChirp(ac.sampleRate);
      await new Promise((r) => setTimeout(r, 500));
      const buf = ac.createBuffer(1, tpl.length, ac.sampleRate);
      buf.copyToChannel(tpl, 0);
      const player = ac.createBufferSource(); player.buffer = buf; player.connect(ac.destination); player.start();
      await new Promise((r) => setTimeout(r, (CHIRP.seconds + 2) * 1000));
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const rec = new Float32Array(total);
      let o = 0; for (const c of chunks) { rec.set(c, o); o += c.length; }
      const hit = detectChirp(rec, tpl, ac.sampleRate);
      setState({ phase: 'done', found: hit.found, strength: hit.strength, error: null });
    } catch {
      setState({ ...idle, phase: 'error', error: 'The test could not run. Allow the microphone and try again.' });
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      void ac?.close().catch(() => undefined);
      busy.current = false;
    }
  }, []);

  return { state, run, reset: () => setState(idle) };
}
