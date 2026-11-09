import { useCallback, useEffect, useRef, useState } from 'react';
import { listMics, type MicInfo } from './devices';

/** The microphones on offer. `fresh` is set when a device appears after the page opened (a USB mic plugged in), so the page can offer it. */
export const useMics = () => {
  const [mics, setMics] = useState<MicInfo[]>([]);
  const [fresh, setFresh] = useState<MicInfo | null>(null);
  const known = useRef<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    const list = await listMics();
    setMics(list);
    const ids = new Set(list.map((m) => m.id).filter(Boolean));
    if (known.current) {
      const added = list.find((m) => m.id && m.id !== 'default' && !known.current!.has(m.id));
      if (added) setFresh(added);
    }
    // Before the microphone is allowed the browser hides device ids, so only remember a list that has some
    if (ids.size > 0 || known.current === null) known.current = ids.size > 0 ? ids : null;
    return list;
  }, []);

  useEffect(() => {
    void refresh();
    const md = navigator.mediaDevices;
    const on = () => void refresh();
    md?.addEventListener?.('devicechange', on);
    return () => md?.removeEventListener?.('devicechange', on);
  }, [refresh]);

  return { mics, fresh, clearFresh: () => setFresh(null), refresh };
};
