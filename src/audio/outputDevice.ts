/** Choosing where the studio plays (speakers, headphones, interface). Chrome and Edge can do it from the page; other browsers follow the system's output. */

const KEY = 'uuda_output_device';

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void>; sinkId?: string | { type: string } };

export const canChooseOutput = (ctx: AudioContext | null): boolean => {
  const proto = (ctx ?? (typeof AudioContext !== 'undefined' ? AudioContext.prototype : null)) as SinkContext | null;
  return !!proto && typeof proto.setSinkId === 'function';
};

export const loadOutputId = (): string => { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } };
export const saveOutputId = (id: string): void => { try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ } };

/** Point the audio context at a device ('' = the system default). Returns false when the browser or device refuses. */
export const applyOutput = async (ctx: AudioContext | null, id: string): Promise<boolean> => {
  const c = ctx as SinkContext | null;
  if (!c || typeof c.setSinkId !== 'function') return false;
  try { await c.setSinkId(id); return true; } catch { return false; }
};
