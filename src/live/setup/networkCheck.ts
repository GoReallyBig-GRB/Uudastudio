import { callBitrate } from '../room/callPlan';

export interface NetworkReading { rttMs: number[]; /** Kilobits per second going up, or null when it could not be measured */ uploadKbps: number | null; failed: boolean }
export type NetLevel = 'good' | 'fair' | 'poor';
export interface NetworkVerdict { level: NetLevel; /** How many guests this connection suits in a broadcast (0 to 3) */ guests: number; medianMs: number; jitterMs: number; messages: string[] }

const median = (xs: number[]): number => { if (xs.length === 0) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function networkVerdict(r: NetworkReading, bitrate: number = callBitrate('broadcast')): NetworkVerdict {
  if (r.failed || r.rttMs.length === 0) return { level: 'poor', guests: 0, medianMs: 0, jitterMs: 0, messages: ['We could not reach the server. Check your internet connection and try again.'] };
  const medianMs = Math.round(median(r.rttMs));
  const jitterMs = Math.round(median(r.rttMs.map((x) => Math.abs(x - medianMs))) * 2);
  // Each guest needs the call going up and down, with some headroom; use about half the measured upload
  const perGuestKbps = (bitrate * 1.4) / 1000;
  const guests = r.uploadKbps === null ? 3 : Math.max(0, Math.min(3, Math.floor((r.uploadKbps * 0.5) / perGuestKbps)));
  const messages: string[] = [];
  let level: NetLevel = 'good';
  if (medianMs > 300 || jitterMs > 80 || guests === 0) level = 'poor';
  else if (medianMs > 150 || jitterMs > 40 || guests < 3) level = 'fair';
  if (medianMs > 300 || jitterMs > 80) messages.push('Your connection is slow or uneven, so the live sound may break up. Use a cable instead of Wi-Fi, or move closer to the router.');
  else if (medianMs > 150 || jitterMs > 40) messages.push('Your connection is a little slow or uneven. It should work; a cable instead of Wi-Fi would help.');
  if (r.uploadKbps === null) messages.push('We could not measure your upload speed.');
  else if (guests === 0) messages.push('Your upload speed is too low to carry a live call. Try another connection.');
  else if (guests < 3) messages.push(`Your upload speed suits about ${guests} guest${guests === 1 ? '' : 's'} at once.`);
  if (messages.length === 0) messages.push('Your connection is good for a full room of three guests.');
  messages.push('This checks your connection to our server, not each guest\'s connection.');
  return { level, guests, medianMs, jitterMs, messages };
}

/** Times a few tiny requests and one small upload. About a dozen requests in all. */
export async function measureNetwork(fetchFn: typeof fetch = fetch, now: () => number = () => performance.now()): Promise<NetworkReading> {
  const rttMs: number[] = [];
  try {
    for (let i = 0; i < 9; i++) {
      const t0 = now();
      const res = await fetchFn(`/api/health?n=${i}-${Math.random().toString(36).slice(2)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('health');
      const dt = now() - t0;
      if (i > 0) rttMs.push(dt); // the first one pays for opening the connection
    }
  } catch { return { rttMs, uploadKbps: null, failed: rttMs.length === 0 }; }
  const rtt = median(rttMs);
  const bytes = 200_000;
  const speeds: number[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const body = new Uint8Array(bytes);
      const t0 = now();
      const res = await fetchFn('/api/live/ping', { method: 'POST', body, cache: 'no-store' });
      if (!res.ok) throw new Error('ping');
      const secs = Math.max(0.02, (now() - t0 - rtt) / 1000);
      speeds.push(Math.min(100_000, (bytes * 8) / 1000 / secs));
    }
  } catch { return { rttMs, uploadKbps: null, failed: false }; }
  return { rttMs, uploadKbps: Math.round(median(speeds)), failed: false };
}
