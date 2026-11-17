/** Pure decisions for the voice call: who to connect to, how the connection is doing, and how to tune the audio. */
import type { RoomPeer } from './roomState';

/** Everyone in the call connects to everyone else in it (up to six people, audio only, so this stays light) */
export function planConnections(myId: string, peers: RoomPeer[], meAdmitted: boolean, open: string[]): { connect: string[]; drop: string[] } {
  const want = meAdmitted ? peers.filter((p) => p.admitted && p.id !== myId).map((p) => p.id) : [];
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
export function tuneOpus(sdp: string): string {
  return sdp.replace(/a=fmtp:(\d+) ([^\r\n]*)/g, (line, pt: string, params: string) => {
    if (!/useinbandfec|minptime|stereo|opus/.test(params) && !new RegExp(`a=rtpmap:${pt} opus/48000`).test(sdp)) return line;
    if (!new RegExp(`a=rtpmap:${pt} opus/48000`).test(sdp)) return line;
    const kv = new Map(params.split(';').map((p) => p.trim()).filter(Boolean).map((p) => { const [k, ...v] = p.split('='); return [k, v.join('=')] as [string, string]; }));
    kv.set('useinbandfec', '1'); kv.set('usedtx', '0'); kv.set('stereo', '0'); kv.set('sprop-stereo', '0'); kv.set('maxaveragebitrate', '48000'); kv.set('minptime', '20');
    return `a=fmtp:${pt} ${[...kv.entries()].map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join(';')}`;
  });
}

export const LABEL: Record<Quality, string> = { good: 'Good connection', weak: 'Weak connection', poor: 'Poor connection', unknown: 'Connecting…' };
