import type { StreamedMeta } from '../../assets/streamedStore';

/** A take this device recorded for a live room and has not yet handed over. Kept in localStorage so a reload or crash cannot lose track of the audio on disk. */
export interface QueuedTake {
  token: string;
  takeId: string;
  name: string;
  /** Room time the take was meant to start and when it was stopped */
  startAt: number;
  stopAt: number | null;
  /** Room time at which this device's recording really began (it starts a little early, during the count-in) */
  roomStartMs: number;
  meta: StreamedMeta;
  savedAt: number;
  /** When the host confirmed it has the whole file. The recording stays on this device. */
  deliveredAt?: number;
}

const KEY = 'uuda_room_takes';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const browserStore = (): Store | null => { try { return localStorage; } catch { return null; } };

export function listQueued(token?: string, store: Store | null = browserStore()): QueuedTake[] {
  try {
    const all = JSON.parse(store?.getItem(KEY) ?? '[]') as QueuedTake[];
    const ok = Array.isArray(all) ? all.filter((t) => t && typeof t.takeId === 'string' && t.meta && typeof t.meta.storeId === 'string') : [];
    return token ? ok.filter((t) => t.token === token) : ok;
  } catch { return []; }
}

const save = (list: QueuedTake[], store: Store | null) => { try { store?.setItem(KEY, JSON.stringify(list)); } catch { /* storage blocked: the audio is still on disk */ } };

export function addQueued(t: QueuedTake, store: Store | null = browserStore()): void {
  const rest = listQueued(undefined, store).filter((x) => !(x.token === t.token && x.takeId === t.takeId));
  save([...rest, t], store);
}

export function removeQueued(token: string, takeId: string, store: Store | null = browserStore()): void {
  save(listQueued(undefined, store).filter((x) => !(x.token === token && x.takeId === takeId)), store);
}

/** The host has the whole file: stop trying to send it. The audio stays on this device. */
export function markDelivered(token: string, takeId: string, store: Store | null = browserStore()): void {
  save(listQueued(undefined, store).map((x) => (x.token === token && x.takeId === takeId ? { ...x, deliveredAt: Date.now() } : x)), store);
}

/** Takes still to be handed over, oldest first */
export const pendingTakes = (token: string, store: Store | null = browserStore()): QueuedTake[] => listQueued(token, store).filter((t) => !t.deliveredAt).sort((a, b) => a.savedAt - b.savedAt);
