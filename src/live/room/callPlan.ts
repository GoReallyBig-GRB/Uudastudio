/** Pure decisions for the voice call: who to connect to, how the connection is doing, and how to tune the audio. */
import type { RoomPeer } from './roomState';

export type CallMode = 'conversation' | 'broadcast';

/**
 * Conversation: everyone connects to everyone else in the call (audio only, so this stays light).
 * Broadcast: guests connect to the host only; the host builds each guest's own mix.
 */
export function planConnections(myId: string, peers: RoomPeer[], meAdmitted: boolean, open: string[], mode: CallMode = 'conversation', myRole: 'producer' | 'guest' = 'guest'): { connect: string[]; drop: string[] } {
  const hostOnly = mode === 'broadcast' && myRole === 'guest';
  const want = meAdmitted ? peers.filter((p) => p.admitted && p.id !== myId && (!hostOnly || p.role === 'producer')).map((p) => p.id) : [];
  return { connect: want.filter((id) => !open.includes(id)), drop: open.filter((id) => !want.includes(id)) };
}

/** One of the two sides must be "polite" and give way if both start a negotiation at once; the lower id is the polite one */
export const isPolite = (myId: string, theirId: string): boolean => myId < theirId;

export interface LinkStats { rttMs: number | null; lossPct: number | null; relayed: boolean; jitterMs: number | null }
export type Quality = 'good' | 'weak' | 'poor' | 'unknown';

export function qualityOf(s: LinkStats): Quality {
  if (s.rttMs === null && s.lossPct === null) return 'unknown';
  const rtt = s.rttMs ?? 0, loss = s.lossPct ?? 0, jit = s.jitterMs ?? 0;
  if (loss >= 8 || rtt >= 500 || jit >= 80) return 'poor';
  if (loss >= 2 || rtt >= 250 || jit >= 40) return 'weak';
  return 'good';
}

/**
 * Speech settings for the call's Opus audio: wideband voice at 48 kHz, in-band error recovery on, 20 ms packets, mono. A guest on a
 * weak connection keeps being understood; the recordings never use this audio at all.
 */
/** Opus bit rate for the call's audio: broadcast sound is worth the extra data */
export const CALL_BITRATE: Record<CallMode, number> = { conversation: 48_000, broadcast: 64_000 };

/**
 * Microphone settings for the call. In a conversation the browser cleans the sound up because people may be on speakers.
 * In a broadcast the host does the cleaning, so with headphones nothing is applied to the guest's microphone;
 * without headphones only echo cancellation stays on, because without it the guest would hear (and re-send) the host.
 */
export function micConstraints(mode: CallMode, headphones: boolean, deviceId?: string): MediaTrackConstraints {
  const base = { channelCount: 1, sampleRate: 48_000, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) };
  if (mode === 'conversation') return { ...base, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  return { ...base, echoCancellation: !headphones, noiseSuppression: false, autoGainControl: false };
}

export function tuneOpus(sdp: string, bitrate: number = CALL_BITRATE.conversation): string {
  return sdp.replace(/a=fmtp:(\d+) ([^\r\n]*)/g, (line, pt: string, params: string) => {
    if (!/useinbandfec|minptime|stereo|opus/.test(params) && !new RegExp(`a=rtpmap:${pt} opus/48000`).test(sdp)) return line;
    if (!new RegExp(`a=rtpmap:${pt} opus/48000`).test(sdp)) return line;
    const kv = new Map(params.split(';').map((p) => p.trim()).filter(Boolean).map((p) => { const [k, ...v] = p.split('='); return [k, v.join('=')] as [string, string]; }));
    kv.set('useinbandfec', '1'); kv.set('usedtx', '0'); kv.set('stereo', '0'); kv.set('sprop-stereo', '0'); kv.set('maxaveragebitrate', String(bitrate)); kv.set('minptime', '20');
    return `a=fmtp:${pt} ${[...kv.entries()].map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join(';')}`;
  });
}

export const LABEL: Record<Quality, string> = { good: 'Good connection', weak: 'Weak connection', poor: 'Poor connection', unknown: 'Connecting…' };
