import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomView } from './roomState';
import { RoomRecorder, type RoomRecording } from './roomRecorder';
import { addQueued } from './takeQueue';

export interface RoomRecordingView { recording: boolean; error: string | null; saved: Array<{ takeId: string; seconds: number }> }

/**
 * Follows the room's take: starts this device's own recording when a take is announced and stops it when the producer stops (or the room ends).
 * `onFinished` gets the finished recording; the producer's workspace puts it on a track, a guest's stays queued for hand-over.
 */
export function useRoomRecording(token: string, view: RoomView, send: (m: Record<string, unknown>) => boolean, clockMs: () => number, onFinished?: (r: RoomRecording) => void) {
  const rec = useRef(new RoomRecorder());
  const [state, setState] = useState<RoomRecordingView>({ recording: false, error: null, saved: [] });
  const cb = useRef(onFinished); cb.current = onFinished;
  const tried = useRef<string | null>(null);
  const stopAtRef = useRef<number | null>(null); stopAtRef.current = view.take?.stopAt ?? null;
  const admitted = Boolean(view.me?.admitted);
  const takeId = view.take?.id ?? null;
  const stopped = view.take ? view.take.stopAt !== null : false;
  const ended = view.endedAt !== null;

  const stop = useCallback(async () => {
    if (!rec.current.running) return;
    try {
      const r = await rec.current.finish();
      send({ t: 'state', recording: false });
      setState((s) => ({ ...s, recording: false }));
      if (!r) return;
      if (r.take.kind === 'streamed') {
        addQueued({ token, takeId: r.takeId, name: r.name, startAt: r.startAt, stopAt: stopAtRef.current, roomStartMs: r.roomStartMs, meta: r.take.meta, savedAt: Date.now() });
        setState((s) => ({ ...s, saved: [...s.saved, { takeId: r.takeId, seconds: r.take.kind === 'streamed' ? r.take.meta.durationSeconds : 0 }] }));
      }
      cb.current?.(r);
    } catch (e) {
      send({ t: 'state', recording: false });
      setState((s) => ({ ...s, recording: false, error: e instanceof Error ? e.message : 'The recording could not be saved.' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send, token]);

  // A take was announced: start recording right away, during the count-in
  useEffect(() => {
    if (!takeId || stopped || ended || !admitted || tried.current === takeId) return;
    tried.current = takeId;
    const startAt = view.take?.startAt ?? 0;
    void rec.current.begin(takeId, startAt, `Live take ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, clockMs)
      .then(() => { send({ t: 'state', recording: true }); setState((s) => ({ ...s, recording: true, error: null })); })
      .catch((e) => { setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Your recording could not start. The call is not affected.' })); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takeId, stopped, ended, admitted]);

  // The take was stopped, or the room closed under us
  useEffect(() => { if ((stopped || ended) && rec.current.running) void stop(); }, [stopped, ended, stop]);
  // Leaving the page or room mid-take: keep what is on disk
  useEffect(() => () => { void stop(); }, [stop]);

  return { ...state, stop };
}
