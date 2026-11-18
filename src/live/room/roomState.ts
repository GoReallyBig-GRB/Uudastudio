/** What a person in the room sees, built up from the server's messages. Pure so it can be tested without a connection. */
export interface RoomPeer { id: string; role: 'producer' | 'guest'; name: string; admitted: boolean; muted: boolean; recording: boolean }
export interface RoomTake { id: string; startAt: number; stopAt: number | null }
export interface RoomView {
  connected: boolean;
  /** Conversation: everyone talks to everyone. Broadcast: guests connect to the host only. */
  mode: 'conversation' | 'broadcast';
  me: { id: string; role: 'producer' | 'guest'; admitted: boolean } | null;
  peers: RoomPeer[];
  autoAdmit: boolean;
  take: RoomTake | null;
  markers: Array<{ take: string; at: number; n: number }>;
  cue: { text: string; at: number } | null;
  endedAt: number | null;
  /** Why the room ended, when the server says (e.g. 'time') */
  endedReason: string | null;
  /** Session time limit: 'soon' = last minutes, 'over' = time is up, room closes at hardAt */
  limit: { phase: 'none' | 'soon' | 'over'; limitAt: number; hardAt: number } | null;
  /** Set when the room refused us or removed us; reconnecting would not help */
  closedReason: string | null;
  error: string | null;
}

export const initialView = (): RoomView => ({ connected: false, mode: 'conversation', me: null, peers: [], autoAdmit: false, take: null, markers: [], cue: null, endedAt: null, endedReason: null, limit: null, closedReason: null, error: null });

type Msg = Record<string, unknown> & { t?: string };

export function applyServerMessage(v: RoomView, m: Msg): RoomView {
  switch (m.t) {
    case 'welcome': {
      const peers = ((m.peers as RoomPeer[]) ?? []).slice();
      return { ...v, connected: true, mode: m.mode === 'broadcast' ? 'broadcast' : 'conversation', error: null, closedReason: null, me: { id: String(m.id), role: m.role as 'producer' | 'guest', admitted: Boolean(m.admitted) }, peers, autoAdmit: Boolean(m.autoAdmit), take: (m.take as RoomTake | null) ?? null, endedAt: (m.endedAt as number | null) ?? null, limit: readLimit(m.limit) };
    }
    case 'joined': {
      const p = m.peer as RoomPeer;
      return { ...v, peers: [...v.peers.filter((x) => x.id !== p.id && !(p.role === 'producer' && x.role === 'producer')), p] };
    }
    case 'left': return { ...v, peers: v.peers.filter((x) => x.id !== m.id) };
    case 'peer': {
      const { t: _t, id, ...patch } = m;
      void _t;
      const me = v.me && v.me.id === id ? { ...v.me, ...(patch.admitted !== undefined ? { admitted: Boolean(patch.admitted) } : {}) } : v.me;
      return { ...v, me, peers: v.peers.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
    }
    case 'mode': return { ...v, mode: m.mode === 'broadcast' ? 'broadcast' : 'conversation' };
    case 'auto': return { ...v, autoAdmit: Boolean(m.on) };
    case 'record': return { ...v, take: { id: String(m.take), startAt: Number(m.startAt), stopAt: null }, markers: [] };
    case 'stop': return v.take && v.take.id === m.take ? { ...v, take: { ...v.take, stopAt: Number(m.stopAt) } } : v;
    case 'marker': return { ...v, markers: [...v.markers, { take: String(m.take), at: Number(m.at), n: Number(m.n) }] };
    case 'cue': return { ...v, cue: { text: String(m.text), at: Number(m.at) } };
    case 'limit': return { ...v, limit: readLimit(m) };
    case 'ended': return { ...v, endedAt: Number(m.at), endedReason: typeof m.reason === 'string' ? m.reason : null, take: v.take && v.take.stopAt === null && m.stopAt ? { ...v.take, stopAt: Number(m.stopAt) } : v.take };
    case 'removed': return { ...v, closedReason: 'The host removed you from the room.' };
    case 'error': return { ...v, error: String(m.message ?? 'Something went wrong.') };
    default: return v;
  }
}

function readLimit(x: unknown): RoomView['limit'] {
  const l = x as { phase?: string; limitAt?: number; hardAt?: number } | null | undefined;
  if (!l || (l.phase !== 'none' && l.phase !== 'soon' && l.phase !== 'over')) return null;
  return { phase: l.phase, limitAt: Number(l.limitAt), hardAt: Number(l.hardAt) };
}

/** The line shown to everyone about the session's time, or null when there is nothing to say. `now` is the shared room clock. */
export function limitNotice(v: RoomView, now: number): string | null {
  if (v.endedReason === 'time') return 'The 3-hour session limit was reached and the room has closed. Your recordings are saved.';
  if (!v.limit || v.limit.phase === 'none' || v.endedAt) return null;
  if (v.limit.phase === 'over') return `Time is up. Finish the current take — the room closes in ${Math.max(1, Math.ceil((v.limit.hardAt - now) / 60000))} min.`;
  return `${Math.max(1, Math.ceil((v.limit.limitAt - now) / 60000))} min left in this session.`;
}
