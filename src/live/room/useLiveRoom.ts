import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomClient } from './roomClient';
import { initialView, type RoomView } from './roomState';

/** Opens the room connection while `active` is true and gives back what the room looks like plus a way to send. */
export function useLiveRoom(token: string, active: boolean, name?: string) {
  const [view, setView] = useState<RoomView>(initialView());
  const client = useRef<RoomClient | null>(null);
  useEffect(() => {
    if (!active || !token) return;
    const c = new RoomClient({ token, name, onView: setView });
    client.current = c;
    c.connect();
    return () => { c.close(); client.current = null; setView(initialView()); };
  }, [token, active, name]);
  const send = useCallback((m: Record<string, unknown>) => client.current?.send(m) ?? false, []);
  const clockMs = useCallback(() => client.current?.clock.roomNow() ?? Date.now(), []);
  return { view, send, clockMs, clockReady: () => client.current?.clock.ready ?? false };
}
