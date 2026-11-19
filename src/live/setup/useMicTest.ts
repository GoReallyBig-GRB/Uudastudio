import { useCallback, useEffect, useRef, useState } from 'react';
import { micConstraints } from '../room/callPlan';
import { analyseFrames, frameOf, type Frame, type MicResult } from './micAnalysis';

export const TEST_SECONDS = 5;

export interface MicTestState {
  /** The microphone is open and the meter is moving */
  listening: boolean;
  /** The 5-second test is running */
  recording: boolean;
  /** 0 to 1, for the meter */
  level: number;
  /** 0 to 1 through the test */
  progress: number;
  result: MicResult | null;
  error: string | null;
  devices: MediaDeviceInfo[];
}
const initial: MicTestState = { listening: false, recording: false, level: 0, progress: 0, result: null, error: null, devices: [] };

const explain = (e: unknown): string => {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'The browser blocked the microphone. Click the padlock next to the web address, allow the microphone, and try again.';
  if (name === 'NotFoundError') return 'No microphone was found. Check it is plugged in and switched on.';
  if (name === 'OverconstrainedError' || name === 'NotReadableError') return 'That input could not be opened. It may be in use by another program, or unplugged. Pick another input.';
  return 'The microphone could not be started.';
};

/** Opens a microphone (untouched, as in a broadcast), shows its level, and measures five seconds of speaking. It never plays the sound back, so it cannot cause feedback. */
export function useMicTest() {
  const [state, setState] = useState<MicTestState>(initial);
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const frames = useRef<Frame[]>([]);
  const recording = useRef(false);
  const startedAt = useRef(0);

  const stop = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
    void ctx.current?.close().catch(() => undefined); ctx.current = null;
    recording.current = false;
    setState((s) => ({ ...s, listening: false, recording: false, level: 0, progress: 0 }));
  }, []);

  const listDevices = useCallback(async () => {
    try { const d = await navigator.mediaDevices.enumerateDevices(); setState((s) => ({ ...s, devices: d.filter((x) => x.kind === 'audioinput') })); } catch { /* no device list */ }
  }, []);

  const start = useCallback(async (deviceId: string) => {
    stop();
    setState((s) => ({ ...s, error: null, result: null }));
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: micConstraints('broadcast', true, deviceId || undefined) });
      stream.current = st;
      await listDevices(); // names only appear once the microphone has been allowed
      const ac = new AudioContext();
      ctx.current = ac;
      const an = ac.createAnalyser();
      an.fftSize = 2048;
      ac.createMediaStreamSource(st).connect(an);
      const buf = new Float32Array(an.fftSize);
      setState((s) => ({ ...s, listening: true }));
      timer.current = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        const f = frameOf(buf);
        const level = Math.max(0, Math.min(1, (f.rmsDb + 60) / 60));
        if (recording.current) {
          frames.current.push(f);
          const progress = Math.min(1, (Date.now() - startedAt.current) / (TEST_SECONDS * 1000));
          if (progress >= 1) {
            recording.current = false;
            setState((s) => ({ ...s, level, progress: 1, recording: false, result: analyseFrames(frames.current) }));
            return;
          }
          setState((s) => ({ ...s, level, progress }));
        } else setState((s) => ({ ...s, level }));
      }, 50);
    } catch (e) {
      stop();
      setState((s) => ({ ...s, error: explain(e) }));
    }
  }, [stop, listDevices]);

  const record = useCallback(() => {
    if (!stream.current) return;
    frames.current = []; startedAt.current = Date.now(); recording.current = true;
    setState((s) => ({ ...s, recording: true, progress: 0, result: null }));
  }, []);

  useEffect(() => stop, [stop]);
  return { state, start, stop, record };
}
